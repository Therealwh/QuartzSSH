import { describe, expect, it } from "vitest";
import {
  diffEntries,
  snapshotEntries,
  type ConfigEntrySnapshot,
} from "../src/lib/sshConfigSync";

function entry(host: string, overrides: Partial<ConfigEntrySnapshot> = {}): ConfigEntrySnapshot {
  return {
    host,
    hostname: `${host}.example.com`,
    user: "deploy",
    port: 22,
    identityFiles: 1,
    keepalive: 30,
    proxyJump: undefined,
    ...overrides,
  };
}

describe("diffEntries (spec 18.3)", () => {
  it("detects added, removed and changed hosts", () => {
    const before = [entry("web1"), entry("db1")];
    const after = [entry("web1"), entry("db1", { port: 2222 }), entry("cache1")];
    const diff = diffEntries(before, after);
    expect(diff.added).toEqual(["cache1"]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual(["db1"]);
  });

  it("detects removed hosts", () => {
    const before = [entry("web1"), entry("db1")];
    const after = [entry("web1")];
    expect(diffEntries(before, after).removed).toEqual(["db1"]);
  });

  it("reports no changes for identical snapshots", () => {
    const before = [entry("web1"), entry("db1")];
    expect(diffEntries(before, [...before])).toEqual({ added: [], removed: [], changed: [] });
  });

  it("does not flag a host as changed when only the entry order differs", () => {
    const before = [entry("web1"), entry("db1")];
    const after = [entry("db1"), entry("web1")];
    expect(diffEntries(before, after)).toEqual({ added: [], removed: [], changed: [] });
  });

  it("flags keepalive changes as modifications", () => {
    const before = [entry("web1", { keepalive: 30 })];
    const after = [entry("web1", { keepalive: 60 })];
    expect(diffEntries(before, after).changed).toEqual(["web1"]);
  });
});

describe("snapshotEntries", () => {
  it("maps profiles to comparable snapshots", () => {
    const snapshots = snapshotEntries([
      {
        name: "web1",
        host: "web1.example.com",
        username: "deploy",
        port: 22,
        auth: { kind: "publicKey", keyPath: "~/.ssh/id_ed25519" },
        keepaliveSeconds: 30,
      },
      {
        name: "web2",
        host: "web2.example.com",
        username: "root",
        port: 2200,
        auth: { kind: "password" },
        keepaliveSeconds: 60,
      },
    ]);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].identityFiles).toBe(1);
    expect(snapshots[1].identityFiles).toBe(0);
    expect(snapshots[1].port).toBe(2200);
  });
});
