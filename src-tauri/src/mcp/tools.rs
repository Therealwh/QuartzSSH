//! MCP tools: "QuartzSSH as a bridge for AI agents".
//!
//! Every tool operates on an already-open SSH/SFTP session of the desktop
//! app. The bridge never connects on its own, so credentials are only ever
//! used in sessions the user started explicitly. Hosts not on the allowlist
//! are invisible to callers.

use russh_sftp::protocol::OpenFlags;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

use super::ConfirmRequest;
use crate::config::{McpConfirmationMode, McpSettings, Profile, ProfileStore};
use crate::mcp::McpState;
use crate::sftp::{self, SftpManager};
use crate::ssh::{self, SshManager};

/// exec timeout for `ssh_exec`.
pub const EXEC_TIMEOUT: Duration = Duration::from_secs(30);
/// How long a confirmation request may stay unanswered.
pub const CONFIRM_TIMEOUT: Duration = Duration::from_secs(120);
/// `sftp_read` limit.
pub const READ_LIMIT: u64 = 10 * 1024 * 1024;
/// Cap for `sftp_list` output.
const LIST_CAP: usize = 500;
/// Cap for confirmation summaries and audit summaries.
const SUMMARY_CAP: usize = 200;

// ---------------------------------------------------------------------------
// Tool catalogue
// ---------------------------------------------------------------------------

pub struct ToolDef {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: serde_json::Value,
}

pub fn tool_definitions() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "list_hosts",
            description: "List SSH connection profiles allowed for this bridge \
                (id, display name and hostname; no secrets). Use the returned \
                id as `host` for the other tools.",
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "ssh_exec",
            description: "Run a shell command on an allowed host over an SSH \
                session that is already open in QuartzSSH. Returns JSON \
                {\"exitCode\": N, \"output\": \"...\"}. Times out after 30 s. \
                Destructive commands (rm -rf, mkfs, shutdown, reboot, dd, ...) \
                require interactive confirmation by the user in the app.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host": { "type": "string", "description": "Profile id from list_hosts" },
                    "command": { "type": "string", "description": "Shell command to run" }
                },
                "required": ["host", "command"]
            }),
        },
        ToolDef {
            name: "sftp_list",
            description: "List a remote directory over SFTP. Requires an open \
                SFTP session for the host in QuartzSSH (open the Files tab).",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host": { "type": "string", "description": "Profile id from list_hosts" },
                    "path": { "type": "string", "description": "Directory path (\".\" for home)" }
                },
                "required": ["host", "path"]
            }),
        },
        ToolDef {
            name: "sftp_read",
            description: "Read a remote text file over SFTP (limit 10 MiB, \
                binary files are rejected). Requires an open SFTP session.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host": { "type": "string", "description": "Profile id from list_hosts" },
                    "path": { "type": "string", "description": "Absolute path of the file" }
                },
                "required": ["host", "path"]
            }),
        },
        ToolDef {
            name: "sftp_write",
            description: "Write (create or truncate-overwrite) a remote text \
                file over SFTP. Overwriting an existing file requires \
                interactive confirmation by the user; there is no force mode.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "host": { "type": "string", "description": "Profile id from list_hosts" },
                    "path": { "type": "string", "description": "Absolute path of the file" },
                    "content": { "type": "string", "description": "Full file content" }
                },
                "required": ["host", "path", "content"]
            }),
        },
    ]
}

// ---------------------------------------------------------------------------
// Allowlist resolution (pure, unit-tested)
// ---------------------------------------------------------------------------

/// Resolve the tool's `host` argument against the allowlist, matching by
/// profile id or exact display name. An empty allowlist means nothing is
/// exposed: every tool returns an error.
pub fn resolve_allowlisted_host(
    allowlist: &[String],
    profiles: &[Profile],
    host_arg: &str,
) -> Result<Profile, String> {
    if allowlist.is_empty() {
        return Err("allowlist_empty: no profiles are exposed to the bridge".into());
    }
    profiles
        .iter()
        .find(|p| {
            (p.id == host_arg || p.name == host_arg) && allowlist.iter().any(|id| id == &p.id)
        })
        .cloned()
        .ok_or_else(|| "host_not_allowed: host is unknown or not on the MCP allowlist".to_string())
}

