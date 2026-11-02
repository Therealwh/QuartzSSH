//! Import/export of the OpenSSH client configuration (`~/.ssh/config`).
//!
//! The import is a preview: it returns candidate profiles plus warnings for
//! directives that cannot be translated safely (ProxyCommand, Match blocks).
//! Export never includes passwords — only key paths.

use crate::config::{AuthMethod, Profile};

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigImportEntry {
    pub host_patterns: String,
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_files: Vec<String>,
    pub identities_only: bool,
    pub proxy_jump: Option<String>,
    pub server_alive_interval: Option<u32>,
    pub server_alive_count_max: Option<u32>,
    pub compression: Option<bool>,
    pub forward_agent: Option<bool>,
    pub forward_x11: Option<bool>,
}

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigImport {
    pub entries: Vec<ConfigImportEntry>,
    pub warnings: Vec<String>,
}

/// Parse the content of an ssh_config file.
pub fn parse(text: &str) -> ConfigImport {
    let mut result = ConfigImport::default();
    let mut current: Option<ConfigImportEntry> = None;
    let mut in_match_block = false;

    for (idx, raw_line) in text.lines().enumerate() {
        let line = strip_comment(raw_line);
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let (keyword, value) = match split_kw(line) {
            Some(v) => v,
            None => continue,
        };
        let kw = keyword.to_ascii_lowercase();

        if in_match_block {
            // Consume everything until the next Host/Match directive.
            if kw == "host" || kw == "match" {
                in_match_block = false;
            } else {
                continue;
            }
        }

        match kw.as_str() {
            "host" => {
                if let Some(entry) = current.take() {
                    result.entries.push(entry);
                }
                current = Some(ConfigImportEntry {
                    host_patterns: value.to_string(),
                    ..Default::default()
                });
            }
            "match" => {
                if let Some(entry) = current.take() {
                    result.entries.push(entry);
                }
                in_match_block = true;
                result
                    .warnings
                    .push(format!("line {}: Match block skipped", idx + 1));
            }
            "proxycommand" => {
                result.warnings.push(format!(
                    "line {}: ProxyCommand skipped (cannot be interpreted safely)",
                    idx + 1
                ));
            }
            _ if current.is_none() => {
                // Global directives before any Host — ignored.
            }
            "hostname" => set(current.as_mut(), |e| e.hostname = Some(value.to_string())),
            "user" => set(current.as_mut(), |e| e.user = Some(value.to_string())),
            "port" => match value.parse::<u16>() {
                Ok(p) => set(current.as_mut(), |e| e.port = Some(p)),
                Err(_) => result
                    .warnings
                    .push(format!("line {}: invalid port value", idx + 1)),
            },
            "identityfile" => set(current.as_mut(), |e| {
                e.identity_files.push(expand_tilde(value))
            }),
            "identitiesonly" => set(current.as_mut(), |e| e.identities_only = value == "yes"),
            "proxyjump" => set(current.as_mut(), |e| e.proxy_jump = Some(value.to_string())),
            "serveraliveinterval" => match value.parse::<u32>() {
                Ok(v) => set(current.as_mut(), |e| e.server_alive_interval = Some(v)),
                Err(_) => result
                    .warnings
                    .push(format!("line {}: invalid ServerAliveInterval", idx + 1)),
            },
            "serveralivecountmax" => match value.parse::<u32>() {
                Ok(v) => set(current.as_mut(), |e| e.server_alive_count_max = Some(v)),
                Err(_) => result
                    .warnings
                    .push(format!("line {}: invalid ServerAliveCountMax", idx + 1)),
            },
            "compression" => set(current.as_mut(), |e| e.compression = Some(value == "yes")),
            "forwardagent" => set(current.as_mut(), |e| e.forward_agent = Some(value == "yes")),
            "forwardx11" => set(current.as_mut(), |e| e.forward_x11 = Some(value == "yes")),
            _ => {
                // Unknown directives are silently ignored (ssh itself does the same).
            }
        }
    }
    if let Some(entry) = current.take() {
        result.entries.push(entry);
    }
    result
}

fn set(entry: Option<&mut ConfigImportEntry>, f: impl FnOnce(&mut ConfigImportEntry)) {
    if let Some(e) = entry {
        f(e);
    }
}

fn strip_comment(line: &str) -> &str {
    // ssh_config comments start with '#' at the beginning of a line or after
    // whitespace; values may contain '#', so only split at a whitespace boundary.
    match line.find(" #") {
        Some(i) => &line[..i],
        None => match line.strip_prefix('#') {
            Some(_) => "",
            None => line,
        },
    }
}

fn split_kw(line: &str) -> Option<(&str, &str)> {
    let mut parts = line.splitn(2, ['=', ' ']);
    let keyword = parts.next()?.trim();
    let value = parts.next()?.trim();
    if keyword.is_empty() || value.is_empty() {
        return None;
    }
    // Values may be quoted.
    let value = value.trim_matches('"');
    Some((keyword, value))
}

pub fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().to_string();
        }
    }
    path.to_string()
}

