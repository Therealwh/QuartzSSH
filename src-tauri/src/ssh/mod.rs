//! SSH session management built on russh.

#[cfg(test)]
mod integration_tests;
pub mod known_hosts;
pub mod ssh_config;

use base64::Engine;
use russh::client::{self, ChannelOpenHandle, Handle};
use russh::keys::ssh_key;
use russh::keys::{HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{Channel, ChannelMsg, Disconnect};
use serde::Serialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::config::{self, AppSettings, AuthMethod, HostKeyMode, Profile};
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

pub type PendingHostKeys =
    Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<HostKeyDecision>>>>;

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
                HostKeyMode::Strict => self.ask(&key, "new", String::new()).await,
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
                let stored = self.known_hosts.add(&self.host, self.port, key).is_ok();
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
    /// Receives `forwarded-tcpip` channels while a remote forward (`-R`) is
    /// active; the slot stays empty otherwise.
    pub remote_slot: RemoteForwardSlot,
}

/// A `forwarded-tcpip` channel opened by the server for one of our remote
/// forwards; `connected_port` identifies the listening port on the server.
pub struct ForwardedChannel {
    pub channel: Channel<client::Msg>,
    pub connected_port: u32,
}

/// Shared slot for the sender that receives server-opened forwarded
/// channels; set by the forward manager when a remote forward starts.
pub type RemoteForwardSlot = Arc<Mutex<Option<tokio::sync::mpsc::Sender<ForwardedChannel>>>>;

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

    #[allow(clippy::too_many_arguments)]
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<client::Msg>,
        _connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        // Hand the channel to the forward dispatcher if one is registered;
        // otherwise accept and drop (nobody asked for this forward).
        let sender = self.remote_slot.lock().unwrap().as_ref().cloned();
        reply.accept().await;
        if let Some(sender) = sender {
            let _ = sender
                .send(ForwardedChannel {
                    channel,
                    connected_port,
                })
                .await;
        }
        Ok(())
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
    /// Routing slot for server-opened `forwarded-tcpip` channels (remote
    /// forwarding); empty unless a `-R` forward is active on this session.
    pub remote_slot: RemoteForwardSlot,
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

/// russh's default algorithm preferences are already modern: the
/// post-quantum hybrid `mlkem768x25519-sha256` comes first and SHA-1 based
/// KEX, ciphers and MACs are excluded. Upstream still advertises the bare
/// `ssh-rsa` host key algorithm though, whose signatures are SHA-1
/// (RFC 4253). Drop it so an RSA host key can only be verified with
/// `rsa-sha2-256` / `rsa-sha2-512` signatures (RFC 8332); everything else
/// stays as upstream configured it.
fn hardened_preferred(mut preferred: russh::Preferred) -> russh::Preferred {
    preferred.key = Cow::Owned(
        preferred
            .key
            .iter()
            .filter(|algorithm| !matches!(algorithm, ssh_key::Algorithm::Rsa { hash: None }))
            .cloned()
            .collect(),
    );
    preferred
}

/// Establish a full interactive SSH session (auth + PTY + shell).
pub async fn connect(
    app: AppHandle,
    manager: &SshManager,
    params: ConnectParams,
) -> Result<ConnectResult, String> {
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

    // Secure defaults from russh already prefer mlkem768x25519-sha256 and
    // exclude SHA-1 based key exchange, ciphers and MACs; hardened_preferred
    // additionally removes the bare `ssh-rsa` host key algorithm (SHA-1
    // signatures).
    let client_config = client::Config {
        keepalive_interval: Some(Duration::from_secs(
            profile.keepalive_seconds.clamp(10, 600) as u64,
        )),
        keepalive_max: 3,
        nodelay: true,
        preferred: hardened_preferred(client::Config::default().preferred),
        ..Default::default()
    };

    let remote_slot: RemoteForwardSlot = Arc::new(Mutex::new(None));
    let handler = ClientHandler {
        gate,
        remote_slot: remote_slot.clone(),
    };
    let connect_fut = client::connect(Arc::new(client_config), (host.as_str(), port), handler);
    let mut session_handle = match tokio::time::timeout(Duration::from_secs(30), connect_fut).await
    {
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
        ev_closed.store(true, Ordering::SeqCst);
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
            remote_slot,
        })
        .await;

    Ok(ConnectResult {
        session_id,
        host,
        port,
        username,
    })
}