/// The visible part of `list_hosts` — id, name and hostname, never secrets.
pub fn list_allowed_hosts(
    allowlist: &[String],
    profiles: &[Profile],
) -> Result<Vec<serde_json::Value>, String> {
    if allowlist.is_empty() {
        return Err("allowlist_empty: no profiles are exposed to the bridge".into());
    }
    Ok(profiles
        .iter()
        .filter(|p| allowlist.iter().any(|id| id == &p.id))
        .map(|p| json!({ "id": p.id, "name": p.name, "host": p.host }))
        .collect())
}

// ---------------------------------------------------------------------------
// Destructive-command detection (pure, unit-tested)
// ---------------------------------------------------------------------------

/// Detect the well-known destructive command families the spec calls out:
/// `rm -rf`, `mkfs`, `shutdown`, `reboot` (and close relatives such as
/// poweroff/halt), `dd`. Deliberately conservative: a false positive only
/// costs an extra confirmation dialog, a false negative would not.
///
/// - `mkfs*`, `dd`, `shutdown`, `reboot`, `poweroff`, `halt` count when they
///   appear in a command position (start, or after `|`, `;`, `&&`, `sudo`,
///   `xargs`, ...), so `echo shutdown` does not trigger.
/// - `rm` counts when combined with recursive + force flags, wherever it
///   appears (so `cat x | rm -rf /` is caught).
pub fn is_destructive(command: &str) -> bool {
    const COMMAND_PREFIXES: &[&str] = &[
        "|", ";", "&&", "||", "sudo", "nohup", "doas", "xargs", "env", "nice", "time",
    ];
    let tokens: Vec<String> = command
        .split_whitespace()
        .map(|t| {
            t.trim_matches(|c| c == '"' || c == '\'')
                .to_ascii_lowercase()
        })
        .collect();
    let in_command_position =
        |i: usize| i == 0 || COMMAND_PREFIXES.contains(&tokens[i - 1].as_str());

    for (i, token) in tokens.iter().enumerate() {
        if in_command_position(i)
            && (token == "dd"
                || token.starts_with("mkfs")
                || token == "shutdown"
                || token == "reboot"
                || token == "poweroff"
                || token == "halt")
        {
            return true;
        }
    }
    if tokens.iter().any(|t| t == "rm") {
        let recursive = tokens
            .iter()
            .any(|t| t == "-r" || t == "-rf" || t == "-fr" || t == "--recursive");
        let force = tokens
            .iter()
            .any(|t| t == "-f" || t == "-rf" || t == "-fr" || t == "--force");
        if recursive && force {
            return true;
        }
    }
    false
}

/// Whether a tool call needs the interactive confirmation dialog.
pub fn needs_confirmation(mode: McpConfirmationMode, destructive: bool) -> bool {
    match mode {
        McpConfirmationMode::Always => true,
        McpConfirmationMode::Destructive => destructive,
        McpConfirmationMode::Never => false,
    }
}

// ---------------------------------------------------------------------------
// Audit summary masking (pure, unit-tested)
// ---------------------------------------------------------------------------

/// Build a compact "key=value; ..." summary of tool arguments for the audit
/// log. String values longer than 8 characters are masked with "…" so large
/// payloads (file contents, long commands) never land in the log.
pub fn summarize_args(args: &serde_json::Value) -> String {
    let mut parts: Vec<String> = match args {
        serde_json::Value::Object(map) => map
            .iter()
            .map(|(k, v)| {
                let rendered = match v {
                    serde_json::Value::String(s) => mask(s),
                    other => mask(&other.to_string()),
                };
                format!("{k}={rendered}")
            })
            .collect(),
        other => vec![format!("args={}", mask(&other.to_string()))],
    };
    parts.sort();
    let mut summary = parts.join("; ");
    if summary.chars().count() > SUMMARY_CAP {
        summary = summary.chars().take(SUMMARY_CAP).collect::<String>() + "…";
    }
    summary
}

