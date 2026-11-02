mod commands;
mod config;
mod localfs;
mod mcp;
mod monitoring;
mod sftp;
mod ssh;

use config::{ProfileStore, SettingsStore};
use sftp::{SftpManager, TransferManager};
use ssh::known_hosts::KnownHosts;
use ssh::{PendingHostKeys, SshManager};
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
            std::fs::create_dir_all(&data_dir).ok();

            app.manage(ProfileStore::load(&data_dir));
            app.manage(SettingsStore::load(&data_dir));
            app.manage(Arc::new(KnownHosts::new(data_dir.join("known_hosts"))));
            app.manage::<PendingHostKeys>(Arc::new(std::sync::Mutex::new(
                std::collections::HashMap::new(),
            )));
            app.manage(SshManager::default());
            app.manage(SftpManager::default());
            app.manage(Arc::new(TransferManager::default()));
            app.manage(Arc::new(mcp::McpState::default()));
            app.manage(monitoring::MonitoringManager::default());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::profile_list,
            commands::profile_save,
            commands::profile_delete,
            commands::ssh_connect,
            commands::ssh_disconnect,
            commands::ssh_write,
            commands::ssh_resize,
            commands::ssh_exec,
            commands::ssh_sessions,
            commands::host_key_respond,
            commands::known_hosts_list,
            commands::known_hosts_remove,
            commands::known_hosts_import_system,
            commands::ssh_config_import,
            commands::ssh_config_export,
            commands::sftp_open,
            commands::sftp_close,
            commands::sftp_list,
            commands::sftp_mkdir,
            commands::sftp_rename,
            commands::sftp_delete,
            commands::sftp_chmod,
            commands::sftp_upload,
            commands::sftp_download,
            commands::transfer_cancel,
            commands::sftp_read_text,
            commands::sftp_write_text,
            commands::sftp_read_file,
            commands::sftp_write_file,
            commands::monitoring_open,
            commands::monitoring_close,
            commands::monitoring_is_open,
            commands::local_list,
            commands::local_home,
            commands::local_mkdir,
            commands::local_rename,
            commands::local_delete,
            commands::settings_get,
            commands::settings_set,
            commands::app_version,
            mcp::mcp_start,
            mcp::mcp_stop,
            mcp::mcp_status,
            mcp::mcp_audit_list,
            mcp::mcp_audit_clear,
            mcp::mcp_confirm,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