// ---------------------------------------------------------------------------
// Key file inspection (FIDO2/U2F security keys, PuTTY, standard OpenSSH)
// ---------------------------------------------------------------------------

/// OpenSSH security-key (FIDO2/U2F) algorithm identifiers.
pub const SK_ED25519_ALGORITHM: &str = "sk-ssh-ed25519@openssh.com";
pub const SK_ECDSA_NISTP256_ALGORITHM: &str = "sk-ecdsa-sha2-nistp256@openssh.com";

/// Honest early error for hardware keys: the pure-Rust stack (russh/ssh-key)
/// can parse and verify `sk-*` keys, but user-presence signing must be
/// performed by the token itself and requires a libfido2 bridge (planned).
/// See docs/security.md, "Post-Quantum & FIDO2".
pub const HARDWARE_KEY_UNSUPPORTED: &str =
    "hardware_key_unsupported: FIDO2 user-presence signing requires libfido2 integration (planned)";

/// Classification of a key file, used for UI badges and for early, honest
/// errors on key kinds the pure-Rust auth path cannot handle.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum KeyFileInfo {
    /// OpenSSH private key with a pure-Rust signing path.
    Standard,
    /// PuTTY private key (.ppk).
    Putty,
    /// OpenSSH security key (FIDO2/U2F); signing requires the hardware token.
    HardwareFido2 {
        /// Algorithm identifier, e.g. `sk-ssh-ed25519@openssh.com`.
        algorithm: String,
    },
}

/// Match an `sk-*` (FIDO2/U2F) algorithm identifier against the first token
/// of an OpenSSH public-key line, including the certificate variants
/// (`sk-...-cert-v01@openssh.com`). Returns the base algorithm name.
fn sk_algorithm_from_public_text(text: &str) -> Option<&'static str> {
    let token = text.split_whitespace().next()?;
    if token == SK_ED25519_ALGORITHM || token.starts_with("sk-ssh-ed25519-cert") {
        Some(SK_ED25519_ALGORITHM)
    } else if token == SK_ECDSA_NISTP256_ALGORITHM
        || token.starts_with("sk-ecdsa-sha2-nistp256-cert")
    {
        Some(SK_ECDSA_NISTP256_ALGORITHM)
    } else {
        None
    }
}

/// Detect `sk-*` algorithm identifiers inside a base64-decoded OpenSSH
/// private key body. The PEM text hides the algorithm, but the decoded blob
/// embeds it as a plain string.
fn sk_algorithm_from_private_blob(text: &str) -> Option<&'static str> {
    let body: String = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with("-----"))
        .collect();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(body.as_bytes())
        .ok()?;
    if !bytes.starts_with(b"openssh-key-v1\0") {
        return None;
    }
    if find_subslice(&bytes, SK_ED25519_ALGORITHM.as_bytes()).is_some() {
        Some(SK_ED25519_ALGORITHM)
    } else if find_subslice(&bytes, SK_ECDSA_NISTP256_ALGORITHM.as_bytes()).is_some() {
        Some(SK_ECDSA_NISTP256_ALGORITHM)
    } else {
        None
    }
}

