//! Port forwarding over an existing SSH session (roadmap: local `-L`,
//! dynamic SOCKS5 `-D`, remote `-R`).
//!
//! Local and dynamic forwards bind a listener on 127.0.0.1 of the client;
//! every accepted connection opens a `direct-tcpip` channel on the existing
//! SSH session. Remote forwards ask the server to listen (`tcpip_forward`)
//! and pipe every `forwarded-tcpip` channel the server opens back to a local
//! target. Nothing is persisted: forwards live as long as the session.

pub mod socks5;

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{copy_bidirectional, AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};

use crate::ssh::{ForwardedChannel, SshManager};

/// Forwards always bind the loopback interface of the client machine.
const LISTEN_ADDR: &str = "127.0.0.1";
/// How often the forward tasks check that the session is still alive.
const ALIVE_CHECK: Duration = Duration::from_secs(2);
/// Largest SOCKS5 datagram: 262 bytes per RFC 1928 (max domain request).
const SOCKS_MAX_DATAGRAM: usize = 262;

// ---------------------------------------------------------------------------
// Forward specifications
// ---------------------------------------------------------------------------

/// Parsed forward specification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForwardSpec {
    /// `local:bind_port:target_host:target_port` (ssh `-L`).
    Local {
        bind_port: u16,
        target_host: String,
        target_port: u16,
    },
    /// `dynamic:bind_port` — SOCKS5 proxy on 127.0.0.1:bind_port (ssh `-D`).
    Dynamic { bind_port: u16 },
    /// `remote:bind_port:target_host:target_port` (ssh `-R`): the server
    /// listens on bind_port, connections are relayed to the client's
    /// target_host:target_port.
    Remote {
        bind_port: u16,
        target_host: String,
        target_port: u16,
    },
}

fn parse_port(text: &str) -> Result<u16, String> {
    let port: u16 = text.parse().map_err(|_| format!("invalid_port: {text}"))?;
    if port == 0 {
        return Err(format!("invalid_port: {text}"));
    }
    Ok(port)
}

/// `host:port` with optional IPv6 brackets (`[::1]:80`).
fn split_host_port(text: &str) -> Result<(String, u16), String> {
    let (host, port) = if let Some(rest) = text.strip_prefix('[') {
        let Some(end) = rest.find(']') else {
            return Err(format!("invalid_ipv6: {text}"));
        };
        let host = &rest[..end];
        let port = rest[end + 1..]
            .strip_prefix(':')
            .ok_or_else(|| format!("invalid_ipv6: {text}"))?;
        (host.to_string(), port)
    } else {
        let (host, port) = text
            .rsplit_once(':')
            .ok_or_else(|| format!("missing_port: {text}"))?;
        (host.to_string(), port)
    };
    if host.is_empty() || host.chars().any(char::is_whitespace) {
        return Err(format!("invalid_host: {host}"));
    }
    Ok((host, parse_port(port)?))
}

/// Parses a forward specification: `local:8080:example.com:80`,
/// `dynamic:1080`, `remote:3000:localhost:3000`. The bind side is always
/// 127.0.0.1; IPv6 targets may use brackets.
pub fn parse_forward_spec(text: &str) -> Result<ForwardSpec, String> {
    let text = text.trim();
    let Some((kind, rest)) = text.split_once(':') else {
        return Err(format!("invalid_forward_spec: {text}"));
    };
    match kind {
        "dynamic" => Ok(ForwardSpec::Dynamic {
            bind_port: parse_port(rest)?,
        }),
        "local" | "remote" => {
            let Some((bind_port, target)) = rest.split_once(':') else {
                return Err(format!("invalid_forward_spec: {text}"));
            };
            let bind_port = parse_port(bind_port)?;
            let (target_host, target_port) = split_host_port(target)?;
            let spec = if kind == "local" {
                ForwardSpec::Local {
                    bind_port,
                    target_host,
                    target_port,
                }
            } else {
                ForwardSpec::Remote {
                    bind_port,
                    target_host,
                    target_port,
                }
            };
            Ok(spec)
        }
        _ => Err(format!("unknown_forward_kind: {kind}")),
    }
}

