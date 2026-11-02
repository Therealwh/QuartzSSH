//! OpenSSH-compatible known_hosts storage.
//!
//! Supports plain (`host keytype base64`) and hashed (`|1|salt|hash`) entries
//! for reading; new entries are written in plain form. Verification uses the
//! SHA-256 fingerprint of the presented key.

use base64::Engine;
use hmac::Mac;
use russh::keys::ssh_key;
use sha1::Sha1;
use ssh_key::HashAlg;
use std::path::PathBuf;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostEntry {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
    /// Raw line as stored (used for removal).
    pub raw: String,
}

pub enum HostKeyStatus {
    /// The exact key is already known and trusted.
    Known,
    /// No entry for this host yet.
    New,
    /// An entry exists but with a different key — possible MITM.
    Changed(String),
}

pub struct KnownHosts {
    path: PathBuf,
}

impl KnownHosts {
    pub fn new(path: PathBuf) -> Self {
        KnownHosts { path }
    }

    fn read_lines(&self) -> Vec<String> {
        std::fs::read_to_string(&self.path)
            .map(|content| {
                content
                    .lines()
                    .map(str::trim)
                    .filter(|l| !l.is_empty() && !l.starts_with('#'))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    }

    fn write_lines(&self, lines: &[String]) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut content = lines.join("\n");
        if !content.is_empty() {
            content.push('\n');
        }
        std::fs::write(&self.path, content).map_err(|e| e.to_string())
    }

    /// OpenSSH host pattern for host:port — `[host]:port` unless port is 22.
    pub fn host_pattern(host: &str, port: u16) -> String {
        if port == 22 {
            host.to_string()
        } else {
            format!("[{host}]:{port}")
        }
    }

    fn key_blob(key: &ssh_key::PublicKey) -> String {
        key.to_openssh().unwrap_or_default()
    }

    pub fn check(
        &self,
        host: &str,
        port: u16,
        key: &ssh_key::PublicKey,
    ) -> Result<HostKeyStatus, String> {
        let pattern = Self::host_pattern(host, port);
        let blob = Self::key_blob(key);
        let mut found_any = false;
        for line in self.read_lines() {
            let (hosts_part, key_part) = match split_entry(&line) {
                Some(v) => v,
                None => continue,
            };
            if !matches_pattern(&hosts_part, &pattern)? {
                continue;
            }
            found_any = true;
            if key_part == blob {
                return Ok(HostKeyStatus::Known);
            }
        }
        if found_any {
            Ok(HostKeyStatus::Changed(self.stored_fingerprint(host, port)?))
        } else {
            Ok(HostKeyStatus::New)
        }
    }

    /// Fingerprint of the currently stored key for this host (any type).
    fn stored_fingerprint(&self, host: &str, port: u16) -> Result<String, String> {
        let pattern = Self::host_pattern(host, port);
        for line in self.read_lines() {
            let (hosts_part, key_part) = match split_entry(&line) {
                Some(v) => v,
                None => continue,
            };
            if !matches_pattern(&hosts_part, &pattern)? {
                continue;
            }
            if let Some(fp) = fingerprint_of_blob(&key_part) {
                return Ok(fp);
            }
        }
        Ok(String::new())
    }

    pub fn add(&self, host: &str, port: u16, key: &ssh_key::PublicKey) -> Result<(), String> {
        let pattern = Self::host_pattern(host, port);
        let blob = Self::key_blob(key);
        // Replace an existing entry for this host instead of appending a duplicate.
        let mut lines: Vec<String> = self
            .read_lines()
            .into_iter()
            .filter(|line| {
                split_entry(line)
                    .map(|(hosts, _)| !matches_pattern(&hosts, &pattern).unwrap_or(false))
                    .unwrap_or(true)
            })
            .collect();
        lines.push(format!("{pattern} {blob}"));
        self.write_lines(&lines)
    }

    pub fn remove_by_host(&self, host: &str, port: u16) -> Result<usize, String> {
        let pattern = Self::host_pattern(host, port);
        let kept: Vec<String> = self
            .read_lines()
            .into_iter()
            .filter(|line| {
                split_entry(line)
                    .map(|(hosts, _)| !matches_pattern(&hosts, &pattern).unwrap_or(false))
                    .unwrap_or(true)
            })
            .collect();
        let removed = self.read_lines().len() - kept.len();
        self.write_lines(&kept)?;
        Ok(removed)
    }

    pub fn list(&self) -> Result<Vec<KnownHostEntry>, String> {
        let mut out = Vec::new();
        for line in self.read_lines() {
            let (hosts_part, key_part) = match split_entry(&line) {
                Some(v) => v,
                None => continue,
            };
            // Plain entries only for the interactive list; hashed ones are
            // still honored during verification but cannot be displayed usefully.
            if hosts_part.starts_with('|') {
                continue;
            }
            let (key_type, _blob) = match parse_key_blob(&key_part) {
                Some(v) => v,
                None => continue,
            };
            let (host, port) = parse_host_pattern(&hosts_part);
            let fingerprint = fingerprint_of_blob(&key_part).unwrap_or_default();
            out.push(KnownHostEntry {
                host,
                port,
                key_type,
                fingerprint,
                raw: line.clone(),
            });
        }
        Ok(out)
    }

    /// Import entries from a system `known_hosts` file, skipping duplicates.
    pub fn import_from(&self, source: &PathBuf) -> Result<usize, String> {
        let existing = self.read_lines();
        let existing_set: std::collections::HashSet<String> = existing.iter().cloned().collect();
        let content = std::fs::read_to_string(source).map_err(|e| e.to_string())?;
        let mut added = 0;
        let mut lines = existing;
        for line in content.lines().map(str::trim) {
            if line.is_empty() || line.starts_with('#') || existing_set.contains(line) {
                continue;
            }
            lines.push(line.to_string());
            added += 1;
        }
        if added > 0 {
            self.write_lines(&lines)?;
        }
        Ok(added)
    }
}

/// Split a known_hosts line into (host patterns, key blob).
/// Handles `@cert-authority`/`@revoked` markers by ignoring such lines.
fn split_entry(line: &str) -> Option<(String, String)> {
    if line.starts_with('@') {
        return None;
    }
    let mut parts = line.splitn(3, ' ');
    let hosts = parts.next()?.to_string();
    let key = parts.next()?.to_string();
    Some((hosts, key))
}

fn parse_key_blob(blob: &str) -> Option<(String, String)> {
    let mut it = blob.splitn(2, ' ');
    let key_type = it.next()?.to_string();
    let rest = it.next().unwrap_or("").trim().to_string();
    Some((key_type, rest))
}

/// `keytype base64` -> SHA256 fingerprint (`SHA256:...`), like ssh-keygen -lf.
pub fn fingerprint_of_blob(blob: &str) -> Option<String> {
    let (_key_type, b64) = parse_key_blob(blob)?;
    let decoded = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
    let key = ssh_key::PublicKey::from_bytes(&decoded).ok()?;
    Some(key.fingerprint(HashAlg::Sha256).to_string())
}

fn parse_host_pattern(pattern: &str) -> (String, u16) {
    if let Some(rest) = pattern.strip_prefix('[') {
        if let Some((host, port)) = rest.split_once("]:") {
            return (host.to_string(), port.parse().unwrap_or(22));
        }
    }
    (pattern.to_string(), 22)
}

/// Match a comma-separated list of host patterns against `host`.
/// Supports plain names and `|1|salt|hash` hashed hostnames (HMAC-SHA1).
fn matches_pattern(patterns: &str, host: &str) -> Result<bool, String> {
    for pattern in patterns.split(',') {
        let pattern = pattern.trim();
        if pattern.starts_with("|1|") {
            if hashed_pattern_matches(pattern, host)? {
                return Ok(true);
            }
        } else if pattern.eq_ignore_ascii_case(host) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn hashed_pattern_matches(pattern: &str, host: &str) -> Result<bool, String> {
    // |1|base64-salt|base64-hmac-sha1(host)
    let parts: Vec<&str> = pattern.split('|').collect();
    if parts.len() != 4 {
        return Ok(false);
    }
    let salt = base64::engine::general_purpose::STANDARD
        .decode(parts[2])
        .map_err(|e| e.to_string())?;
    let expected = base64::engine::general_purpose::STANDARD
        .decode(parts[3])
        .map_err(|e| e.to_string())?;
    let mut mac = hmac::Hmac::<Sha1>::new_from_slice(&salt).map_err(|e| e.to_string())?;
    mac.update(host.as_bytes());
    Ok(mac.finalize().into_bytes().as_slice() == expected.as_slice())
}

/// Load the user's system known_hosts path (`~/.ssh/known_hosts`).
pub fn system_known_hosts_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh").join("known_hosts"))
}
