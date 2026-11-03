use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;

const KEYRING_SERVICE: &str = "QuartzSSH";

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AuthMethod {
    Password {
        /// A password is stored in the OS credential store for this profile.
        #[serde(default)]
        save_password: bool,
    },
    #[serde(rename_all = "camelCase")]
    PublicKey {
        #[serde(default)]
        key_path: Option<String>,
        #[serde(default)]
        save_passphrase: bool,
        #[serde(default = "default_true")]
        identities_only: bool,
    },
}

fn default_true() -> bool {
    true
}

impl Default for AuthMethod {
    fn default() -> Self {
        AuthMethod::Password {
            save_password: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub group: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub auth: AuthMethod,
    #[serde(default = "default_keepalive")]
    pub keepalive_seconds: u32,
    #[serde(default = "default_true")]
    pub auto_reconnect: bool,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

fn default_keepalive() -> u32 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub group: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub auth: AuthMethod,
    #[serde(default)]
    pub keepalive_seconds: Option<u32>,
    #[serde(default)]
    pub auto_reconnect: Option<bool>,
    /// When present, the password is (re)stored in the OS credential store
    /// and never persisted to disk. `None` keeps the stored one (if any).
    #[serde(default)]
    pub password: Option<Option<String>>,
    #[serde(default)]
    pub key_passphrase: Option<Option<String>>,
}

pub struct ProfileStore {
    path: PathBuf,
    profiles: RwLock<Vec<Profile>>,
}

impl ProfileStore {
    pub fn load(data_dir: &std::path::Path) -> Self {
        let path = data_dir.join("profiles.json");
        let profiles = std::fs::read(&path)
            .ok()
            .and_then(|data| serde_json::from_slice::<Vec<Profile>>(&data).ok())
            .unwrap_or_default();
        ProfileStore {
            path,
            profiles: RwLock::new(profiles),
        }
    }

    fn persist(&self, profiles: &[Profile]) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let data = serde_json::to_vec_pretty(profiles).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, data).map_err(|e| e.to_string())
    }

    pub fn list(&self) -> Vec<Profile> {
        self.profiles.read().unwrap().clone()
    }

    pub fn get(&self, id: &str) -> Option<Profile> {
        self.profiles
            .read()
            .unwrap()
            .iter()
            .find(|p| p.id == id)
            .cloned()
    }

    pub fn upsert(&self, profile: Profile) -> Result<(), String> {
        let mut guard = self.profiles.write().unwrap();
        match guard.iter_mut().find(|p| p.id == profile.id) {
            Some(existing) => *existing = profile,
            None => guard.push(profile),
        }
        self.persist(&guard)
    }

    pub fn delete(&self, id: &str) -> Result<bool, String> {
        let mut guard = self.profiles.write().unwrap();
        let before = guard.len();
        guard.retain(|p| p.id != id);
        let removed = guard.len() != before;
        if removed {
            self.persist(&guard)?;
        }
        Ok(removed)
    }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum HostKeyMode {
    /// Default. Known keys are trusted, new keys require explicit confirmation
    /// (TOFU with consent), changed keys are rejected until the user explicitly
    /// accepts the risk.
    #[default]
    Strict,
    /// Trust on first use: a new key is pinned silently, changed keys still ask.
    AcceptFirst,
    /// Accept everything. Debugging only, never exposed in the UI.
    NonStrict,
}

/// How eagerly the optional MCP bridge asks the user before running a tool.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum McpConfirmationMode {
    /// Ask before every tool call.
    Always,
    /// Ask only for potentially destructive operations (default).
    #[default]
    Destructive,
    /// Never ask. Every tool call runs immediately — not recommended.
    Never,
}

/// Settings of the optional embedded MCP server ("QuartzSSH as a bridge for
/// AI agents"). The bridge is disabled by default and never listens on a
/// port until the user explicitly presses "Start" in the settings; `enabled`
/// only records the user's opt-in (the first-enable warning is shown once).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpSettings {
    #[serde(default)]
    pub enabled: bool,
    /// TCP port on 127.0.0.1. Valid range is 47200-47300 (enforced on start).
    #[serde(default = "default_mcp_port")]
    pub port: u16,
    /// Profiles the bridge is allowed to touch. Empty = nothing is exposed.
    #[serde(default)]
    pub allowlist_profile_ids: Vec<String>,
    #[serde(default)]
    pub confirmation_mode: McpConfirmationMode,
}

impl Default for McpSettings {
    fn default() -> Self {
        McpSettings {
            enabled: false,
            port: 47215,
            allowlist_profile_ids: Vec::new(),
            confirmation_mode: McpConfirmationMode::Destructive,
        }
    }
}

fn default_mcp_port() -> u16 {
    47215
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub host_key_mode: HostKeyMode,
    /// Prefer post-quantum key exchange (mlkem768x25519-sha256) when supported.
    pub prefer_pq_kex: bool,
    pub auto_reconnect: bool,
    pub reconnect_delay_seconds: u32,
    pub check_updates_on_start: bool,
    pub update_check_interval_minutes: u32,
    /// Keep the app running in the background (tray icon) when the window is
    /// closed. Required for the headless MCP server and active SSH sessions.
    #[serde(default)]
    pub close_to_tray: bool,
    /// Optional MCP bridge; disabled by default.
    #[serde(default)]
    pub mcp: McpSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            host_key_mode: HostKeyMode::Strict,
            prefer_pq_kex: true,
            auto_reconnect: true,
            reconnect_delay_seconds: 5,
            check_updates_on_start: true,
            update_check_interval_minutes: 12 * 60,
            close_to_tray: false,
            mcp: McpSettings::default(),
        }
    }
}

pub struct SettingsStore {
    path: PathBuf,
    settings: RwLock<AppSettings>,
}