fn mask(value: &str) -> String {
    if value.chars().count() > 8 {
        "…".to_string()
    } else {
        value.to_string()
    }
}

fn truncate_for_summary(text: &str) -> String {
    if text.chars().count() > SUMMARY_CAP {
        text.chars().take(SUMMARY_CAP).collect::<String>() + "…"
    } else {
        text.to_string()
    }
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ExecArgs {
    host: String,
    command: String,
}

#[derive(Deserialize)]
struct ListArgs {
    host: String,
    path: String,
}

#[derive(Deserialize)]
struct ReadArgs {
    host: String,
    path: String,
}

#[derive(Deserialize)]
struct WriteArgs {
    host: String,
    path: String,
    content: String,
}

/// Everything a tool call may touch, borrowed from the managed state.
pub struct ToolCtx<'a> {
    pub app: &'a AppHandle,
    pub state: &'a McpState,
    pub settings: McpSettings,
}

/// Run one `tools/call`. `Ok(text)` becomes result content; `Err(msg)`
/// becomes a result with `isError: true` (a tool failure, not a protocol
/// error). The audit entry is written by the caller, which knows the raw
/// arguments.
pub async fn call_tool(
    ctx: &ToolCtx<'_>,
    name: &str,
    args: &serde_json::Value,
) -> Result<String, String> {
    match name {
        "list_hosts" => {
            let profiles = ctx.app.state::<ProfileStore>().list();
            let hosts = list_allowed_hosts(&ctx.settings.allowlist_profile_ids, &profiles)?;
            serde_json::to_string_pretty(&hosts).map_err(|e| e.to_string())
        }
        "ssh_exec" => {
            let parsed: ExecArgs =
                serde_json::from_value(args.clone()).map_err(|e| format!("invalid_params: {e}"))?;
            let profile = resolve_host(ctx, &parsed.host).await?;
            require_confirmation(
                ctx,
                "ssh_exec",
                &profile.name,
                &truncate_for_summary(&parsed.command),
                is_destructive(&parsed.command),
            )
            .await?;
            exec_on_profile(ctx, &profile.id, &parsed.command).await
        }
        "sftp_list" => {
            let parsed: ListArgs =
                serde_json::from_value(args.clone()).map_err(|e| format!("invalid_params: {e}"))?;
            let profile = resolve_host(ctx, &parsed.host).await?;
            let handle = sftp_handle_for(ctx, &profile.id)?;
            let mut listing = sftp::list(&handle, &parsed.path).await?;
            listing.entries.truncate(LIST_CAP);
            serde_json::to_string_pretty(&listing).map_err(|e| e.to_string())
        }
        "sftp_read" => {
            let parsed: ReadArgs =
                serde_json::from_value(args.clone()).map_err(|e| format!("invalid_params: {e}"))?;
            let profile = resolve_host(ctx, &parsed.host).await?;
            let handle = sftp_handle_for(ctx, &profile.id)?;
            sftp::read_remote_text(&handle, &parsed.path, READ_LIMIT).await
        }
        "sftp_write" => {
            let parsed: WriteArgs =
                serde_json::from_value(args.clone()).map_err(|e| format!("invalid_params: {e}"))?;
            let profile = resolve_host(ctx, &parsed.host).await?;
            let handle = sftp_handle_for(ctx, &profile.id)?;
            write_remote_file(ctx, &handle, &profile.name, &parsed).await
        }
        _ => Err(format!("unknown_tool: {name}")),
    }
}

async fn resolve_host(ctx: &ToolCtx<'_>, host_arg: &str) -> Result<Profile, String> {
    let profiles = ctx.app.state::<ProfileStore>().list();
    resolve_allowlisted_host(&ctx.settings.allowlist_profile_ids, &profiles, host_arg)
}

