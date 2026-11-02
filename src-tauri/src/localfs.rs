//! Local filesystem access for the local pane of the SFTP manager.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// Modification time, epoch seconds.
    pub modified: i64,
    pub readonly: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalListing {
    pub path: String,
    pub entries: Vec<LocalEntry>,
}

fn entry_from(path: &Path, md: &std::fs::Metadata) -> LocalEntry {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    let modified = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    LocalEntry {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir: md.is_dir(),
        size: if md.is_dir() { 0 } else { md.len() },
        modified,
        readonly: md.permissions().readonly(),
    }
}

/// Windows drive letters as pseudo-entries when the requested path is empty.
fn list_drives() -> Vec<LocalEntry> {
    let mut out = Vec::new();
    for letter in b'A'..=b'Z' {
        let root = format!("{letter}:\\");
        let path = PathBuf::from(&root);
        if path.is_dir() {
            out.push(LocalEntry {
                name: format!("{letter}:"),
                path: root,
                is_dir: true,
                size: 0,
                modified: 0,
                readonly: false,
            });
        }
    }
    out
}

pub fn list(path: &str) -> Result<LocalListing, String> {
    if path.is_empty() {
        if cfg!(windows) {
            return Ok(LocalListing {
                path: String::new(),
                entries: list_drives(),
            });
        }
        return list("/");
    }
    let dir = PathBuf::from(path);
    let mut out = Vec::new();
    let rd = std::fs::read_dir(&dir).map_err(|e| format!("local_list_failed: {e}"))?;
    for item in rd {
        let Ok(item) = item else { continue };
        let Ok(md) = item.metadata() else { continue };
        out.push(entry_from(&item.path(), &md));
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(LocalListing {
        path: dir.to_string_lossy().to_string(),
        entries: out,
    })
}

pub fn home() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "cannot_resolve_home".into())
}

pub fn mkdir(path: &str) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|e| format!("local_mkdir_failed: {e}"))
}

pub fn rename(from: &str, to: &str) -> Result<(), String> {
    std::fs::rename(from, to).map_err(|e| format!("local_rename_failed: {e}"))
}

pub fn delete(path: &str, is_dir: bool) -> Result<(), String> {
    if is_dir {
        std::fs::remove_dir_all(path).map_err(|e| format!("local_delete_failed: {e}"))
    } else {
        std::fs::remove_file(path).map_err(|e| format!("local_delete_failed: {e}"))
    }
}