impl SettingsStore {
    pub fn load(data_dir: &std::path::Path) -> Self {
        let path = data_dir.join("settings.json");
        let settings = std::fs::read(&path)
            .ok()
            .and_then(|data| serde_json::from_slice::<AppSettings>(&data).ok())
            .unwrap_or_default();
        SettingsStore {
            path,
            settings: RwLock::new(settings),
        }
    }

    pub fn get(&self) -> AppSettings {
        self.settings.read().unwrap().clone()
    }

    pub fn set(&self, settings: AppSettings) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let data = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, data).map_err(|e| e.to_string())?;
        *self.settings.write().unwrap() = settings;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// OS credential store (passwords and key passphrases never touch the disk)
// ---------------------------------------------------------------------------

fn secret_account(profile_id: &str, kind: &str) -> String {
    format!("profile:{profile_id}:{kind}")
}

pub fn set_secret(account: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())?;
    entry.set_password(value).map_err(|e| e.to_string())
}

pub fn get_secret(account: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete_secret(account: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn store_profile_password(profile_id: &str, password: &str) -> Result<(), String> {
    set_secret(&secret_account(profile_id, "password"), password)
}

pub fn load_profile_password(profile_id: &str) -> Result<Option<String>, String> {
    get_secret(&secret_account(profile_id, "password"))
}

pub fn drop_profile_password(profile_id: &str) -> Result<(), String> {
    delete_secret(&secret_account(profile_id, "password"))
}

pub fn store_key_passphrase(profile_id: &str, passphrase: &str) -> Result<(), String> {
    set_secret(&secret_account(profile_id, "keypass"), passphrase)
}

pub fn load_key_passphrase(profile_id: &str) -> Result<Option<String>, String> {
    get_secret(&secret_account(profile_id, "keypass"))
}

pub fn drop_key_passphrase(profile_id: &str) -> Result<(), String> {
    delete_secret(&secret_account(profile_id, "keypass"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_to_tray_defaults_to_false() {
        let settings = AppSettings::default();
        assert!(!settings.close_to_tray);
    }

    #[test]
    fn close_to_tray_missing_in_json_defaults_to_false() {
        // Backward compatibility: settings.json written before close_to_tray
        // existed must still load, with the background mode off.
        let json = r#"{
            "hostKeyMode": "strict",
            "preferPqKex": true,
            "autoReconnect": true,
            "reconnectDelaySeconds": 5,
            "checkUpdatesOnStart": true,
            "updateCheckIntervalMinutes": 720
        }"#;
        let settings: AppSettings = serde_json::from_str(json).expect("legacy settings parse");
        assert!(!settings.close_to_tray);
    }

    #[test]
    fn settings_with_close_to_tray_and_mcp_serde_roundtrip() {
        let settings = AppSettings {
            close_to_tray: true,
            mcp: McpSettings {
                enabled: true,
                port: 47300,
                allowlist_profile_ids: vec!["prof-1".into(), "prof-2".into()],
                confirmation_mode: McpConfirmationMode::Never,
            },
            ..AppSettings::default()
        };

        let json = serde_json::to_string(&settings).expect("serialize");
        // camelCase naming for the new field, as for the rest of the struct.
        assert!(
            json.contains("\"closeToTray\":true"),
            "expected closeToTray key in {json}"
        );

        let back: AppSettings = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, settings);
        assert!(back.close_to_tray);
        assert_eq!(back.mcp, settings.mcp);
    }
}

#[cfg(test)]
mod auth_serde_tests {
    use super::*;

    /// Exact JSON payload the ConnectDialog sends for password auth.
    #[test]
    fn profile_input_deserializes_from_frontend_payload() {
        let json = r#"{
            "name": "test",
            "group": "",
            "host": "13.143.164.195",
            "port": 22,
            "username": "root",
            "auth": { "kind": "password", "savePassword": false },
            "keepaliveSeconds": 30,
            "autoReconnect": true
        }"#;
        let input: ProfileInput =
            serde_json::from_str(json).expect("ProfileInput deserialization failed");
        match &input.auth {
            AuthMethod::Password { save_password } => assert!(!save_password),
            other => panic!("wrong auth variant: {other:?}"),
        }
    }

    /// Key auth payload: camelCase fields must map (keyPath was silently
    /// dropped before the rename_all_fields fix).
    #[test]
    fn public_key_auth_maps_camel_case_fields() {
        let json = r#"{
            "name": "k",
            "group": "",
            "host": "h",
            "port": 22,
            "username": "u",
            "auth": {
                "kind": "publicKey",
                "keyPath": "C:/keys/id_ed25519",
                "savePassphrase": true,
                "identitiesOnly": false
            }
        }"#;
        let input: ProfileInput = serde_json::from_str(json).expect("deserialization failed");
        match &input.auth {
            AuthMethod::PublicKey {
                key_path,
                save_passphrase,
                identities_only,
            } => {
                assert_eq!(key_path.as_deref(), Some("C:/keys/id_ed25519"));
                assert!(*save_passphrase);
                assert!(!*identities_only);
            }
            other => panic!("wrong auth variant: {other:?}"),
        }
    }

    /// Round-trip: serialize a Profile and deserialize the ProfileInput from
    /// its JSON (the edit-dialog path reuses the same wire format).
    #[test]
    fn auth_method_roundtrips_camel_case() {
        let original = AuthMethod::PublicKey {
            key_path: Some("/home/u/k".into()),
            save_passphrase: false,
            identities_only: true,
        };
        let json = serde_json::to_string(&original).expect("serialize");
        assert!(json.contains("keyPath"));
        assert!(json.contains("savePassphrase"));
        assert!(json.contains("identitiesOnly"));
        let back: AuthMethod = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(original, back);
    }
}
