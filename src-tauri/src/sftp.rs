//! SFTP session management and file transfers with progress + cancellation.

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

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

    /// Find an open SFTP session by its SSH session id (read-only lookup
    /// used by the MCP bridge; the UI tracks sftp ids per profile itself).
    pub fn find_by_session(&self, session_id: &str) -> Option<Arc<SftpHandle>> {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .find(|h| h.session_id == session_id)
            .cloned()
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

fn transfer_event(
    kind: &str,
    id: &str,
    file_name: &str,
    transferred: u64,
    total: u64,
    status: TransferStatus,
    error: Option<String>,
) -> TransferEvent {
    TransferEvent {
        id: id.to_string(),
        kind: kind.into(),
        file_name: file_name.to_string(),
        transferred,
        total,
        status,
        error,
    }
}

/// Bundles the event context of a single transfer so the worker functions
/// stay small; emits progress and the final status event.
struct TransferJob<'a> {
    app: &'a AppHandle,
    id: &'a str,
    file_name: &'a str,
    total: u64,
    kind: &'static str,
}

impl TransferJob<'_> {
    fn event(
        &self,
        transferred: u64,
        status: TransferStatus,
        error: Option<String>,
    ) -> TransferEvent {
        transfer_event(
            self.kind,
            self.id,
            self.file_name,
            transferred,
            self.total,
            status,
            error,
        )
    }

    fn finish(&self, result: Result<u64, (u64, String)>) {
        match result {
            Ok(transferred) => {
                emit_transfer(
                    self.app,
                    self.event(transferred, TransferStatus::Done, None),
                );
            }
            Err((transferred, err)) => {
                let status = if err == "cancelled" {
                    TransferStatus::Cancelled
                } else {
                    TransferStatus::Failed
                };
                emit_transfer(self.app, self.event(transferred, status, Some(err)));
            }
        }
    }
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

    let remote_target =
        if remote_path.ends_with('/') || remote_path == "." || remote_path.is_empty() {
            join_remote(&remote_path, &file_name)
        } else {
            remote_path
        };

    emit_transfer(
        &app,
        transfer_event(
            "upload",
            &id,
            &file_name,
            0,
            total,
            TransferStatus::Active,
            None,
        ),
    );
    let app2 = app.clone();
    let transfers2 = transfers.clone();
    let id2 = id.clone();
    let file_name2 = file_name.clone();
    tokio::spawn(async move {
        let job = TransferJob {
            app: &app2,
            id: &id2,
            file_name: &file_name2,
            total,
            kind: "upload",
        };
        let result = do_upload(&handle.sftp, &local, &remote_target, cancel_rx, &job).await;
        transfers2.unregister(&id2);
        job.finish(result);
    });
    Ok(id)
}

async fn do_upload(
    sftp: &SftpSession,
    local: &PathBuf,
    remote_target: &str,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
    job: &TransferJob<'_>,
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
                    emit_transfer(job.app, job.event(transferred, TransferStatus::Active, None));
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

    emit_transfer(
        &app,
        transfer_event(
            "download",
            &id,
            &file_name,
            0,
            total,
            TransferStatus::Active,
            None,
        ),
    );
    let app2 = app.clone();
    let transfers2 = transfers.clone();
    let id2 = id.clone();
    let file_name2 = file_name.clone();
    tokio::spawn(async move {
        let job = TransferJob {
            app: &app2,
            id: &id2,
            file_name: &file_name2,
            total,
            kind: "download",
        };
        let result = do_download(&handle.sftp, &remote_path, &local_path, cancel_rx, &job).await;
        transfers2.unregister(&id2);
        job.finish(result);
    });
    Ok(id)
}

async fn do_download(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &str,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
    job: &TransferJob<'_>,
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
                    emit_transfer(job.app, job.event(transferred, TransferStatus::Active, None));
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

// ---------------------------------------------------------------------------
// Editor read/write (spec section 28: built-in remote code editor)
// ---------------------------------------------------------------------------

/// Text file content plus the server mtime at read time. The mtime is the
/// baseline for the optimistic-concurrency check on save.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileContent {
    pub content: String,
    /// Server mtime in epoch seconds; `None` when the server does not report it.
    pub mtime: Option<u32>,
}

/// A NUL byte within the first 8 KiB marks a file as binary (heuristic —
/// text files may legitimately contain NULs further in, e.g. padding).
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

fn looks_binary(data: &[u8]) -> bool {
    let head_len = data.len().min(BINARY_SNIFF_BYTES);
    data[..head_len].contains(&0)
}

/// Name of the temporary file used for the atomic write swap.
fn temp_path(path: &str) -> String {
    format!("{path}.quartzssh-tmp")
}

/// Pure optimistic-concurrency check for the editor write path: a conflict
/// exists only when both mtimes are known and differ. When either side is
/// unknown there is nothing to compare, so writing is allowed.
fn check_mtime_conflict(expected: Option<u32>, current: Option<u32>) -> bool {
    match (expected, current) {
        (Some(expected), Some(current)) => expected != current,
        _ => false,
    }
}

pub async fn read_remote_file(
    handle: &SftpHandle,
    path: &str,
    max_bytes: u64,
) -> Result<RemoteFileContent, String> {
    // Stat before reading: size guard and mtime baseline must describe the
    // same snapshot as the content we return.
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
    // Guard also when the server does not report the size.
    if data.len() as u64 > max_bytes {
        return Err(format!("file_too_large: {} > {max_bytes}", data.len()));
    }
    if looks_binary(&data) {
        return Err("binary_file".into());
    }
    Ok(RemoteFileContent {
        content: String::from_utf8_lossy(&data).to_string(),
        mtime: meta.mtime,
    })
}

