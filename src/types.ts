// Types mirroring the serde payloads of the Rust backend.

export type AuthMethod =
  | { kind: "password"; savePassword: boolean }
  | { kind: "publicKey"; keyPath?: string | null; savePassphrase: boolean; identitiesOnly: boolean };

export interface Profile {
  id: string;
  name: string;
  group: string;
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  keepaliveSeconds: number;
  autoReconnect: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProfileInput {
  id?: string | null;
  name: string;
  group: string;
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
  keepaliveSeconds?: number;
  autoReconnect?: boolean;
}

export interface ConnectResult {
  sessionId: string;
  host: string;
  port: number;
  username: string;
}

export interface SessionInfo {
  id: string;
  profileId: string;
  host: string;
  port: number;
  username: string;
  connected: boolean;
}

export type HostKeyStatus = "new" | "changed";

export interface HostKeyPrompt {
  ticket: string;
  host: string;
  port: number;
  status: HostKeyStatus;
  keyType: string;
  fingerprint: string;
  previousFingerprint: string;
}

export type HostKeyDecision = "accept" | "acceptRemember" | "reject";

/// Classification of a key file, mirroring `ssh::KeyFileInfo` on the backend.
export type KeyFileInfo =
  | { kind: "standard" }
  | { kind: "putty" }
  | { kind: "hardwareFido2"; algorithm: string };

export interface KnownHostEntry {
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  raw: string;
}

export interface SshConfigImportResult {
  profiles: Profile[];
  warnings: string[];
  source: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  permissions: string;
  modified: number;
}

export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
}

export interface LocalEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
  readonly: boolean;
}

export interface LocalListing {
  path: string;
  entries: LocalEntry[];
}

/** Text file content for the built-in editor, with its server mtime baseline. */
export interface RemoteFileContent {
  content: string;
  mtime: number | null;
}

export type TransferStatus = "active" | "done" | "failed" | "cancelled";

export interface TransferEvent {
  id: string;
  kind: "upload" | "download";
  fileName: string;
  transferred: number;
  total: number;
  status: TransferStatus;
  error?: string | null;
}

export type HostKeyMode = "strict" | "acceptFirst" | "nonStrict";

export interface AppSettings {
  hostKeyMode: HostKeyMode;
  preferPqKex: boolean;
  autoReconnect: boolean;
  reconnectDelaySeconds: number;
  checkUpdatesOnStart: boolean;
  updateCheckIntervalMinutes: number;
}

// Monitoring (server health panel)

export interface DiskUsage {
  mount: string;
  used: number;
  total: number;
}

export interface ProcInfo {
  name: string;
  cpuPercent: number;
  memPercent: number;
}

export interface SystemStats {
  /** Null until two consecutive samples exist to diff. */
  cpuPercent: number | null;
  load: number[];
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  swapTotal: number;
  disks: DiskUsage[];
  netRxBps: number;
  netTxBps: number;
  uptimeSecs: number;
  osName: string;
  kernel: string;
  top: ProcInfo[];
}