/// Substring search over bytes.
fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Pure classification from file contents. `private_data` is the selected key
/// file (None means unreadable), `public_data` the companion `.pub` when it
/// exists. Hardware detection prefers the `.pub` (its first token names the
/// algorithm), then falls back to scanning the decoded private blob.
pub fn classify_key_data(private_data: Option<&str>, public_data: Option<&str>) -> KeyFileInfo {
    let Some(private) = private_data else {
        return KeyFileInfo::Standard;
    };
    if private.contains("PuTTY-User-Key-File") {
        return KeyFileInfo::Putty;
    }
    if let Some(algorithm) = public_data.and_then(sk_algorithm_from_public_text) {
        return KeyFileInfo::HardwareFido2 {
            algorithm: algorithm.to_string(),
        };
    }
    // The selected file may itself be a public-key one-liner (e.g. a .pub
    // picked by mistake) — its first token names the algorithm directly.
    if let Some(algorithm) = sk_algorithm_from_public_text(private) {
        return KeyFileInfo::HardwareFido2 {
            algorithm: algorithm.to_string(),
        };
    }
    if let Some(algorithm) = sk_algorithm_from_private_blob(private) {
        return KeyFileInfo::HardwareFido2 {
            algorithm: algorithm.to_string(),
        };
    }
    KeyFileInfo::Standard
}

/// Inspect the key file at `path` (plus the companion `path.pub`, when
/// present) and classify it for UI hints and auth-path decisions.
pub fn inspect_key_file(path: &str) -> Result<KeyFileInfo, String> {
    let private_data = std::fs::read_to_string(PathBuf::from(path))
        .map_err(|e| format!("cannot_read_key: {e}"))?;
    let pub_path = PathBuf::from(format!("{path}.pub"));
    let public_data = std::fs::read_to_string(pub_path).ok();
    Ok(classify_key_data(
        Some(&private_data),
        public_data.as_deref(),
    ))
}

