//! Optional embedded MCP server: "QuartzSSH as a bridge for AI agents"
//! (spec section 26).
//!
//! Security baseline:
//! - Disabled by default. Nothing listens on any port until the user
//!   explicitly presses "Start" in the settings (`mcp_start`).
//! - TCP is bound strictly to 127.0.0.1 (never 0.0.0.0).
//! - Every request must carry the Bearer token generated on start; the
//!   token lives only in memory for the lifetime of the server instance.
//! - The `Host` header must be loopback (DNS-rebinding defense).
//! - Only profiles on the user's allowlist are reachable, and the bridge
//!   never dials out itself: tools work on sessions already open in the app.
//!
//! See `docs/mcp-server.md` for the full model and client configurations.

pub mod http;
pub mod server;
pub mod tools;

use base64::Engine;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};
use tokio::sync::oneshot;

use crate::config::SettingsStore;

/// Ring-buffer capacity of the audit log.
const AUDIT_CAPACITY: usize = 100;
/// Accepted port range of the bridge.
pub const PORT_MIN: u16 = 47200;
pub const PORT_MAX: u16 = 47300;

/// Payload of the `mcp:confirm` event; the settings view shows a dialog and
/// answers through `mcp_confirm`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmRequest {
    pub call_id: String,
    pub tool: String,
    pub host: String,
    pub summary: String,
}

/// One audited tool call.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub timestamp: i64,
    pub tool: String,
    pub host: String,
    /// Masked `key=value` summary; values longer than 8 characters are
    /// replaced with "…" so payloads and secrets never land in the log.
    pub args_summary: String,
    pub status: String,
}

struct ServerHandle {
    port: u16,
    shutdown: oneshot::Sender<()>,
}

/// Shared state of the MCP bridge: the running server (if any), the audit
/// ring and the pending confirmation senders.
#[derive(Default)]
pub struct McpState {
    server: Mutex<Option<ServerHandle>>,
    audit: Mutex<VecDeque<AuditEntry>>,
    confirms: Mutex<HashMap<String, oneshot::Sender<bool>>>,
}

impl McpState {
    pub fn is_running(&self) -> bool {
        self.server.lock().unwrap().is_some()
    }

    pub fn running_port(&self) -> Option<u16> {
        self.server.lock().unwrap().as_ref().map(|h| h.port)
    }

    /// Stop the running instance, if any. Returns `true` when one was live.
    pub fn stop(&self) -> bool {
        match self.server.lock().unwrap().take() {
            Some(handle) => {
                // Dropping or signalling either way ends the accept loop.
                let _ = handle.shutdown.send(());
                true
            }
            None => false,
        }
    }

    fn set_server(&self, handle: ServerHandle) {
        *self.server.lock().unwrap() = Some(handle);
    }

    pub fn audit_push(&self, tool: &str, host: &str, args_summary: &str, status: &str) {
        let mut log = self.audit.lock().unwrap();
        if log.len() >= AUDIT_CAPACITY {
            log.pop_front();
        }
        log.push_back(AuditEntry {
            timestamp: chrono::Utc::now().timestamp(),
            tool: tool.to_string(),
            host: host.to_string(),
            args_summary: args_summary.to_string(),
            status: status.to_string(),
        });
    }

    fn audit(&self) -> Vec<AuditEntry> {
        self.audit.lock().unwrap().iter().cloned().collect()
    }

    fn audit_clear(&self) {
        self.audit.lock().unwrap().clear();
    }

    /// Register a pending confirmation (HostKeyGate pattern): a oneshot the
    /// tool parks on while the UI dialog is open.
    pub fn register_confirm(&self) -> (String, oneshot::Receiver<bool>) {
        let (tx, rx) = oneshot::channel();
        let call_id = uuid::Uuid::new_v4().to_string();
        self.confirms.lock().unwrap().insert(call_id.clone(), tx);
        (call_id, rx)
    }

    /// Drop an unanswered confirmation (timeout / emit failure).
    pub fn cancel_confirm(&self, call_id: &str) {
        self.confirms.lock().unwrap().remove(call_id);
    }

    fn resolve_confirm(&self, call_id: &str, approved: bool) -> Result<(), String> {
        let sender = self
            .confirms
            .lock()
            .unwrap()
            .remove(call_id)
            .ok_or_else(|| "unknown_call".to_string())?;
        let _ = sender.send(approved);
        Ok(())
    }
}