pub async fn read_remote_text(
    handle: &SftpHandle,
    path: &str,
    max_bytes: u64,
) -> Result<String, String> {
    read_remote_file(handle, path, max_bytes)
        .await
        .map(|c| c.content)
}

/// Writes bytes to a remote path with CREATE|TRUNCATE, so the target is fully
/// replaced even when the new content is shorter than the old one.
async fn write_file_bytes(sftp: &SftpSession, path: &str, data: &[u8]) -> Result<(), String> {
    let mut file = sftp
        .open_with_flags(
            path,
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
        )
        .await
        .map_err(|e| format!("sftp_open_failed: {e}"))?;
    file.write_all(data)
        .await
        .map_err(|e| format!("sftp_write_failed: {e}"))?;
    file.close()
        .await
        .map_err(|e| format!("sftp_close_failed: {e}"))?;
    Ok(())
}

/// Editor write path (spec section 28.3): optimistic mtime check followed by
/// an as-atomic-as-possible replacement.
///
/// Why write to a temp file and rename instead of writing into the target:
/// 1. The naive `SftpSession::write` opens the target with WRITE only (no
///    TRUNCATE), so content shorter than the old file would leave a stale
///    tail on the server — silent corruption.
/// 2. Writing to `<path>.quartzssh-tmp` and renaming over the target swaps
///    the whole file in one step (atomic on servers whose SFTP rename follows
///    POSIX rename(2) semantics and overwrites the existing target).
///
/// Some servers (notably OpenSSH) refuse a plain SSH_FXP_RENAME onto an
/// existing file unless the client speaks the posix-rename@openssh.com
/// extension, which russh-sftp does not expose on `SftpSession`. When the
/// rename fails we fall back to writing the target in place with
/// CREATE|TRUNCATE: we trade the atomic swap for correctness (no stale
/// tail); a torn file is then possible only if the connection drops
/// mid-write, which is the same exposure the plain write always had.
pub async fn write_remote_text_mtime(
    handle: &SftpHandle,
    path: &str,
    content: &str,
    expected_mtime: Option<u32>,
    force: bool,
) -> Result<(), String> {
    // Re-stat right before writing: if the file changed on the server since
    // the editor read it (and the writer is not forcing), refuse — nothing
    // must be written in that case.
    let current = handle.sftp.metadata(path).await.ok().and_then(|m| m.mtime);
    if !force && check_mtime_conflict(expected_mtime, current) {
        return Err("mtime_conflict".into());
    }

    let tmp = temp_path(path);
    if let Err(e) = write_file_bytes(&handle.sftp, &tmp, content.as_bytes()).await {
        let _ = handle.sftp.remove_file(&tmp).await; // best-effort cleanup
        return Err(e);
    }
    match handle.sftp.rename(&tmp, path).await {
        Ok(()) => Ok(()),
        Err(_) => {
            // Server does not overwrite on rename — clean the temp file up
            // and write the target directly.
            let _ = handle.sftp.remove_file(&tmp).await;
            write_file_bytes(&handle.sftp, path, content.as_bytes()).await
        }
    }
}

/// Legacy plain write (no mtime check): kept for the existing
/// sftp_write_text command; the editor uses `write_remote_text_mtime`.
pub async fn write_remote_text(
    handle: &SftpHandle,
    path: &str,
    content: &str,
) -> Result<(), String> {
    write_remote_text_mtime(handle, path, content, None, true).await
}

#[cfg(test)]
mod tests {
    use super::{check_mtime_conflict, looks_binary, temp_path, BINARY_SNIFF_BYTES};

    #[test]
    fn mtime_conflict_matrix() {
        // No baseline and/or no server mtime -> nothing to compare, no conflict.
        assert!(!check_mtime_conflict(None, None));
        assert!(!check_mtime_conflict(None, Some(7)));
        assert!(!check_mtime_conflict(Some(5), None));
        // Same mtime -> ok.
        assert!(!check_mtime_conflict(Some(5), Some(5)));
        // File changed on the server since it was read -> conflict.
        assert!(check_mtime_conflict(Some(5), Some(7)));
    }

    #[test]
    fn temp_file_name() {
        assert_eq!(temp_path("/etc/app.conf"), "/etc/app.conf.quartzssh-tmp");
        assert_eq!(temp_path("notes.txt"), "notes.txt.quartzssh-tmp");
    }

    #[test]
    fn binary_detection_sniffs_only_the_head() {
        assert!(!looks_binary(b"plain text file"));
        let mut data = vec![b'a'; BINARY_SNIFF_BYTES + 64];
        // NUL only beyond the sniff window (e.g. trailing padding) is fine.
        data[BINARY_SNIFF_BYTES + 10] = 0;
        assert!(!looks_binary(&data));
        data[3] = 0;
        assert!(looks_binary(&data));
    }
}

pub async fn close(manager: &SftpManager, id: &str) -> Result<(), String> {
    let handle = manager
        .remove(id)
        .ok_or_else(|| "sftp_session_not_found".to_string())?;
    let _ = handle.sftp.close().await;
    Ok(())
}