/// Interactive confirmation following the HostKeyGate pattern: emit an
/// event, park on a oneshot, treat silence as "no".
async fn require_confirmation(
    ctx: &ToolCtx<'_>,
    tool: &str,
    host: &str,
    summary: &str,
    destructive: bool,
) -> Result<(), String> {
    if !needs_confirmation(ctx.settings.confirmation_mode, destructive) {
        return Ok(());
    }
    let (call_id, rx) = ctx.state.register_confirm();
    let request = ConfirmRequest {
        call_id: call_id.clone(),
        tool: tool.to_string(),
        host: host.to_string(),
        summary: summary.to_string(),
    };
    if ctx.app.emit("mcp:confirm", &request).is_err() {
        ctx.state.cancel_confirm(&call_id);
        return Err("confirmation_unavailable".into());
    }
    match tokio::time::timeout(CONFIRM_TIMEOUT, rx).await {
        Ok(Ok(true)) => Ok(()),
        Ok(Ok(false)) | Ok(Err(_)) => Err("confirmation_denied".into()),
        Err(_) => {
            ctx.state.cancel_confirm(&call_id);
            Err("confirmation_timeout".into())
        }
    }
}

/// Find the live SSH session for a profile. The bridge never dials out.
fn ssh_session_for(ctx: &ToolCtx<'_>, profile_id: &str) -> Result<String, String> {
    ctx.app
        .state::<SshManager>()
        .info()
        .into_iter()
        .find(|s| s.profile_id == profile_id)
        .map(|s| s.id)
        .ok_or_else(|| {
            "session_not_found: the host is not connected in QuartzSSH; open a terminal tab first"
                .into()
        })
}

async fn exec_on_profile(
    ctx: &ToolCtx<'_>,
    profile_id: &str,
    command: &str,
) -> Result<String, String> {
    let session_id = ssh_session_for(ctx, profile_id)?;
    let fut = ssh::exec(ctx.app.state::<SshManager>().inner(), &session_id, command);
    let (exit_code, output) = tokio::time::timeout(EXEC_TIMEOUT, fut)
        .await
        .map_err(|_| "exec_timeout: command exceeded 30s".to_string())??;
    serde_json::to_string_pretty(&json!({ "exitCode": exit_code, "output": output }))
        .map_err(|e| e.to_string())
}

fn sftp_handle_for(
    ctx: &ToolCtx<'_>,
    profile_id: &str,
) -> Result<std::sync::Arc<sftp::SftpHandle>, String> {
    let session_id = ssh_session_for(ctx, profile_id)?;
    ctx.app
        .state::<SftpManager>()
        .find_by_session(&session_id)
        .ok_or_else(|| {
            "sftp_session_not_found: open the Files tab for this host in QuartzSSH first".into()
        })
}

