//! SFTP session management and file transfers with progress + cancellation.

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tauri::{AppHandle, Emitter};

use crate::ssh::SshManager;

pub struct SftpHandle {
    #[allow(dead_code)]
    pub id: String,
    #[allow(dead_code)]
    pub session_id: String,
    pub sftp: Arc<SftpSession>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    /// Unix mode in octal, e.g. "644" (empty when unavailable).
    pub permissions: String,
    /// Modification time, epoch seconds (0 when unavailable).
    pub modified: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub path: String,
    pub entries: Vec<FileEntry>,
}

fn entry_from(parent: &str, name: String, attrs: FileAttributes) -> FileEntry {
    let is_dir = attrs.is_dir();
    let permissions = attrs
        .permissions
        .map(|p| format!("{:o}", p & 0o777))
        .unwrap_or_default();
    let path = join_remote(parent, &name);
    FileEntry {
        name,
        path,
        is_dir,
        is_symlink: attrs.is_symlink(),
        size: attrs.size.unwrap_or(0),
        permissions,
        modified: attrs.mtime.map(|t| t as i64).unwrap_or(0),
    }
}

fn join_remote(parent: &str, name: &str) -> String {
    if parent.ends_with('/') {
        format!("{parent}{name}")
    } else {
        format!("{parent}/{name}")
    }
}

pub struct SftpManager {
    sessions: Mutex<HashMap<String, Arc<SftpHandle>>>,
}

