import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  ConnectResult,
  DirectoryListing,
  FileEntry,
  HostKeyDecision,
  KnownHostEntry,
  LocalListing,
  McpAuditEntry,
  McpStartResult,
  McpStatus,
  Profile,
  ProfileInput,
  RemoteFileContent,
  SessionInfo,
  SshConfigImportResult,
} from "../types";

export const ipc = {
  // Profiles
  profileList: () => invoke<Profile[]>("profile_list"),
  profileSave: (input: ProfileInput, password?: string, keyPassphrase?: string) =>
    invoke<Profile>("profile_save", {
      input,
      password: password ?? null,
      keyPassphrase: keyPassphrase ?? null,
    }),
  profileDelete: (id: string) => invoke<void>("profile_delete", { id }),

  // SSH
  sshConnect: (profileId: string, password?: string, keyPassphrase?: string) =>
    invoke<ConnectResult>("ssh_connect", {
      input: {
        profileId,
        password: password ?? null,
        keyPassphrase: keyPassphrase ?? null,
      },
    }),
  sshDisconnect: (sessionId: string) => invoke<void>("ssh_disconnect", { sessionId }),
  sshWrite: (sessionId: string, dataBase64: string) =>
    invoke<void>("ssh_write", { sessionId, dataBase64 }),
  sshResize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("ssh_resize", { sessionId, cols, rows }),
  sshExec: (sessionId: string, command: string) =>
    invoke<[number, string]>("ssh_exec", { sessionId, command }),
  sshSessions: () => invoke<SessionInfo[]>("ssh_sessions"),
  hostKeyRespond: (ticket: string, decision: HostKeyDecision) =>
    invoke<void>("host_key_respond", { answer: { ticket, decision } }),

  // known_hosts
  knownHostsList: () => invoke<KnownHostEntry[]>("known_hosts_list"),
  knownHostsRemove: (host: string, port: number) =>
    invoke<number>("known_hosts_remove", { host, port }),
  knownHostsImportSystem: () => invoke<number>("known_hosts_import_system"),

  // ssh_config
  sshConfigImport: () => invoke<SshConfigImportResult>("ssh_config_import"),
  sshConfigExport: (ids: string[]) => invoke<string>("ssh_config_export", { ids }),

  // SFTP
  sftpOpen: (sessionId: string) => invoke<string>("sftp_open", { sessionId }),
  sftpClose: (sftpId: string) => invoke<void>("sftp_close", { sftpId }),
  sftpList: (sftpId: string, path: string) =>
    invoke<DirectoryListing>("sftp_list", { sftpId, path }),
  sftpMkdir: (sftpId: string, path: string) => invoke<void>("sftp_mkdir", { sftpId, path }),
  sftpRename: (sftpId: string, from: string, to: string) =>
    invoke<void>("sftp_rename", { sftpId, from, to }),
  sftpDelete: (sftpId: string, path: string, isDir: boolean) =>
    invoke<void>("sftp_delete", { sftpId, path, isDir }),
  sftpChmod: (sftpId: string, path: string, mode: number) =>
    invoke<void>("sftp_chmod", { sftpId, path, mode }),
  sftpUpload: (sftpId: string, localPath: string, remotePath: string) =>
    invoke<string>("sftp_upload", { sftpId, localPath, remotePath }),
  sftpDownload: (sftpId: string, remotePath: string, localPath: string) =>
    invoke<string>("sftp_download", { sftpId, remotePath, localPath }),
  transferCancel: (transferId: string) => invoke<void>("transfer_cancel", { transferId }),
  sftpReadText: (sftpId: string, path: string, maxBytes?: number) =>
    invoke<string>("sftp_read_text", { sftpId, path, maxBytes: maxBytes ?? null }),
  sftpWriteText: (sftpId: string, path: string, content: string) =>
    invoke<void>("sftp_write_text", { sftpId, path, content }),
  sftpReadFile: (sftpId: string, path: string, maxBytes?: number) =>
    invoke<RemoteFileContent>("sftp_read_file", { sftpId, path, maxBytes: maxBytes ?? null }),
  sftpWriteFile: (
    sftpId: string,
    path: string,
    content: string,
    expectedMtime: number | null,
    force: boolean,
  ) =>
    invoke<void>("sftp_write_file", {
      sftpId,
      path,
      content,
      expectedMtime: expectedMtime ?? null,
      force,
    }),

  // Monitoring
  monitoringOpen: (sessionId: string) => invoke<void>("monitoring_open", { sessionId }),
  monitoringClose: (sessionId: string) => invoke<void>("monitoring_close", { sessionId }),
  monitoringIsOpen: (sessionId: string) => invoke<boolean>("monitoring_is_open", { sessionId }),

  // Local filesystem
  localList: (path: string) => invoke<LocalListing>("local_list", { path }),
  localHome: () => invoke<string>("local_home"),
  localMkdir: (path: string) => invoke<void>("local_mkdir", { path }),
  localRename: (from: string, to: string) => invoke<void>("local_rename", { from, to }),
  localDelete: (path: string, isDir: boolean) =>
    invoke<void>("local_delete", { path, isDir }),

  // Settings & misc
  settingsGet: () => invoke<AppSettings>("settings_get"),
  settingsSet: (value: AppSettings) => invoke<void>("settings_set", { value }),
  appVersion: () => invoke<string>("app_version"),

  // MCP bridge
  mcpStart: () => invoke<McpStartResult>("mcp_start"),
  mcpStop: () => invoke<boolean>("mcp_stop"),
  mcpStatus: () => invoke<McpStatus>("mcp_status"),
  mcpAuditList: () => invoke<McpAuditEntry[]>("mcp_audit_list"),
  mcpAuditClear: () => invoke<void>("mcp_audit_clear"),
  mcpConfirm: (callId: string, approved: boolean) =>
    invoke<void>("mcp_confirm", { callId, approved }),
};

export type { FileEntry };