/// SFTP write with truncate semantics. `SftpSession::write` opens files
/// without TRUNCATE (a shorter payload would leave a tail of the old file),
/// so this does an explicit CREATE|TRUNCATE open instead.
async fn write_remote_file(
    ctx: &ToolCtx<'_>,
    handle: &std::sync::Arc<sftp::SftpHandle>,
    host_name: &str,
    args: &WriteArgs,
) -> Result<String, String> {
    let existing = handle.sftp.metadata(&args.path).await.ok();
    if let Some(attrs) = &existing {
        if attrs.is_dir() {
            return Err("sftp_write_failed: path is a directory".into());
        }
    }
    if existing.is_some() {
        let size = existing.as_ref().and_then(|a| a.size).unwrap_or(0);
        require_confirmation(
            ctx,
            "sftp_write",
            host_name,
            &format!("overwrite {} ({} bytes)", args.path, size),
            true,
        )
        .await?;
    }

    let mut file = handle
        .sftp
        .open_with_flags(
            &args.path,
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
        )
        .await
        .map_err(|e| format!("sftp_open_failed: {e}"))?;
    file.write_all(args.content.as_bytes())
        .await
        .map_err(|e| format!("sftp_write_failed: {e}"))?;
    file.close()
        .await
        .map_err(|e| format!("sftp_close_failed: {e}"))?;
    Ok(format!(
        "ok: {} bytes written to {}",
        args.content.len(),
        args.path
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(id: &str, name: &str, host: &str) -> Profile {
        Profile {
            id: id.into(),
            name: name.into(),
            group: String::new(),
            host: host.into(),
            port: 22,
            username: "root".into(),
            auth: crate::config::AuthMethod::default(),
            keepalive_seconds: 30,
            auto_reconnect: true,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn empty_allowlist_rejects_every_host() {
        let profiles = vec![profile("p1", "web", "web.example.com")];
        assert!(resolve_allowlisted_host(&[], &profiles, "p1")
            .unwrap_err()
            .starts_with("allowlist_empty"));
        assert!(list_allowed_hosts(&[], &profiles).is_err());
        // Non-empty allowlist still rejects strangers.
        assert!(resolve_allowlisted_host(&["p2".into()], &profiles, "p1").is_err());
        assert!(resolve_allowlisted_host(&["p2".into()], &profiles, "unknown").is_err());
        // id and exact name both work.
        assert!(resolve_allowlisted_host(&["p1".into()], &profiles, "p1").is_ok());
        assert!(resolve_allowlisted_host(&["p1".into()], &profiles, "web").is_ok());
    }

    #[test]
    fn destructive_detection_matches_spec_families() {
        for cmd in [
            "rm -rf /",
            "rm -fr /tmp/build",
            "rm -r -f /var/log",
            "rm --recursive --force /",
            "sudo rm -rf /etc",
            "cat x | rm -rf /",
            "mkfs.ext4 /dev/sdb1",
            "shutdown -h now",
            "sudo reboot",
            "dd if=/dev/zero of=/dev/sda",
            "poweroff",
        ] {
            assert!(is_destructive(cmd), "{cmd} must be destructive");
        }
        for cmd in [
            "ls -la",
            "rm single-file.txt",
            "rm -i file.txt",
            "systemctl status nginx",
            "echo shutdown",
            "tar czf backup.tar.gz /home",
            "grep -r foo .",
        ] {
            assert!(!is_destructive(cmd), "{cmd} must not be destructive");
        }
    }

    #[test]
    fn confirmation_modes_map_to_expected_prompts() {
        assert!(needs_confirmation(McpConfirmationMode::Always, false));
        assert!(needs_confirmation(McpConfirmationMode::Always, true));
        assert!(!needs_confirmation(McpConfirmationMode::Destructive, false));
        assert!(needs_confirmation(McpConfirmationMode::Destructive, true));
        assert!(!needs_confirmation(McpConfirmationMode::Never, true));
    }

    #[test]
    fn audit_summary_masks_long_values() {
        let args = json!({
            "command": "ls -la",
            "host": "web01",
            "path": "/srv/very/long/path",
            "content": "lorem ipsum dolor sit amet",
            "limit": 100
        });
        let summary = summarize_args(&args);
        assert!(summary.contains("command=ls -la"));
        assert!(summary.contains("host=web01"));
        assert!(summary.contains("path=…"));
        assert!(summary.contains("content=…"));
        assert!(summary.contains("limit=100"));
        assert!(!summary.contains("lorem ipsum"));

        // Short strings stay readable, everything is sorted by key.
        let short = summarize_args(&json!({ "b": "12345678", "a": "123456789" }));
        assert_eq!(short, "a=…; b=12345678");
    }

    #[test]
    fn tool_catalogue_is_complete() {
        let defs = tool_definitions();
        let names: Vec<&str> = defs.iter().map(|d| d.name).collect();
        assert_eq!(
            names,
            vec![
                "list_hosts",
                "ssh_exec",
                "sftp_list",
                "sftp_read",
                "sftp_write"
            ]
        );
        for def in &defs {
            assert!(!def.description.is_empty());
            assert_eq!(def.input_schema["type"], "object");
        }
    }
}
