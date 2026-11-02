//! All Tauri IPC commands exposed to the frontend.

use base64::Engine;
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::config::{self, AppSettings, Profile, ProfileInput, ProfileStore, SettingsStore};
use crate::localfs;
use crate::monitoring::MonitoringManager;
use crate::sftp::{SftpManager, TransferManager};
use crate::ssh::known_hosts::{KnownHostEntry, KnownHosts};
use crate::ssh::{self, HostKeyDecision, PendingHostKeys, SshManager};

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn profile_from_input(input: ProfileInput, existing: Option<Profile>) -> Result<Profile, String> {
    let id = input
        .id
        .or(existing.as_ref().map(|p| p.id.clone()))
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let prev = existing;
    Ok(Profile {
        id,
        name: input.name,
        group: input.group,
        host: input.host,
        port: input.port,
        username: input.username,
        auth: input.auth,
        keepalive_seconds: input
            .keepalive_seconds
            .unwrap_or_else(|| prev.as_ref().map(|p| p.keepalive_seconds).unwrap_or(30)),
        auto_reconnect: input
            .auto_reconnect
            .unwrap_or_else(|| prev.as_ref().map(|p| p.auto_reconnect).unwrap_or(true)),
        created_at: prev.as_ref().map(|p| p.created_at).unwrap_or_else(now),
        updated_at: now(),
    })
}

#[tauri::command]
pub fn profile_list(store: State<ProfileStore>) -> Vec<Profile> {
    store.list()
}

#[tauri::command]
pub async fn profile_save(
    store: State<'_, ProfileStore>,
    input: ProfileInput,
    password: Option<String>,
    key_passphrase: Option<String>,
) -> Result<Profile, String> {
    let existing = input.id.as_deref().and_then(|id| store.get(id));
    let profile = profile_from_input(input, existing)?;

    // Secrets go only into the OS credential store, never into profiles.json.
    match &profile.auth {
        config::AuthMethod::Password { save_password } => {
            if let Some(pass) = password {
                if *save_password {
                    config::store_profile_password(&profile.id, &pass)?;
                } else {
                    config::drop_profile_password(&profile.id)?;
                }
            } else if !*save_password {
                config::drop_profile_password(&profile.id)?;
            }
        }
        config::AuthMethod::PublicKey {
            save_passphrase, ..
        } => {
            if let Some(pass) = key_passphrase {
                if *save_passphrase {
                    config::store_key_passphrase(&profile.id, &pass)?;
                } else {
                    config::drop_key_passphrase(&profile.id)?;
                }
            } else if !*save_passphrase {
                config::drop_key_passphrase(&profile.id)?;
            }
        }
    }

    store.upsert(profile.clone())?;
    Ok(profile)
}

#[tauri::command]
pub async fn profile_delete(store: State<'_, ProfileStore>, id: String) -> Result<(), String> {
    config::drop_profile_password(&id)?;
    config::drop_key_passphrase(&id)?;
    store.delete(&id)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// SSH
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectInput {
    pub profile_id: String,
    /// Provided interactively when the profile has no stored password.
    pub password: Option<String>,
    pub key_passphrase: Option<String>,
}

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    ssh: State<'_, SshManager>,
    profiles: State<'_, ProfileStore>,
    settings: State<'_, SettingsStore>,
    known_hosts: State<'_, Arc<KnownHosts>>,
    pending: State<'_, PendingHostKeys>,
    input: SshConnectInput,
) -> Result<ssh::ConnectResult, String> {
    let profile = profiles
        .get(&input.profile_id)
        .ok_or_else(|| "profile_not_found".to_string())?;
    ssh::connect(
        app,
        &ssh,
        ssh::ConnectParams {
            profile,
            password: input.password,
            key_passphrase: input.key_passphrase,
            known_hosts: known_hosts.inner().clone(),
            settings: settings.get(),
            pending: pending.inner().clone(),
        },
    )
    .await
}

#[tauri::command]
pub async fn ssh_disconnect(ssh: State<'_, SshManager>, session_id: String) -> Result<(), String> {
    ssh::disconnect(&ssh, &session_id).await
}

#[tauri::command]
pub fn ssh_write(
    ssh: State<SshManager>,
    session_id: String,
    data_base64: String,
) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| format!("bad_base64: {e}"))?;
    ssh::write(&ssh, &session_id, bytes)
}

