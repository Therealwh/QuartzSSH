//! SSH session management built on russh.

pub mod known_hosts;
pub mod ssh_config;

use base64::Engine;
use russh::client::{self, Handle};
use russh::keys::ssh_key;
use russh::keys::{HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{ChannelMsg, Disconnect};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::config::{
    self, AppSettings, AuthMethod, HostKeyMode, Profile,
};
use known_hosts::{HostKeyStatus, KnownHosts};

// ---------------------------------------------------------------------------
// Host key verification
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HostKeyDecision {
    /// Accept without remembering.
    Accept,
    /// Accept and pin into known_hosts (TOFU).
    AcceptRemember,
    /// Reject the connection.
    Reject,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyPrompt {
    pub ticket: String,
    pub host: String,
    pub port: u16,
    /// `new` — first contact; `changed` — the key differs from the stored one.
    pub status: String,
    pub key_type: String,
    pub fingerprint: String,
    pub previous_fingerprint: String,
}

pub type PendingHostKeys = Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<HostKeyDecision>>>>;

struct HostKeyGate {
    host: String,
    port: u16,
    known_hosts: Arc<KnownHosts>,
    app: AppHandle,
    mode: HostKeyMode,
    pending: PendingHostKeys,
}

impl HostKeyGate {
    async fn verify(&self, key: ssh_key::PublicKey) -> Result<bool, russh::Error> {
        let status = self
            .known_hosts
            .check(&self.host, self.port, &key)
            .map_err(|_| russh::Error::CouldNotReadKey)?;
        match status {
            HostKeyStatus::Known => Ok(true),
            HostKeyStatus::New => match self.mode {
                HostKeyMode::AcceptFirst => self
                    .known_hosts
                    .add(&self.host, self.port, &key)
                    .map(|_| true)
                    .map_err(|_| russh::Error::CouldNotReadKey),
                HostKeyMode::NonStrict => Ok(true),
                HostKeyMode::Strict => {
                    self.ask(&key, "new", String::new()).await
                }
            },
            HostKeyStatus::Changed(previous_fingerprint) => {
                if self.mode == HostKeyMode::NonStrict {
                    return Ok(true);
                }
                // Strict and AcceptFirst both protect against a changed key:
                // reject unless the user explicitly accepts the risk. The new
                // key is never stored silently.
                self.ask(&key, "changed", previous_fingerprint).await
            }
        }
    }

    async fn ask(
        &self,
        key: &ssh_key::PublicKey,
        status: &str,
        previous_fingerprint: String,
    ) -> Result<bool, russh::Error> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let ticket = uuid::Uuid::new_v4().to_string();
        self.pending.lock().unwrap().insert(ticket.clone(), tx);

        let prompt = HostKeyPrompt {
            ticket: ticket.clone(),
            host: self.host.clone(),
            port: self.port,
            status: status.to_string(),
            key_type: key.algorithm().to_string(),
            fingerprint: key.fingerprint(HashAlg::Sha256).to_string(),
            previous_fingerprint,
        };
        if self.app.emit("ssh:host-key", &prompt).is_err() {
            self.pending.lock().unwrap().remove(&ticket);
            return Ok(false);
        }

        // Do not hang forever if the dialog was dismissed silently.
        match tokio::time::timeout(Duration::from_secs(180), rx).await {
            Ok(Ok(HostKeyDecision::AcceptRemember)) => {
                let stored = self
                    .known_hosts
                    .add(&self.host, self.port, key)
                    .is_ok();
                Ok(stored)
            }
            Ok(Ok(HostKeyDecision::Accept)) => Ok(true),
            // Reject, timeout, or the dialog backend failed — stay safe.
            _ => Ok(false),
        }
    }
}

pub struct ClientHandler {
    gate: Arc<HostKeyGate>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let key = match server_public_key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.clone(),
            PublicKeyOrCertificate::Certificate(cert) => {
                ssh_key::PublicKey::from(cert.public_key().clone())
            }
        };
        self.gate.verify(key).await
    }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub enum SshInput {
    Data(Vec<u8>),
    Resize(u32, u32),
    Disconnect,
}