/// 32 random bytes as unpadded base64url — exactly 43 characters. Two UUIDv4
/// values (the `uuid` crate is already a dependency; v4 is backed by the OS
/// CSPRNG) provide ~244 bits of entropy.
pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    bytes[..16].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    bytes[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn validate_port(port: u16) -> Result<(), String> {
    if (PORT_MIN..=PORT_MAX).contains(&port) {
        Ok(())
    } else {
        Err(format!(
            "invalid_port: {port} is outside the allowed range {PORT_MIN}-{PORT_MAX}"
        ))
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStartResult {
    pub token: String,
    pub port: u16,
}

/// Start the bridge (or restart it — the previous instance, if any, is
/// stopped and a fresh token is generated). The port comes from the saved
/// settings; binding always happens on 127.0.0.1.
#[tauri::command]
pub async fn mcp_start(
    app: AppHandle,
    state: State<'_, Arc<McpState>>,
    settings: State<'_, SettingsStore>,
) -> Result<McpStartResult, String> {
    let port = settings.get().mcp.port;
    validate_port(port)?;

    state.stop();
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("bind_failed: {e} (is port {port} already in use?)"))?;

    let token = generate_token();
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    state.set_server(ServerHandle {
        port,
        shutdown: shutdown_tx,
    });

    let server_state = state.inner().clone();
    tokio::spawn(server::serve(
        listener,
        app,
        server_state,
        token.clone(),
        shutdown_rx,
    ));

    Ok(McpStartResult { token, port })
}

/// Stop the bridge. Returns whether an instance was running.
#[tauri::command]
pub fn mcp_stop(state: State<'_, Arc<McpState>>) -> bool {
    state.stop()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub port: u16,
    pub has_token: bool,
}

#[tauri::command]
pub fn mcp_status(
    state: State<'_, Arc<McpState>>,
    settings: State<'_, SettingsStore>,
) -> McpStatus {
    McpStatus {
        running: state.is_running(),
        port: state
            .running_port()
            .unwrap_or_else(|| settings.get().mcp.port),
        has_token: state.is_running(),
    }
}

#[tauri::command]
pub fn mcp_audit_list(state: State<'_, Arc<McpState>>) -> Vec<AuditEntry> {
    state.audit()
}

#[tauri::command]
pub fn mcp_audit_clear(state: State<'_, Arc<McpState>>) {
    state.audit_clear();
}

/// Answer an `mcp:confirm` dialog from the settings view.
#[tauri::command]
pub fn mcp_confirm(
    state: State<'_, Arc<McpState>>,
    call_id: String,
    approved: bool,
) -> Result<(), String> {
    state.resolve_confirm(&call_id, approved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_43_base64url_chars_and_unique() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), 43, "32 bytes -> 43 chars of unpadded base64url");
        assert_eq!(b.len(), 43);
        assert_ne!(a, b, "tokens must be unique");
        assert!(
            a.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "only base64url alphabet, got {a}"
        );
        assert!(!a.contains('+') && !a.contains('/') && !a.contains('='));
        // The token round-trips through the same check used on the wire.
        assert!(http::check_bearer(Some(&format!("Bearer {a}")), &a));
        assert!(!http::check_bearer(Some(&format!("Bearer {b}")), &a));
    }

    #[test]
    fn audit_ring_caps_at_100_in_chronological_order() {
        let state = McpState::default();
        for i in 0..130 {
            state.audit_push("ssh_exec", "web", "command=…", &format!("ok{i}"));
        }
        let log = state.audit();
        assert_eq!(log.len(), AUDIT_CAPACITY);
        assert_eq!(log[0].status, "ok30", "oldest entries are dropped");
        assert_eq!(log[99].status, "ok129");
        assert!(log[0].timestamp <= log[99].timestamp);
        state.audit_clear();
        assert!(state.audit().is_empty());
    }

    #[test]
    fn port_validation_enforces_range() {
        assert!(validate_port(47215).is_ok());
        assert!(validate_port(PORT_MIN).is_ok());
        assert!(validate_port(PORT_MAX).is_ok());
        assert!(validate_port(47199).is_err());
        assert!(validate_port(47301).is_err());
        assert!(validate_port(80).is_err());
    }

    #[test]
    fn confirm_resolution_is_one_shot() {
        let state = McpState::default();
        let (call_id, rx) = state.register_confirm();
        state
            .resolve_confirm(&call_id, true)
            .expect("first answer wins");
        assert!(state.resolve_confirm(&call_id, false).is_err());
        // Waiting side receives the approval.
        assert_eq!(futures_await(rx), Some(true));
        // Cancelling an unknown call is a no-op; known ones unregister.
        state.cancel_confirm("missing");
        let (call_id2, rx2) = state.register_confirm();
        state.cancel_confirm(&call_id2);
        assert_eq!(futures_await(rx2), None);
    }

    /// Minimal rx drain for tests without a tokio runtime: the sender has
    /// already completed or been dropped by the time we call this.
    fn futures_await(rx: oneshot::Receiver<bool>) -> Option<bool> {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("test runtime")
            .block_on(async move { rx.await.ok() })
    }
}
