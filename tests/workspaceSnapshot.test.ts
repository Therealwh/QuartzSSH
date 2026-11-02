import { beforeEach, describe, expect, it } from "vitest";
import { loadWorkspaceSnapshot, saveWorkspaceSnapshot } from "../src/lib/workspaceSnapshot";
import type { Tab } from "../src/store/sessions";

const STORAGE_KEY = "quartzssh.workspace";

function terminalTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "tab-1",
    kind: "terminal",
    title: "server",
    profileId: "p1",
    host: "example.com",
    sessionId: "sess-1",
    disconnected: false,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("workspace snapshot", () => {
  it("round-trips tabs and strips live handles", () => {
    saveWorkspaceSnapshot(
      [
        terminalTab(),
        { id: "tab-settings", kind: "settings", title: "Settings" },
        { id: "tab-monitoring", kind: "monitoring", title: "Monitoring" },
      ],
      { splitView: true, broadcastMode: false },
    );
    const tabs = loadWorkspaceSnapshot();
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toMatchObject({
      id: "tab-1",
      kind: "terminal",
      title: "server",
      profileId: "p1",
      host: "example.com",
      disconnected: true,
    });
    expect(tabs[0].sessionId).toBeUndefined();
    expect(tabs[1]).toMatchObject({ id: "tab-settings", kind: "settings" });
    expect(tabs[2]).toMatchObject({ id: "tab-monitoring", kind: "monitoring" });
    // The view flags are stored for future use.
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(raw.view).toEqual({ splitView: true, broadcastMode: false });
  });

  it("drops tab kinds that cannot survive a restart", () => {
    saveWorkspaceSnapshot(
      [
        terminalTab(),
        { id: "tab-sftp", kind: "sftp", title: "files", sftpId: "sftp-1" },
        { id: "tab-editor", kind: "editor", title: "hosts", sftpId: "sftp-1", path: "/etc/hosts" },
      ],
      { splitView: false, broadcastMode: false },
    );
    expect(loadWorkspaceSnapshot().map((t) => t.kind)).toEqual(["terminal"]);
  });

  it("returns an empty list for corrupted storage", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadWorkspaceSnapshot()).toEqual([]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, tabs: "nope" }));
    expect(loadWorkspaceSnapshot()).toEqual([]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, tabs: [{ id: "a" }] }));
    expect(loadWorkspaceSnapshot()).toEqual([]);
  });

  it("filters entries with unknown kinds and missing fields", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tabs: [
          { id: "a", kind: "terminal", title: "ok" },
          { id: "b", kind: "bogus", title: "x" },
          { id: "c", kind: 42, title: "x" },
          { kind: "terminal", title: "no id" },
          { id: "", kind: "terminal", title: "empty id" },
          "garbage",
          null,
        ],
      }),
    );
    expect(loadWorkspaceSnapshot().map((t) => t.id)).toEqual(["a"]);
  });

  it("normalizes singletons to their canonical ids", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tabs: [
          { id: "custom-id", kind: "settings", title: "Settings" },
          { id: "other", kind: "monitoring", title: "Monitoring" },
        ],
      }),
    );
    const tabs = loadWorkspaceSnapshot();
    expect(tabs.map((t) => t.id)).toEqual(["tab-settings", "tab-monitoring"]);
  });

  it("caps the restored workspace at 50 tabs", () => {
    const tabs = Array.from({ length: 60 }, (_, i) => ({
      id: `t${i}`,
      kind: "terminal",
      title: `t${i}`,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, tabs }));
    const restored = loadWorkspaceSnapshot();
    expect(restored).toHaveLength(50);
    expect(restored.every((t) => t.disconnected)).toBe(true);
  });
});