pub struct SshSession {
    pub id: String,
    pub profile_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub handle: Arc<Handle<ClientHandler>>,
    pub input_tx: tokio::sync::mpsc::Sender<SshInput>,
    pub closed: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshDataEvent {
    session_id: String,
    /// Base64 of raw terminal bytes.
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshClosedEvent {
    session_id: String,
    reason: String,
}

pub struct SshManager {
    sessions: Mutex<HashMap<String, Arc<SshSession>>>,
}

impl Default for SshManager {
    fn default() -> Self {
        SshManager {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl SshManager {
    pub fn get(&self, id: &str) -> Option<Arc<SshSession>> {
        self.sessions.lock().unwrap().get(id).cloned()
    }

    pub fn remove(&self, id: &str) -> Option<Arc<SshSession>> {
        self.sessions.lock().unwrap().remove(id)
    }

    pub fn list(&self) -> Vec<String> {
        self.sessions.lock().unwrap().keys().cloned().collect()
    }

    /// Metadata of all live sessions, for the UI status bar.
    pub fn info(&self) -> Vec<SessionInfo> {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .map(|s| SessionInfo {
                id: s.id.clone(),
                profile_id: s.profile_id.clone(),
                host: s.host.clone(),
                port: s.port,
                username: s.username.clone(),
                connected: !s.closed.load(Ordering::SeqCst),
            })
            .collect()
    }

    async fn insert(&self, session: SshSession) {
        self.sessions
            .lock()
            .unwrap()
            .insert(session.id.clone(), Arc::new(session));
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub profile_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
}

pub struct ConnectParams {
    pub profile: Profile,
    pub password: Option<String>,
    pub key_passphrase: Option<String>,
    pub known_hosts: Arc<KnownHosts>,
    pub settings: AppSettings,
    pub pending: PendingHostKeys,
}

/// Establish a full interactive SSH session (auth + PTY + shell).
pub async fn connect(app: AppHandle, manager: &SshManager, params: ConnectParams) -> Result<ConnectResult, String> {
    let profile = params.profile;
    let host = profile.host.clone();
    let port = profile.port;
    let username = profile.username.clone();

    // Resolve credentials: command-line override, then the OS credential store.
    let mut password = params.password;
    if matches!(profile.auth, AuthMethod::Password { .. }) && password.is_none() {
        password = config::load_profile_password(&profile.id)?;
        if password.is_none() {
            return Err("password_required".into());
        }
    }

    let gate = Arc::new(HostKeyGate {
        host: host.clone(),
        port,
        known_hosts: params.known_hosts.clone(),
        app: app.clone(),
        mode: params.settings.host_key_mode,
        pending: params.pending.clone(),
    });

    let mut client_config = client::Config::default();
    // Secure defaults from russh already prefer mlkem768x25519-sha256 and
    // exclude SHA-1 based key exchange and signatures.
    client_config.keepalive_interval = Some(Duration::from_secs(
        profile.keepalive_seconds.clamp(10, 600) as u64
    ));
    client_config.keepalive_max = 3;
    client_config.nodelay = true;

    let handler = ClientHandler { gate };
    let connect_fut = client::connect(Arc::new(client_config), (host.as_str(), port), handler);
    let mut session_handle = match tokio::time::timeout(Duration::from_secs(30), connect_fut).await {
        Ok(Ok(h)) => h,
        Ok(Err(e)) => return Err(format!("ssh_connect_failed: {e}")),
        Err(_) => return Err("connection_timeout".into()),
    };

    // Authentication.
    match &profile.auth {
        AuthMethod::Password { .. } => {
            let pass = password.clone().unwrap_or_default();
            let result = session_handle
                .authenticate_password(username.as_str(), pass.as_str())
                .await
                .map_err(|e| format!("auth_failed: {e}"))?;
            if !result.success() {
                return Err("auth_failed: password rejected".into());
            }
        }
        AuthMethod::PublicKey {
            key_path,
            save_passphrase,
            ..
        } => {
            let key_path = key_path.clone().ok_or("key_path_not_set")?;
            let mut passphrase = params.key_passphrase.clone();
            if passphrase.is_none() && *save_passphrase {
                passphrase = config::load_key_passphrase(&profile.id)?;
            }
            let key = load_private_key(&key_path, passphrase.as_deref())?;
            // Always sign RSA with SHA-256; for other algorithms this is ignored.
            let with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), Some(HashAlg::Sha256));
            let result = session_handle
                .authenticate_publickey(username.as_str(), with_hash)
                .await
                .map_err(|e| format!("auth_failed: {e}"))?;
            if !result.success() {
                return Err("auth_failed: key rejected".into());
            }
        }
    }

    // Open the interactive shell channel.
    let channel = session_handle
        .channel_open_session()
        .await
        .map_err(|e| format!("channel_open_failed: {e}"))?;
    channel
        .request_pty(true, "xterm-256color", 80, 24, 0, 0, &[])
        .await
        .map_err(|e| format!("pty_request_failed: {e}"))?;
    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("shell_request_failed: {e}"))?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let closed = Arc::new(AtomicBool::new(false));

    // Reader/writer task: single owner of the channel.
    let (input_tx, mut input_rx) = tokio::sync::mpsc::channel::<SshInput>(64);
    let ev_app = app.clone();
    let ev_id = session_id.clone();
    let ev_closed = closed.clone();
    tokio::spawn(async move {
        let mut channel = channel;
        loop {
            tokio::select! {
                biased;
                cmd = input_rx.recv() => match cmd {
                    Some(SshInput::Data(bytes)) => {
                        if channel.data(&bytes[..]).await.is_err() {
                            break;
                        }
                    }
                    Some(SshInput::Resize(cols, rows)) => {
                        let _ = channel.window_change(cols, rows, 0, 0).await;
                    }
                    Some(SshInput::Disconnect) | None => break,
                },
                msg = channel.wait() => match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        let payload = SshDataEvent {
                            session_id: ev_id.clone(),
                            data: base64::engine::general_purpose::STANDARD.encode(data),
                        };
                        let _ = ev_app.emit("ssh:data", &payload);
                    }
                    Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                        let payload = SshDataEvent {
                            session_id: ev_id.clone(),
                            data: base64::engine::general_purpose::STANDARD.encode(data),
                        };
                        let _ = ev_app.emit("ssh:data", &payload);
                    }
                    Some(ChannelMsg::ExitStatus { .. }) => {}
                    Some(ChannelMsg::Close) | Some(ChannelMsg::Eof) | None => break,
                    _ => {}
                },
            }
        }
        let _ = ev_closed.store(true, Ordering::SeqCst);
        let _ = ev_app.emit(
            "ssh:closed",
            &SshClosedEvent {
                session_id: ev_id,
                reason: "closed".into(),
            },
        );
    });