pub fn load_private_key(path: &str, passphrase: Option<&str>) -> Result<PrivateKey, String> {
    let data = std::fs::read_to_string(PathBuf::from(path))
        .map_err(|e| format!("cannot_read_key: {e}"))?;
    // FIDO2/U2F security keys cannot sign in-process: the private material
    // never leaves the token, and russh would fail later with an obscure
    // parse or signature error. Fail early with an honest message instead.
    let pub_data = std::fs::read_to_string(PathBuf::from(format!("{path}.pub"))).ok();
    if let KeyFileInfo::HardwareFido2 { algorithm } =
        classify_key_data(Some(&data), pub_data.as_deref())
    {
        return Err(format!("{HARDWARE_KEY_UNSUPPORTED} [{algorithm}]"));
    }
    let key = if data.contains("PuTTY-User-Key-File") {
        PrivateKey::from_ppk(&data, passphrase.map(String::from))
            .map_err(|e| format!("key_parse_failed: {e}"))?
    } else {
        PrivateKey::from_openssh(data.as_bytes()).map_err(|e| format!("key_parse_failed: {e}"))?
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

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use std::str::FromStr;

    /// Real security-key public keys, taken verbatim from the OpenSSH test
    /// data also shipped in ssh-key-0.7.0-rc.11/tests/examples/.
    const SK_ED25519_PUB: &str = "sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAICFo/k5LU8863u66YC9eUO2170QduohPURkQnbLa/dczAAAABHNzaDo= user@example.com";
    const SK_ECDSA_PUB: &str = "sk-ecdsa-sha2-nistp256@openssh.com AAAAInNrLWVjZHNhLXNoYTItbmlzdHAyNTZAb3BlbnNzaC5jb20AAAAIbmlzdHAyNTYAAABBBIELQJ2DgvaX1yQlKFokfWM2suuaCFI2qp0eJodHyg6O4ifxc3XpRKd1OS8dNYQtE/YjdXSrA+AOnMF5ns2Nkx4AAAAEc3NoOg== user@example.com";

    const STANDARD_ED25519_PUB: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ9Km9WUuIu5RIJvDp8aSk3DOV64PzHdBe1Bh6Yc8+8V user@example.com";

    const OPENSSH_HEADER: &str = "-----BEGIN OPENSSH PRIVATE KEY-----";
    const PPK_HEADER: &str = "PuTTY-User-Key-File-3\nComment: ed25519-key\nPublic-Lines: 4\n";

    /// Build a synthetic OpenSSH private key body whose decoded blob embeds
    /// `algorithm` (mirrors the real wire format enough for the scanner).
    fn synthetic_openssh_private(algorithm: &str) -> String {
        let mut blob = b"openssh-key-v1\0".to_vec();
        blob.extend_from_slice(b"\0\0\0\x04none");
        blob.extend_from_slice(algorithm.as_bytes());
        let body = base64::engine::general_purpose::STANDARD.encode(&blob);
        format!("{OPENSSH_HEADER}\n{body}\n-----END OPENSSH PRIVATE KEY-----\n")
    }

    #[test]
    fn standard_key_is_detected() {
        let private = synthetic_openssh_private("ssh-ed25519");
        let info = classify_key_data(Some(&private), Some(STANDARD_ED25519_PUB));
        assert_eq!(info, KeyFileInfo::Standard);
    }

    #[test]
    fn putty_key_is_detected() {
        let info = classify_key_data(Some(PPK_HEADER), None);
        assert_eq!(info, KeyFileInfo::Putty);
        // PuTTY wins even if a .pub companion exists.
        let info = classify_key_data(Some(PPK_HEADER), Some(STANDARD_ED25519_PUB));
        assert_eq!(info, KeyFileInfo::Putty);
    }

    #[test]
    fn sk_ed25519_detected_via_companion_pub() {
        let private = synthetic_openssh_private("ssh-ed25519");
        let info = classify_key_data(Some(&private), Some(SK_ED25519_PUB));
        assert_eq!(
            info,
            KeyFileInfo::HardwareFido2 {
                algorithm: SK_ED25519_ALGORITHM.to_string()
            }
        );
    }

    #[test]
    fn sk_ecdsa_detected_via_companion_pub() {
        let private = synthetic_openssh_private("ssh-ed25519");
        let info = classify_key_data(Some(&private), Some(SK_ECDSA_PUB));
        assert_eq!(
            info,
            KeyFileInfo::HardwareFido2 {
                algorithm: SK_ECDSA_NISTP256_ALGORITHM.to_string()
            }
        );
    }

    #[test]
    fn sk_detected_from_private_blob_without_companion() {
        // Missing .pub (None): fall back to the decoded private blob.
        let private = synthetic_openssh_private(SK_ECDSA_NISTP256_ALGORITHM);
        let info = classify_key_data(Some(&private), None);
        assert_eq!(
            info,
            KeyFileInfo::HardwareFido2 {
                algorithm: SK_ECDSA_NISTP256_ALGORITHM.to_string()
            }
        );
    }

    #[test]
    fn sk_certificate_pub_variant_is_detected() {
        let cert = "sk-ssh-ed25519-cert-v01@openssh.com AAAA... comment";
        let info = classify_key_data(Some(OPENSSH_HEADER), Some(cert));
        assert_eq!(
            info,
            KeyFileInfo::HardwareFido2 {
                algorithm: SK_ED25519_ALGORITHM.to_string()
            }
        );
    }

    #[test]
    fn a_pub_file_selected_directly_is_detected() {
        let info = classify_key_data(Some(SK_ED25519_PUB), None);
        assert_eq!(
            info,
            KeyFileInfo::HardwareFido2 {
                algorithm: SK_ED25519_ALGORITHM.to_string()
            }
        );
    }

    #[test]
    fn standard_keys_do_not_trip_hardware_detection() {
        let private = synthetic_openssh_private("ssh-ed25519");
        assert_eq!(
            classify_key_data(Some(&private), None),
            KeyFileInfo::Standard
        );
        // No PEM marker at all (foreign text) must not decode-crash either.
        assert_eq!(
            classify_key_data(Some("garbage"), None),
            KeyFileInfo::Standard
        );
    }

    #[test]
    fn ssh_key_decodes_sk_public_keys() {
        // Confirmed against ssh-key 0.7.0-rc.11: sk-* public keys parse and
        // expose the dedicated algorithms (fixtures from tests/examples).
        let ed = ssh_key::PublicKey::from_str(SK_ED25519_PUB).expect("decode sk-ed25519 pub");
        assert_eq!(
            ed.algorithm(),
            ssh_key::Algorithm::SkEd25519,
            "ssh-key should decode sk-ssh-ed25519@openssh.com"
        );
        let ecdsa = ssh_key::PublicKey::from_str(SK_ECDSA_PUB).expect("decode sk-ecdsa pub");
        assert_eq!(
            ecdsa.algorithm(),
            ssh_key::Algorithm::SkEcdsaSha2NistP256,
            "ssh-key should decode sk-ecdsa-sha2-nistp256@openssh.com"
        );
    }

    #[test]
    fn hardware_error_message_is_explicit() {
        assert!(HARDWARE_KEY_UNSUPPORTED.starts_with("hardware_key_unsupported:"));
        assert!(HARDWARE_KEY_UNSUPPORTED.contains("libfido2"));
    }

    // -- 19.5: the client must never offer weak algorithms ------------------

    /// Post-quantum hybrid KEX first, no SHA-1 key exchange.
    #[test]
    fn client_kex_prefers_post_quantum_and_excludes_sha1() {
        let preferred = client::Config::default().preferred;
        let kex: Vec<String> = preferred
            .kex
            .iter()
            .map(|name| name.as_ref().to_string())
            .collect();
        assert_eq!(
            kex.first().map(String::as_str),
            Some("mlkem768x25519-sha256"),
            "post-quantum hybrid KEX must be the first preference, got {kex:?}"
        );
        for banned in [
            "diffie-hellman-group1-sha1",
            "diffie-hellman-group14-sha1",
            "diffie-hellman-group-exchange-sha1",
        ] {
            assert!(
                !kex.iter().any(|name| name == banned),
                "insecure SHA-1 KEX {banned} must not be offered, got {kex:?}"
            );
        }
    }

    /// No legacy ciphers and no SHA-1 MACs. ("ssh-rsa" is a host key
    /// algorithm, not a KEX or cipher; covered by the signature test below.)
    #[test]
    fn client_ciphers_and_macs_exclude_legacy_algorithms() {
        let preferred = client::Config::default().preferred;
        let ciphers: Vec<String> = preferred
            .cipher
            .iter()
            .map(|name| name.as_ref().to_string())
            .collect();
        for banned in ["arcfour", "arcfour128", "arcfour256", "3des-cbc"] {
            assert!(
                !ciphers.iter().any(|name| name == banned),
                "insecure cipher {banned} must not be offered, got {ciphers:?}"
            );
        }
        let macs: Vec<String> = preferred
            .mac
            .iter()
            .map(|name| name.as_ref().to_string())
            .collect();
        for banned in ["hmac-sha1", "hmac-sha1-96", "hmac-sha1-etm@openssh.com"] {
            assert!(
                !macs.iter().any(|name| name == banned),
                "insecure MAC {banned} must not be offered, got {macs:?}"
            );
        }
    }

    /// `Algorithm::Rsa { hash: None }` (wire name "ssh-rsa") signs with
    /// SHA-1 (RFC 4253). russh 0.65 still advertises it by default, so the
    /// client config filters it out: an RSA host key must only be accepted
    /// with rsa-sha2-256 / rsa-sha2-512 signatures (RFC 8332).
    #[test]
    fn client_host_key_algorithms_exclude_rsa_sha1() {
        let preferred = hardened_preferred(client::Config::default().preferred);
        let key_names: Vec<String> = preferred.key.iter().map(ToString::to_string).collect();
        assert!(
            !key_names.iter().any(|name| name == "ssh-rsa"),
            "bare ssh-rsa (SHA-1 signatures) must not be offered, got {key_names:?}"
        );
        assert!(
            !preferred
                .key
                .iter()
                .any(|algorithm| matches!(algorithm, ssh_key::Algorithm::Rsa { hash: None })),
            "Algorithm::Rsa {{ hash: None }} must be filtered out, got {key_names:?}"
        );
        // Strong RSA signatures stay available and Ed25519 stays first.
        assert!(key_names.contains(&"rsa-sha2-256".to_string()));
        assert!(key_names.contains(&"rsa-sha2-512".to_string()));
        assert_eq!(key_names.first().map(String::as_str), Some("ssh-ed25519"));
    }
}