/// Canonical string form, used by `forward_list`.
pub fn spec_to_string(spec: &ForwardSpec) -> String {
    // IPv6 targets keep their brackets so the string parses back.
    let bracket = |host: &str| {
        if host.contains(':') {
            format!("[{host}]")
        } else {
            host.to_string()
        }
    };
    match spec {
        ForwardSpec::Local {
            bind_port,
            target_host,
            target_port,
        } => format!("local:{bind_port}:{}:{target_port}", bracket(target_host)),
        ForwardSpec::Dynamic { bind_port } => format!("dynamic:{bind_port}"),
        ForwardSpec::Remote {
            bind_port,
            target_host,
            target_port,
        } => format!("remote:{bind_port}:{}:{target_port}", bracket(target_host)),
    }
}

// ---------------------------------------------------------------------------
// Events and list payloads
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ForwardErrorEvent<'a> {
    forward_id: &'a str,
    message: &'a str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ForwardChangedEvent<'a> {
    session_id: &'a str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardAdded {
    pub forward_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardEntry {
    pub id: String,
    pub spec: String,
    pub active: bool,
}

fn emit_error(app: &AppHandle, forward_id: &str, message: &str) {
    let _ = app.emit(
        "forward:error",
        &ForwardErrorEvent {
            forward_id,
            message,
        },
    );
}

fn emit_changed(app: &AppHandle, session_id: &str) {
    let _ = app.emit("forward:changed", &ForwardChangedEvent { session_id });
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

pub struct ForwardHandle {
    pub id: String,
    pub session_id: String,
    pub spec: ForwardSpec,
    cancel: oneshot::Sender<()>,
}

/// Registry of running forwards plus one channel-dispatch hub per session
/// for remote forwards.
#[derive(Default)]
pub struct ForwardManager {
    forwards: Mutex<HashMap<String, ForwardHandle>>,
    remote_hubs: Mutex<HashMap<String, RemoteHub>>,
}

#[derive(Clone)]
struct RemoteHub {
    /// bind_port -> queue of channels the server opened for that port.
    routes: Arc<Mutex<HashMap<u32, mpsc::Sender<ForwardedChannel>>>>,
}

impl ForwardManager {
    fn insert(&self, handle: ForwardHandle) {
        self.forwards
            .lock()
            .unwrap()
            .insert(handle.id.clone(), handle);
    }

    fn remove(&self, id: &str) -> Option<ForwardHandle> {
        self.forwards.lock().unwrap().remove(id)
    }

    /// Removes the forward and asks its task to stop; `None` when unknown.
    pub fn cancel(&self, id: &str) -> Option<()> {
        let handle = self.forwards.lock().unwrap().remove(id)?;
        let _ = handle.cancel.send(());
        Some(())
    }

    pub fn list_for_session(&self, session_id: &str) -> Vec<ForwardEntry> {
        let mut entries: Vec<ForwardEntry> = self
            .forwards
            .lock()
            .unwrap()
            .values()
            .filter(|handle| handle.session_id == session_id)
            .map(|handle| ForwardEntry {
                id: handle.id.clone(),
                spec: spec_to_string(&handle.spec),
                active: true,
            })
            .collect();
        entries.sort_by(|a, b| a.spec.cmp(&b.spec));
        entries
    }

    /// Returns (creating on first use) the session-level hub that receives
    /// `forwarded-tcpip` channels from the server; `None` if the session is
    /// already gone.
    fn ensure_remote_hub(&self, app: &AppHandle, session_id: &str) -> Option<RemoteHub> {
        let mut hubs = self.remote_hubs.lock().unwrap();
        if let Some(hub) = hubs.get(session_id) {
            return Some(hub.clone());
        }
        let ssh = app.state::<SshManager>();
        let session = ssh.get(session_id)?;
        let (tx, rx) = mpsc::channel::<ForwardedChannel>(32);
        let routes: Arc<Mutex<HashMap<u32, mpsc::Sender<ForwardedChannel>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        // The session's handler slot holds a sender clone, keeping the
        // dispatcher alive until the hub is torn down.
        *session.remote_slot.lock().unwrap() = Some(tx.clone());
        tokio::spawn(dispatch_loop(rx, routes.clone()));
        let hub = RemoteHub { routes };
        hubs.insert(session_id.to_string(), hub);
        hubs.get(session_id).cloned()
    }

    /// Removes one route; returns `true` when the session has no remote
    /// forwards left (so the caller can tear the hub down).
    fn unregister_remote_route(&self, session_id: &str, bind_port: u32) -> bool {
        let mut hubs = self.remote_hubs.lock().unwrap();
        let empty = match hubs.get(session_id) {
            Some(hub) => {
                let mut routes = hub.routes.lock().unwrap();
                routes.remove(&bind_port);
                routes.is_empty()
            }
            None => true,
        };
        if empty {
            hubs.remove(session_id);
        }
        empty
    }
}

/// Routes server-opened channels to the forward task that registered the
/// port; ends when every sender is dropped (hub removed or session closed).
async fn dispatch_loop(
    mut rx: mpsc::Receiver<ForwardedChannel>,
    routes: Arc<Mutex<HashMap<u32, mpsc::Sender<ForwardedChannel>>>>,
) {
    while let Some(forwarded) = rx.recv().await {
        let route = routes
            .lock()
            .unwrap()
            .get(&forwarded.connected_port)
            .cloned();
        if let Some(tx) = route {
            let _ = tx.send(forwarded).await;
        }
        // Unknown port (route already removed): the channel is dropped,
        // which closes it towards the server.
    }
}

fn session_alive(ssh: &SshManager, session_id: &str) -> bool {
    match ssh.get(session_id) {
        Some(session) => !session.closed.load(Ordering::SeqCst),
        None => false,
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn forward_add(
    app: AppHandle,
    ssh: State<'_, SshManager>,
    forwards: State<'_, ForwardManager>,
    session_id: String,
    spec: String,
) -> Result<ForwardAdded, String> {
    let spec = parse_forward_spec(&spec)?;
    if !session_alive(&ssh, &session_id) {
        return Err("session_not_found".to_string());
    }

    // Bind locally before spawning so bind errors reach the caller directly.
    let listener = match &spec {
        ForwardSpec::Local { bind_port, .. } | ForwardSpec::Dynamic { bind_port } => Some(
            TcpListener::bind((LISTEN_ADDR, *bind_port))
                .await
                .map_err(|e| format!("bind_failed: {e}"))?,
        ),
        ForwardSpec::Remote { .. } => None,
    };

    // Remote: ask the server to listen while we can still report denial.
    if let ForwardSpec::Remote { bind_port, .. } = &spec {
        let session = ssh
            .get(&session_id)
            .ok_or_else(|| "session_not_found".to_string())?;
        session
            .handle
            .tcpip_forward(LISTEN_ADDR, u32::from(*bind_port))
            .await
            .map_err(|e| format!("forward_denied: {e}"))?;
    }

    let (cancel, cancelled) = oneshot::channel();
    let forward_id = uuid::Uuid::new_v4().to_string();
    forwards.insert(ForwardHandle {
        id: forward_id.clone(),
        session_id: session_id.clone(),
        spec: spec.clone(),
        cancel,
    });

    match spec.clone() {
        ForwardSpec::Local { .. } | ForwardSpec::Dynamic { .. } => {
            let listener = listener.expect("local and dynamic forwards bind a listener");
            tokio::spawn(run_listener(
                app.clone(),
                forward_id.clone(),
                session_id.clone(),
                spec,
                listener,
                cancelled,
            ));
        }
        ForwardSpec::Remote { .. } => {
            tokio::spawn(run_remote(
                app.clone(),
                forward_id.clone(),
                session_id.clone(),
                spec,
                cancelled,
            ));
        }
    }

    emit_changed(&app, &session_id);
    Ok(ForwardAdded { forward_id })
}

#[tauri::command]
pub fn forward_remove(
    forwards: State<'_, ForwardManager>,
    forward_id: String,
) -> Result<(), String> {
    forwards
        .cancel(&forward_id)
        .ok_or_else(|| "forward_not_found".to_string())?;
    Ok(())
}

#[tauri::command]
pub fn forward_list(forwards: State<'_, ForwardManager>, session_id: String) -> Vec<ForwardEntry> {
    forwards.list_for_session(&session_id)
}

// ---------------------------------------------------------------------------
// Listener tasks (local and dynamic)
// ---------------------------------------------------------------------------

async fn run_listener(
    app: AppHandle,
    forward_id: String,
    session_id: String,
    spec: ForwardSpec,
    listener: TcpListener,
    mut cancelled: oneshot::Receiver<()>,
) {
    let mut alive = tokio::time::interval(ALIVE_CHECK);
    loop {
        tokio::select! {
            _ = &mut cancelled => break,
            _ = alive.tick() => {
                let ssh = app.state::<SshManager>();
                if !session_alive(&ssh, &session_id) {
                    break;
                }
            }
            accepted = listener.accept() => match accepted {
                Ok((stream, peer)) => {
                    let task_app = app.clone();
                    let task_id = forward_id.clone();
                    let task_session = session_id.clone();
                    let task_spec = spec.clone();
                    tokio::spawn(async move {
                        serve_connection(
                            task_app,
                            task_id,
                            task_session,
                            task_spec,
                            stream,
                            peer.port(),
                        )
                        .await;
                    });
                }
                Err(e) => {
                    emit_error(&app, &forward_id, &format!("accept_failed: {e}"));
                    break;
                }
            },
        }
    }
    let forwards = app.state::<ForwardManager>();
    forwards.remove(&forward_id);
    emit_changed(&app, &session_id);
}

/// Serves one accepted connection according to the forward kind.
async fn serve_connection(
    app: AppHandle,
    forward_id: String,
    session_id: String,
    spec: ForwardSpec,
    stream: TcpStream,
    peer_port: u16,
) {
    let ssh = app.state::<SshManager>();
    let Some(session) = ssh.get(&session_id) else {
        emit_error(&app, &forward_id, "session_not_found");
        return;
    };

    match &spec {
        ForwardSpec::Local {
            target_host,
            target_port,
            ..
        } => {
            let channel = session
                .handle
                .channel_open_direct_tcpip(
                    target_host.as_str(),
                    u32::from(*target_port),
                    LISTEN_ADDR,
                    u32::from(peer_port),
                )
                .await;
            match channel {
                Ok(channel) => pipe(stream, channel).await,
                Err(e) => emit_error(&app, &forward_id, &format!("channel_open_failed: {e}")),
            }
        }
        ForwardSpec::Dynamic { .. } => {
            let mut stream = stream;
            let request = match socks5_handshake(&mut stream).await {
                Ok(request) => request,
                Err(message) => {
                    emit_error(&app, &forward_id, &format!("socks5: {message}"));
                    return;
                }
            };
            let channel = session
                .handle
                .channel_open_direct_tcpip(
                    request.addr.to_host_string().as_str(),
                    u32::from(request.port),
                    LISTEN_ADDR,
                    u32::from(peer_port),
                )
                .await;
            match channel {
                Ok(channel) => {
                    // Address/port fields of the reply stay zero: clients
                    // only look at the status byte.
                    let _ = stream
                        .write_all(&socks5::connect_reply(socks5::REPLY_SUCCESS))
                        .await;
                    pipe(stream, channel).await;
                }
                Err(e) => {
                    let _ = stream
                        .write_all(&socks5::connect_reply(socks5::REPLY_GENERAL_FAILURE))
                        .await;
                    emit_error(&app, &forward_id, &format!("channel_open_failed: {e}"));
                }
            }
        }
        ForwardSpec::Remote { .. } => {
            // Remote forwards have no local listener; unreachable here.
        }
    }
}

async fn pipe(mut stream: TcpStream, channel: russh::Channel<russh::client::Msg>) {
    let mut channel = channel.into_stream();
    let _ = copy_bidirectional(&mut stream, &mut channel).await;
}

/// SOCKS5 handshake on an accepted connection; returns the CONNECT target.
async fn socks5_handshake(stream: &mut TcpStream) -> Result<socks5::SocksRequest, String> {
    let method = read_socks_message(stream, 2 + 255, socks5::select_method_from_greeting).await?;
    stream
        .write_all(&socks5::method_reply(method))
        .await
        .map_err(|e| e.to_string())?;
    if method == socks5::METHOD_NO_ACCEPTABLE {
        return Err(socks5::SocksError::NoAcceptableMethod.to_string());
    }

    let request = read_socks_message(stream, SOCKS_MAX_DATAGRAM, socks5::parse_request).await?;
    Ok(request)
}

/// Reads a datagram until the pure parser accepts it, EOF or the size limit.
async fn read_socks_message<T>(
    stream: &mut TcpStream,
    limit: usize,
    parse: fn(&[u8]) -> Result<T, socks5::SocksError>,
) -> Result<T, String> {
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 64];
    loop {
        match parse(&buf) {
            Ok(parsed) => return Ok(parsed),
            Err(socks5::SocksError::Truncated) => {}
            Err(e) => return Err(e.to_string()),
        }
        if buf.len() >= limit {
            return Err("socks5_datagram_too_long".to_string());
        }
        let n = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
        if n == 0 {
            return Err(socks5::SocksError::Truncated.to_string());
        }
        buf.extend_from_slice(&chunk[..n]);
    }
}

// ---------------------------------------------------------------------------
// Remote forwards
// ---------------------------------------------------------------------------

async fn run_remote(
    app: AppHandle,
    forward_id: String,
    session_id: String,
    spec: ForwardSpec,
    mut cancelled: oneshot::Receiver<()>,
) {
    let ForwardSpec::Remote {
        bind_port,
        target_host,
        target_port,
    } = spec
    else {
        return; // unreachable: only spawned for remote specs
    };

    let forwards = app.state::<ForwardManager>();
    let ssh = app.state::<SshManager>();

    // Hook into the session-level dispatcher that receives the channels the
    // server opens for our listening port.
    let Some(hub) = forwards.ensure_remote_hub(&app, &session_id) else {
        emit_error(&app, &forward_id, "session_not_found");
        forwards.remove(&forward_id);
        emit_changed(&app, &session_id);
        return;
    };
    let (tx, mut incoming) = mpsc::channel::<ForwardedChannel>(16);
    hub.routes.lock().unwrap().insert(u32::from(bind_port), tx);
    emit_changed(&app, &session_id);

    let mut alive = tokio::time::interval(ALIVE_CHECK);
    loop {
        tokio::select! {
            _ = &mut cancelled => break,
            _ = alive.tick() => {
                if !session_alive(&ssh, &session_id) {
                    break;
                }
            }
            accepted = incoming.recv() => match accepted {
                Some(forwarded) => {
                    let target_host = target_host.clone();
                    tokio::spawn(async move {
                        match TcpStream::connect((target_host.as_str(), target_port)).await {
                            Ok(mut stream) => {
                                let mut channel = forwarded.channel.into_stream();
                                let _ = copy_bidirectional(&mut stream, &mut channel).await;
                            }
                            Err(_) => {
                                // Unreachable target: dropping the channel
                                // closes it towards the server.
                            }
                        }
                    });
                }
                None => break, // dispatcher gone (session closed)
            },
        }
    }

    // Tear down: route, server-side listen and (when last) the hub.
    let hub_gone = forwards.unregister_remote_route(&session_id, u32::from(bind_port));
    if hub_gone {
        if let Some(session) = ssh.get(&session_id) {
            session.remote_slot.lock().unwrap().take();
        }
    }
    if let Some(session) = ssh.get(&session_id) {
        let _ = session
            .handle
            .cancel_tcpip_forward(LISTEN_ADDR, u32::from(bind_port))
            .await;
    }
    forwards.remove(&forward_id);
    emit_changed(&app, &session_id);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_specifications() {
        assert_eq!(
            parse_forward_spec("local:8080:example.com:80"),
            Ok(ForwardSpec::Local {
                bind_port: 8080,
                target_host: "example.com".into(),
                target_port: 80
            })
        );
        assert_eq!(
            parse_forward_spec("dynamic:1080"),
            Ok(ForwardSpec::Dynamic { bind_port: 1080 })
        );
        assert_eq!(
            parse_forward_spec(" remote:3000:localhost:3000 "),
            Ok(ForwardSpec::Remote {
                bind_port: 3000,
                target_host: "localhost".into(),
                target_port: 3000
            })
        );
    }

    #[test]
    fn parses_ipv6_targets_with_brackets() {
        assert_eq!(
            parse_forward_spec("local:2222:[::1]:22"),
            Ok(ForwardSpec::Local {
                bind_port: 2222,
                target_host: "::1".into(),
                target_port: 22
            })
        );
        assert_eq!(
            parse_forward_spec("local:2222:[2001:db8::10]:8080"),
            Ok(ForwardSpec::Local {
                bind_port: 2222,
                target_host: "2001:db8::10".into(),
                target_port: 8080
            })
        );
        assert!(parse_forward_spec("local:2222:[::1]").is_err());
        assert!(parse_forward_spec("local:2222:[::1:22").is_err());
    }

    #[test]
    fn rejects_invalid_specifications() {
        assert!(parse_forward_spec("").is_err());
        assert!(parse_forward_spec("nonsense").is_err());
        assert!(parse_forward_spec("tunnel:1080").is_err());
        // Port out of range or zero.
        assert!(parse_forward_spec("local:0:host:80").is_err());
        assert!(parse_forward_spec("local:70000:host:80").is_err());
        assert!(parse_forward_spec("dynamic:0").is_err());
        assert!(parse_forward_spec("dynamic:8o80").is_err());
        assert!(parse_forward_spec("local:-1:host:80").is_err());
        // Missing or malformed target.
        assert!(parse_forward_spec("local:8080").is_err());
        assert!(parse_forward_spec("local:8080:host").is_err());
        assert!(parse_forward_spec("local:8080::80").is_err());
        assert!(parse_forward_spec("local:8080:ho st:80").is_err());
        assert!(parse_forward_spec("local:8080:host:0").is_err());
        assert!(parse_forward_spec("local:8080:host:99999").is_err());
    }

    #[test]
    fn canonical_string_round_trips() {
        for text in [
            "local:8080:example.com:80",
            "dynamic:1080",
            "remote:3000:localhost:3000",
            "local:2222:[::1]:22",
        ] {
            let spec = parse_forward_spec(text).expect("valid spec");
            assert_eq!(spec_to_string(&spec), text.trim());
        }
    }

    #[test]
    fn list_and_cancel_use_the_manager_map() {
        let manager = ForwardManager::default();
        let (cancel, _cancelled) = oneshot::channel();
        manager.insert(ForwardHandle {
            id: "f1".into(),
            session_id: "s1".into(),
            spec: parse_forward_spec("dynamic:1080").unwrap(),
            cancel,
        });
        assert_eq!(manager.list_for_session("s1").len(), 1);
        assert_eq!(manager.list_for_session("s2").len(), 0);
        assert_eq!(manager.list_for_session("s1")[0].spec, "dynamic:1080");
        assert!(manager.list_for_session("s1")[0].active);
        assert!(manager.cancel("f1").is_some());
        assert!(manager.cancel("f1").is_none());
        assert!(manager.list_for_session("s1").is_empty());
    }
}