#[tauri::command]
pub fn ssh_resize(
    ssh: State<SshManager>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    ssh::resize(&ssh, &session_id, cols, rows)
}

#[tauri::command]
pub async fn ssh_exec(
    ssh: State<'_, SshManager>,
    session_id: String,
    command: String,
) -> Result<(i32, String), String> {
    ssh::exec(&ssh, &session_id, &command).await
}

#[tauri::command]
pub fn ssh_sessions(ssh: State<SshManager>) -> Vec<ssh::SessionInfo> {
    ssh.info()
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyAnswer {
    pub ticket: String,
    pub decision: HostKeyDecision,
}

#[tauri::command]
pub fn host_key_respond(
    pending: State<PendingHostKeys>,
    answer: HostKeyAnswer,
) -> Result<(), String> {
    let sender = pending
        .lock()
        .unwrap()
        .remove(&answer.ticket)
        .ok_or_else(|| "unknown_ticket".to_string())?;
    let _ = sender.send(answer.decision);
    Ok(())
}

// ---------------------------------------------------------------------------
// known_hosts management
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn known_hosts_list(
    known_hosts: State<Arc<KnownHosts>>,
) -> Result<Vec<KnownHostEntry>, String> {
    known_hosts.list()
}

#[tauri::command]
pub fn known_hosts_remove(
    known_hosts: State<'_, Arc<KnownHosts>>,
    host: String,
    port: u16,
) -> Result<usize, String> {
    known_hosts.remove_by_host(&host, port)
}

#[tauri::command]
pub fn known_hosts_import_system(known_hosts: State<'_, Arc<KnownHosts>>) -> Result<usize, String> {
    let path = crate::ssh::known_hosts::system_known_hosts_path().ok_or("cannot_resolve_home")?;
    if !path.exists() {
        return Ok(0);
    }
    known_hosts.import_from(&path)
}

// ---------------------------------------------------------------------------
// ssh_config import/export
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigImportResult {
    pub profiles: Vec<Profile>,
    pub warnings: Vec<String>,
    pub source: String,
}

#[tauri::command]
pub fn ssh_config_import() -> Result<SshConfigImportResult, String> {
    let path = dirs::home_dir()
        .ok_or_else(|| "cannot_resolve_home".to_string())?
        .join(".ssh")
        .join("config");
    if !path.exists() {
        return Ok(SshConfigImportResult {
            profiles: vec![],
            warnings: vec![],
            source: path.to_string_lossy().to_string(),
        });
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed = crate::ssh::ssh_config::parse(&text);
    Ok(SshConfigImportResult {
        profiles: crate::ssh::ssh_config::to_profiles(&parsed.entries),
        warnings: parsed.warnings,
        source: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn ssh_config_export(
    profiles: State<ProfileStore>,
    ids: Vec<String>,
) -> Result<String, String> {
    let all = profiles.list();
    let selected: Vec<Profile> = if ids.is_empty() {
        all
    } else {
        all.into_iter().filter(|p| ids.contains(&p.id)).collect()
    };
    Ok(crate::ssh::ssh_config::export(&selected))
}

// ---------------------------------------------------------------------------
// SFTP
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn sftp_open(
    ssh: State<'_, SshManager>,
    sftp: State<'_, SftpManager>,
    session_id: String,
) -> Result<String, String> {
    sftp.open(&ssh, &session_id).await
}

#[tauri::command]
pub async fn sftp_close(sftp: State<'_, SftpManager>, sftp_id: String) -> Result<(), String> {
    crate::sftp::close(&sftp, &sftp_id).await
}

#[tauri::command]
pub async fn sftp_list(
    sftp: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<crate::sftp::DirectoryListing, String> {
    let handle = sftp
        .get(&sftp_id)
        .ok_or_else(|| "sftp_session_not_found".to_string())?;
    crate::sftp::list(&handle, &path).await
}

#[tauri::command]
pub async fn sftp_mkdir(
    sftp: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    let handle = sftp
        .get(&sftp_id)
        .ok_or_else(|| "sftp_session_not_found".to_string())?;
    crate::sftp::mkdir(&handle, &path).await
}

#[tauri::command]
pub async fn sftp_rename(
    sftp: State<'_, SftpManager>,
    sftp_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let handle = sftp
        .get(&sftp_id)
        .ok_or_else(|| "sftp_session_not_found".to_string())?;
    crate::sftp::rename(&handle, &from, &to).await
}

#[tauri::command]
pub async fn sftp_delete(
    sftp: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let handle = sftp
        .get(&sftp_id)
        .ok_or_else(|| "sftp_session_not_found".to_string())?;
    crate::sftp::delete(&handle, &path, is_dir).await
}

#[tauri::command]
pub async fn sftp_chmod(
    sftp: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
    mode: u32,
) -> Result<(), String> {
    let handle = sftp
        .get(&sftp_id)
        .ok_or_else(|| "sftp_session_not_found".to_string())?;
    crate::sftp::chmod(&handle, &path, mode).await
}

#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    sftp: State<'_, SftpManager>,
    transfers: State<'_, Arc<TransferManager>>,
    sftp_id: String,
    local_path: String,
    remote_path: String,
) -> Result<String, String> {
    let handle = sftp
        .get(&sftp_id)
        .ok_or_else(|| "sftp_session_not_found".to_string())?;
    crate::sftp::upload(
        app,
        transfers.inner().clone(),
        handle,
        local_path,
        remote_path,
    )
    .await
}

#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    sftp: State<'_, SftpManager>,
    transfers: State<'_, Arc<TransferManager>>,
    sftp_id: String,
    remote_path: String,
    local_path: String,
) -> Result<String, String> {
    let handle = sftp
        .get(&sftp_id)
        .ok_or_else(|| "sftp_session_not_found".to_string())?;
    crate::sftp::download(
        app,
        transfers.inner().clone(),
        handle,
        remote_path,
        local_path,
    )
    .await
}

#[tauri::command]
pub fn transfer_cancel(
    transfers: State<Arc<TransferManager>>,
    transfer_id: String,
) -> Result<(), String> {
    transfers.cancel(&transfer_id)
}

#[tauri::command]
pub async fn sftp_read_text(
    sftp: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
    max_bytes: Option<u64>,
) -> Result<String, String> {
    let handle = sftp
        .get(&sftp_id)
        .ok_or_else(|| "sftp_session_not_found".to_string())?;
    crate::sftp::read_remote_text(&handle, &path, max_bytes.unwrap_or(10 * 1024 * 1024)).await
}

#[tauri::command]
pub async fn sftp_write_text(
    sftp: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let handle = sftp
        .get(&sftp_id)
        .ok_or_else(|| "sftp_session_not_found".to_string())?;
    crate::sftp::write_remote_text(&handle, &path, &content).await
}

// ---------------------------------------------------------------------------
// Monitoring (server health panel)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn monitoring_open(
    app: AppHandle,
    ssh: State<'_, SshManager>,
    monitoring: State<'_, MonitoringManager>,
    session_id: String,
) -> Result<(), String> {
    if ssh.get(&session_id).is_none() {
        return Err("session_not_found".to_string());
    }
    monitoring.ensure_started(app, &session_id);
    Ok(())
}

#[tauri::command]
pub fn monitoring_close(monitoring: State<MonitoringManager>, session_id: String) {
    monitoring.stop(&session_id);
}

#[tauri::command]
pub fn monitoring_is_open(monitoring: State<MonitoringManager>, session_id: String) -> bool {
    monitoring.is_running(&session_id)
}

// ---------------------------------------------------------------------------
// Local filesystem
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn local_list(path: String) -> Result<localfs::LocalListing, String> {
    localfs::list(&path)
}

#[tauri::command]
pub fn local_home() -> Result<String, String> {
    localfs::home()
}

#[tauri::command]
pub fn local_mkdir(path: String) -> Result<(), String> {
    localfs::mkdir(&path)
}

#[tauri::command]
pub fn local_rename(from: String, to: String) -> Result<(), String> {
    localfs::rename(&from, &to)
}

#[tauri::command]
pub fn local_delete(path: String, is_dir: bool) -> Result<(), String> {
    localfs::delete(&path, is_dir)
}

// ---------------------------------------------------------------------------
// Settings & misc
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn settings_get(settings: State<SettingsStore>) -> AppSettings {
    settings.get()
}

#[tauri::command]
pub async fn settings_set(
    settings: State<'_, SettingsStore>,
    value: AppSettings,
) -> Result<(), String> {
    settings.set(value)
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}