    manager
        .insert(SshSession {
            id: session_id.clone(),
            profile_id: profile.id.clone(),
            host: host.clone(),
            port,
            username: username.clone(),
            handle: Arc::new(session_handle),
            input_tx,
            closed,
        })
        .await;

    Ok(ConnectResult {
        session_id,
        host,
        port,
        username,
    })
}

pub fn load_private_key(path: &str, passphrase: Option<&str>) -> Result<PrivateKey, String> {
    let data = std::fs::read_to_string(PathBuf::from(path))
        .map_err(|e| format!("cannot_read_key: {e}"))?;
    let key = if data.contains("PuTTY-User-Key-File") {
        PrivateKey::from_ppk(&data, passphrase.map(String::from))
            .map_err(|e| format!("key_parse_failed: {e}"))?
    } else {
        PrivateKey::from_openssh(data.as_bytes())
            .map_err(|e| format!("key_parse_failed: {e}"))?
    };
    if key.is_encrypted() {
        let pass = passphrase.ok_or("key_passphrase_required")?;
        key.decrypt(pass.as_bytes())
            .map_err(|_| "key_passphrase_invalid".to_string())?;
    }
    Ok(key)
}

pub async fn disconnect(manager: &SshManager, session_id: &str) -> Result<(), String> {
    let session = manager
        .remove(session_id)
        .ok_or_else(|| "session_not_found".to_string())?;
    session.closed.store(true, Ordering::SeqCst);
    let _ = session.input_tx.send(SshInput::Disconnect).await;
    let _ = session
        .handle
        .disconnect(Disconnect::ByApplication, "user disconnect", "en")
        .await;
    Ok(())
}

/// Run a one-shot command over an exec channel (used for diagnostics and monitoring).
pub async fn exec(
    manager: &SshManager,
    session_id: &str,
    command: &str,
) -> Result<(i32, String), String> {
    let session = manager
        .get(session_id)
        .ok_or_else(|| "session_not_found".to_string())?;
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| format!("channel_open_failed: {e}"))?;
    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("exec_failed: {e}"))?;

    let mut output = Vec::new();
    let mut exit_code: i32 = 0;
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { ref data } => output.extend_from_slice(data),
            ChannelMsg::ExtendedData { ref data, .. } => output.extend_from_slice(data),
            ChannelMsg::ExitStatus { exit_status } => exit_code = exit_status as i32,
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }
    Ok((exit_code, String::from_utf8_lossy(&output).to_string()))
}

pub fn write(manager: &SshManager, session_id: &str, bytes: Vec<u8>) -> Result<(), String> {
    let session = manager
        .get(session_id)
        .ok_or_else(|| "session_not_found".to_string())?;
    session
        .input_tx
        .try_send(SshInput::Data(bytes))
        .map_err(|e| e.to_string())
}

pub fn resize(manager: &SshManager, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
    let session = manager
        .get(session_id)
        .ok_or_else(|| "session_not_found".to_string())?;
    session
        .input_tx
        .try_send(SshInput::Resize(cols, rows))
        .map_err(|e| e.to_string())
}