/// Convert imported entries into candidate profiles (not persisted here).
pub fn to_profiles(entries: &[ConfigImportEntry]) -> Vec<Profile> {
    let now = chrono::Utc::now().timestamp();
    entries
        .iter()
        .filter(|e| !e.host_patterns.contains('*') && !e.host_patterns.contains('?'))
        .map(|e| {
            let auth = if e.identity_files.is_empty() {
                AuthMethod::Password {
                    save_password: false,
                }
            } else {
                AuthMethod::PublicKey {
                    key_path: Some(e.identity_files[0].clone()),
                    save_passphrase: false,
                    identities_only: e.identities_only,
                }
            };
            Profile {
                id: uuid::Uuid::new_v4().to_string(),
                name: e
                    .host_patterns
                    .split(',')
                    .next()
                    .unwrap_or("host")
                    .trim()
                    .to_string(),
                group: String::from("Imported"),
                host: e
                    .hostname
                    .clone()
                    .unwrap_or_else(|| e.host_patterns.clone()),
                port: e.port.unwrap_or(22),
                username: e.user.clone().unwrap_or_default(),
                auth,
                keepalive_seconds: e.server_alive_interval.unwrap_or(30).clamp(10, 600),
                auto_reconnect: true,
                created_at: now,
                updated_at: now,
            }
        })
        .collect()
}

/// Export selected profiles in ssh_config format. Never includes secrets.
pub fn export(profiles: &[Profile]) -> String {
    let mut out = String::from("# Generated by QuartzSSH. Secrets are never exported.\n\n");
    for p in profiles {
        out.push_str(&format!("Host {}\n", sanitize(p.name.trim())));
        out.push_str(&format!("    HostName {}\n", p.host));
        out.push_str(&format!("    User {}\n", p.username));
        out.push_str(&format!("    Port {}\n", p.port));
        if let AuthMethod::PublicKey {
            key_path: Some(path),
            identities_only,
            ..
        } = &p.auth
        {
            out.push_str(&format!("    IdentityFile {}\n", path));
            out.push_str(&format!(
                "    IdentitiesOnly {}\n",
                if *identities_only { "yes" } else { "no" }
            ));
        }
        if p.keepalive_seconds > 0 {
            out.push_str(&format!(
                "    ServerAliveInterval {}\n",
                p.keepalive_seconds
            ));
            out.push_str("    ServerAliveCountMax 3\n");
        }
        out.push('\n');
    }
    out
}

fn sanitize(name: &str) -> String {
    name.replace([' ', '\t', '#'], "-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_config() {
        let text = r#"
# comment
Host web
    HostName example.com
    User alice
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    Compression yes

Host * !bastion
    ServerAliveInterval 60
"#;
        let parsed = parse(text);
        assert_eq!(parsed.entries.len(), 2);
        let web = &parsed.entries[0];
        assert_eq!(web.hostname.as_deref(), Some("example.com"));
        assert_eq!(web.user.as_deref(), Some("alice"));
        assert_eq!(web.port, Some(2222));
        assert_eq!(web.identity_files.len(), 1);
        assert!(web.identities_only);
        assert_eq!(web.compression, Some(true));
        assert!(parsed.warnings.is_empty());
    }

    #[test]
    fn skips_match_and_proxycommand_with_warnings() {
        let text = r#"
Host jump
    HostName j.example.com

Match user bob
    ProxyCommand nc %h %p

Host db
    ProxyCommand corkscrew proxy 3128 %h %p
    HostName db.internal
"#;
        let parsed = parse(text);
        assert_eq!(parsed.entries.len(), 2);
        assert_eq!(parsed.warnings.len(), 2);
        // Directives inside the Match block must not leak into other entries.
        assert!(parsed.entries.iter().all(|e| e.hostname.is_some()));
    }

    #[test]
    fn handles_equals_syntax_and_quotes() {
        let text = "Host=q\nHostName=\"quoted.example\"\nUser=bob";
        let parsed = parse(text);
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(
            parsed.entries[0].hostname.as_deref(),
            Some("quoted.example")
        );
        assert_eq!(parsed.entries[0].user.as_deref(), Some("bob"));
    }

    #[test]
    fn export_roundtrip_has_no_secrets() {
        let profile = Profile {
            id: "1".into(),
            name: "prod".into(),
            group: Default::default(),
            host: "prod.example.com".into(),
            port: 22,
            username: "deploy".into(),
            auth: AuthMethod::Password {
                save_password: true,
            },
            keepalive_seconds: 30,
            auto_reconnect: true,
            created_at: 0,
            updated_at: 0,
        };
        let text = export(&[profile]);
        assert!(text.contains("HostName prod.example.com"));
        assert!(!text.contains("password"));
        assert!(!text.to_lowercase().contains("save"));
    }

    #[test]
    fn to_profiles_skips_wildcards() {
        let entries = parse("Host web1\nHostName w1\nUser u\n\nHost *\nHostName x\n").entries;
        let profiles = to_profiles(&entries);
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].host, "w1");
    }
}
