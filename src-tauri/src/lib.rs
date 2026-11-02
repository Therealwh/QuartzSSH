mod commands;
mod config;
mod forward;
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
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// Tooltip of the tray icon.
const TRAY_TOOLTIP: &str = "QuartzSSH";
const TRAY_OPEN_ID: &str = "quartzssh-open";
const TRAY_QUIT_ID: &str = "quartzssh-quit";

/// The backend has no access to the frontend i18n store (UI language lives in
/// localStorage), so the tray uses neutral English labels. The matching
/// `tray.*` keys in src/i18n/{ru,en}.json document them for the settings UI.
const TRAY_OPEN_LABEL: &str = "Open QuartzSSH";
const TRAY_QUIT_LABEL: &str = "Quit";

/// Show (and un-minimize) the main window and give it focus. Used by the tray
/// menu and by left clicks on the tray icon.
fn show_main_window(window: &tauri::WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// Build the tray icon: it is always created, both for the regular mode
/// (quick access) and for the headless background mode (spec 26.6), where the
/// window is closed while background MCP servers and SSH sessions keep running.
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(
        app,
        TRAY_OPEN_ID,
        TRAY_OPEN_LABEL,
        true,
        Option::<&str>::None,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(
        app,
        TRAY_QUIT_ID,
        TRAY_QUIT_LABEL,
        true,
        Option::<&str>::None,
    )?;
    let menu = Menu::with_items(app, &[&open, &separator, &quit])?;

    TrayIconBuilder::new()
        .icon(tauri::include_image!("icons/32x32.png"))
        .tooltip(TRAY_TOOLTIP)
        .menu(&menu)
        // Left click restores the window; the menu opens on right click.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id() == TRAY_OPEN_ID {
                if let Some(window) = app.get_webview_window("main") {
                    show_main_window(&window);
                }
            } else if event.id() == TRAY_QUIT_ID {
                app.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            // React on release (Up) to match the usual click semantics.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    show_main_window(&window);
                }
            }
        })
        .build(app)?;
    Ok(())
}

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
            app.manage(forward::ForwardManager::default());

            setup_tray(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Spec 26.6 "close to tray": when enabled, closing the window
            // hides it instead of quitting, so the MCP server and active
            // SSH sessions keep running in the background.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = window
                    .app_handle()
                    .state::<SettingsStore>()
                    .get()
                    .close_to_tray;
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
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
            commands::ssh_kex_info,
            commands::key_inspect,
            commands::host_key_respond,
            commands::known_hosts_list,
            commands::known_hosts_remove,
            commands::known_hosts_import_system,
            commands::ssh_config_import,
            commands::ssh_config_export,
            commands::ssh_config_status,
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
            forward::forward_add,
            forward::forward_remove,
            forward::forward_list,
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
