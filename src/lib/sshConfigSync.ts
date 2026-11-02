// Change detection for the external ~/.ssh/config file (spec 18.3).
// The parsed-entry comparison is pure so it can be unit-tested.

export interface ConfigEntrySnapshot {
  /** First host pattern, e.g. "web1". */
  host: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFiles: number;
  keepalive: number;
  proxyJump?: string;
}

export interface ConfigDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export function snapshotEntries(
  profiles: Array<{
    name: string;
    host: string;
    username: string;
    port: number;
    auth: { kind: string; keyPath?: string | null };
    keepaliveSeconds: number;
  }>,
): ConfigEntrySnapshot[] {
  return profiles.map((p) => ({
    host: p.name,
    hostname: p.host,
    user: p.username,
    port: p.port,
    identityFiles: p.auth.kind === "publicKey" && p.auth.keyPath ? 1 : 0,
    keepalive: p.keepaliveSeconds,
    proxyJump: undefined,
  })) as ConfigEntrySnapshot[];
}

function entryFingerprint(e: ConfigEntrySnapshot): string {
  return JSON.stringify([e.hostname, e.user, e.port, e.identityFiles, e.keepalive ?? 30, e.proxyJump ?? ""]);
}

/** Compare two parsed snapshots by host, fingerprinting connection details. */
export function diffEntries(oldEntries: ConfigEntrySnapshot[], newEntries: ConfigEntrySnapshot[]): ConfigDiff {
  const oldByHost = new Map(oldEntries.map((e) => [e.host, e]));
  const newByHost = new Map(newEntries.map((e) => [e.host, e]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [host, entry] of newByHost) {
    if (!oldByHost.has(host)) added.push(host);
    else if (entryFingerprint(entry) !== entryFingerprint(oldByHost.get(host)!)) changed.push(host);
  }
  for (const host of oldByHost.keys()) if (!newByHost.has(host)) removed.push(host);
  return { added, removed, changed };
}

const HASH_KEY = "quartzssh.sshconfig.seen";
const SNAPSHOT_KEY = "quartzssh.sshconfig.snapshot";

/** True when a stored snapshot exists and the file hash differs from it. */
export function isConfigChanged(currentHash: string): boolean {
  const seen = localStorage.getItem(HASH_KEY);
  return !!seen && seen !== currentHash;
}

export function rememberConfigSnapshot(hash: string, snapshot: ConfigEntrySnapshot[]) {
  localStorage.setItem(HASH_KEY, hash);
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function loadStoredSnapshot(): ConfigEntrySnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as ConfigEntrySnapshot[]) : [];
  } catch {
    return [];
  }
}