impl Default for SftpManager {
    fn default() -> Self {
        SftpManager {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl SftpManager {
    pub fn get(&self, id: &str) -> Option<Arc<SftpHandle>> {
        self.sessions.lock().unwrap().get(id).cloned()
    }

    pub fn remove(&self, id: &str) -> Option<Arc<SftpHandle>> {
        self.sessions.lock().unwrap().remove(id)
    }

    pub async fn open(&self, ssh: &SshManager, session_id: &str) -> Result<String, String> {
        let ssh_session = ssh
            .get(session_id)
            .ok_or_else(|| "session_not_found".to_string())?;
        let channel = ssh_session
            .handle
            .channel_open_session()
            .await
            .map_err(|e| format!("channel_open_failed: {e}"))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("subsystem_request_failed: {e}"))?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| format!("sftp_init_failed: {e}"))?;

        let id = uuid::Uuid::new_v4().to_string();
        self.sessions.lock().unwrap().insert(
            id.clone(),
            Arc::new(SftpHandle {
                id: id.clone(),
                session_id: session_id.to_string(),
                sftp: Arc::new(sftp),
            }),
        );
        Ok(id)
    }
}

// ---------------------------------------------------------------------------
// Listing and file operations
// ---------------------------------------------------------------------------

pub async fn list(handle: &SftpHandle, path: &str) -> Result<DirectoryListing, String> {
    let start = if path.is_empty() { "." } else { path };
    let current = handle
        .sftp
        .canonicalize(start)
        .await
        .unwrap_or_else(|_| start.to_string());

    let mut entries = Vec::new();
    for entry in handle
        .sftp
        .read_dir(&current)
        .await
        .map_err(|e| format!("sftp_list_failed: {e}"))?
    {
        let attrs = entry.metadata();
        let name = entry.file_name();
        entries.push(entry_from(&current, name, attrs));
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(DirectoryListing {
        path: current,
        entries,
    })
}

pub async fn mkdir(handle: &SftpHandle, path: &str) -> Result<(), String> {
    handle
        .sftp
        .create_dir(path)
        .await
        .map_err(|e| format!("sftp_mkdir_failed: {e}"))
}

pub async fn rename(handle: &SftpHandle, from: &str, to: &str) -> Result<(), String> {
    handle
        .sftp
        .rename(from, to)
        .await
        .map_err(|e| format!("sftp_rename_failed: {e}"))
}

pub async fn delete(handle: &SftpHandle, path: &str, is_dir: bool) -> Result<(), String> {
    if is_dir {
        // SFTP rmdir only removes empty directories — refuse recursive deletes.
        handle
            .sftp
            .remove_dir(path)
            .await
            .map_err(|e| format!("sftp_delete_failed: {e}"))
    } else {
        handle
            .sftp
            .remove_file(path)
            .await
            .map_err(|e| format!("sftp_delete_failed: {e}"))
    }
}

pub async fn chmod(handle: &SftpHandle, path: &str, mode: u32) -> Result<(), String> {
    let attrs = FileAttributes {
        permissions: Some(mode & 0o7777),
        ..FileAttributes::empty()
    };
    handle
        .sftp
        .set_metadata(path, attrs)
        .await
        .map_err(|e| format!("sftp_chmod_failed: {e}"))
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TransferStatus {
    Active,
    Done,
    Failed,
    Cancelled,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferEvent {
    pub id: String,
    pub kind: String, // "upload" | "download"
    pub file_name: String,
    pub transferred: u64,
    pub total: u64,
    pub status: TransferStatus,
    pub error: Option<String>,
}

pub struct TransferManager {
    cancel_txs: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

impl Default for TransferManager {
    fn default() -> Self {
        TransferManager {
            cancel_txs: Mutex::new(HashMap::new()),
        }
    }
}

impl TransferManager {
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let sender = self
            .cancel_txs
            .lock()
            .unwrap()
            .remove(id)
            .ok_or_else(|| "transfer_not_found".to_string())?;
        let _ = sender.send(());
        Ok(())
    }

    fn register(&self, id: &str) -> tokio::sync::oneshot::Receiver<()> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.cancel_txs.lock().unwrap().insert(id.to_string(), tx);
        rx
    }

    fn unregister(&self, id: &str) {
        self.cancel_txs.lock().unwrap().remove(id);
    }
}

fn emit_transfer(app: &AppHandle, event: TransferEvent) {
    let _ = app.emit("sftp:transfer", &event);
}

fn remote_file_name(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

const CHUNK: usize = 256 * 1024;

pub async fn upload(
    app: AppHandle,
    transfers: Arc<TransferManager>,
    handle: Arc<SftpHandle>,
    local_path: String,
    remote_path: String,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let cancel_rx = transfers.register(&id);

    let local = PathBuf::from(&local_path);
    let file_name = local
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let total = tokio::fs::metadata(&local)
        .await
        .map_err(|e| format!("local_file_failed: {e}"))?
        .len();

    let ev = |transferred: u64, status: TransferStatus, error: Option<String>| TransferEvent {
        id: id.clone(),
        kind: "upload".into(),
        file_name: file_name.clone(),
        transferred,
        total,
        status,
        error,
    };

    let remote_target = if remote_path.ends_with('/') || remote_path == "." || remote_path.is_empty() {
        join_remote(&remote_path, &file_name)
    } else {
        remote_path
    };

    emit_transfer(&app, ev(0, TransferStatus::Active, None));
    let app2 = app.clone();
    let transfers2 = transfers.clone();
    let id2 = id.clone();
    tokio::spawn(async move {
        let result = do_upload(&handle.sftp, &local, &remote_target, total, cancel_rx, &app2, &id2, &file_name).await;
        transfers2.unregister(&id2);
        match result {
            Ok(transferred) => emit_transfer(&app2, upload_event(&id2, &file_name, transferred, total, TransferStatus::Done, None)),
            Err((transferred, err)) => {
                let status = if err == "cancelled" { TransferStatus::Cancelled } else { TransferStatus::Failed };
                emit_transfer(&app2, upload_event(&id2, &file_name, transferred, total, status, Some(err)));
            }
        }
    });
    Ok(id)
}

fn upload_event(id: &str, file_name: &str, transferred: u64, total: u64, status: TransferStatus, error: Option<String>) -> TransferEvent {
    TransferEvent {
        id: id.to_string(),
        kind: "upload".into(),
        file_name: file_name.to_string(),
        transferred,
        total,
        status,
        error,
    }
}

fn download_event(id: &str, file_name: &str, transferred: u64, total: u64, status: TransferStatus, error: Option<String>) -> TransferEvent {
    TransferEvent {
        id: id.to_string(),
        kind: "download".into(),
        file_name: file_name.to_string(),
        transferred,
        total,
        status,
        error,
    }
}

async fn do_upload(
    sftp: &SftpSession,
    local: &PathBuf,
    remote_target: &str,
    total: u64,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
    app: &AppHandle,
    id: &str,
    file_name: &str,
) -> Result<u64, (u64, String)> {
    let mut transferred: u64 = 0;
    let mut file = match sftp
        .open_with_flags(
            remote_target,
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
        )
        .await
    {
        Ok(f) => f,
        Err(e) => return Err((0, format!("sftp_open_failed: {e}"))),
    };
    let mut local_file = match tokio::fs::File::open(local).await {
        Ok(f) => f,
        Err(e) => return Err((0, format!("local_file_failed: {e}"))),
    };
    let mut buf = vec![0u8; CHUNK];
    loop {
        tokio::select! {
            _ = &mut cancel_rx => {
                let _ = file.close().await;
                return Err((transferred, "cancelled".into()));
            }
            n = local_file.read(&mut buf) => match n {
                Ok(0) => break,
                Ok(n) => {
                    if let Err(e) = file.write_all(&buf[..n]).await {
                        return Err((transferred, format!("sftp_write_failed: {e}")));
                    }
                    transferred += n as u64;
                    emit_transfer(app, upload_event(id, file_name, transferred, total, TransferStatus::Active, None));
                }
                Err(e) => return Err((transferred, format!("local_read_failed: {e}"))),
            }
        }
    }
    if let Err(e) = file.close().await {
        return Err((transferred, format!("sftp_close_failed: {e}")));
    }
    Ok(transferred)
}

pub async fn download(
    app: AppHandle,
    transfers: Arc<TransferManager>,
    handle: Arc<SftpHandle>,
    remote_path: String,
    local_path: String,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let cancel_rx = transfers.register(&id);

    let total = handle
        .sftp
        .metadata(&remote_path)
        .await
        .ok()
        .and_then(|m| m.size)
        .unwrap_or(0);
    let file_name = remote_file_name(&remote_path);

    emit_transfer(&app, download_event(&id, &file_name, 0, total, TransferStatus::Active, None));
    let app2 = app.clone();
    let transfers2 = transfers.clone();
    let id2 = id.clone();
    tokio::spawn(async move {
        let result = do_download(&handle.sftp, &remote_path, &local_path, total, cancel_rx, &app2, &id2, &file_name).await;
        transfers2.unregister(&id2);
        match result {
            Ok(transferred) => emit_transfer(&app2, download_event(&id2, &file_name, transferred, total, TransferStatus::Done, None)),
            Err((transferred, err)) => {
                let status = if err == "cancelled" { TransferStatus::Cancelled } else { TransferStatus::Failed };
                emit_transfer(&app2, download_event(&id2, &file_name, transferred, total, status, Some(err)));
            }
        }
    });
    Ok(id)
}

async fn do_download(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &str,
    total: u64,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
    app: &AppHandle,
    id: &str,
    file_name: &str,
) -> Result<u64, (u64, String)> {
    let mut transferred: u64 = 0;
    let mut file = match sftp.open(remote_path).await {
        Ok(f) => f,
        Err(e) => return Err((0, format!("sftp_open_failed: {e}"))),
    };
    let target = PathBuf::from(local_path);
    if let Some(parent) = target.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let mut local_file = match tokio::fs::File::create(&target).await {
        Ok(f) => f,
        Err(e) => return Err((0, format!("local_write_failed: {e}"))),
    };
    let mut buf = vec![0u8; CHUNK];
    loop {
        tokio::select! {
            _ = &mut cancel_rx => {
                let _ = file.close().await;
                return Err((transferred, "cancelled".into()));
            }
            n = file.read(&mut buf) => match n {
                Ok(0) => break,
                Ok(n) => {
                    if let Err(e) = local_file.write_all(&buf[..n]).await {
                        return Err((transferred, format!("local_write_failed: {e}")));
                    }
                    transferred += n as u64;
                    emit_transfer(app, download_event(id, file_name, transferred, total, TransferStatus::Active, None));
                }
                Err(e) => return Err((transferred, format!("sftp_read_failed: {e}"))),
            }
        }
    }
    let _ = file.close().await;
    if let Err(e) = local_file.flush().await {
        return Err((transferred, format!("local_write_failed: {e}")));
    }
    Ok(transferred)
}

pub async fn read_remote_text(handle: &SftpHandle, path: &str, max_bytes: u64) -> Result<String, String> {
    let meta = handle
        .sftp
        .metadata(path)
        .await
        .map_err(|e| format!("sftp_stat_failed: {e}"))?;
    if let Some(size) = meta.size {
        if size > max_bytes {
            return Err(format!("file_too_large: {size} > {max_bytes}"));
        }
    }
    let data = handle
        .sftp
        .read(path)
        .await
        .map_err(|e| format!("sftp_read_failed: {e}"))?;
    if data.contains(&0) {
        return Err("binary_file".into());
    }
    Ok(String::from_utf8_lossy(&data).to_string())
}

pub async fn write_remote_text(handle: &SftpHandle, path: &str, content: &str) -> Result<(), String> {
    handle
        .sftp
        .write(path, content.as_bytes())
        .await
        .map_err(|e| format!("sftp_write_failed: {e}"))
}

pub async fn close(manager: &SftpManager, id: &str) -> Result<(), String> {
    let handle = manager
        .remove(id)
        .ok_or_else(|| "sftp_session_not_found".to_string())?;
    let _ = handle.sftp.close().await;
    Ok(())
}
