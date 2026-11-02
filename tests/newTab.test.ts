import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useSessions, type Tab } from "../src/store/sessions";
import type { ConnectResult, Profile } from "../src/types";

const mockedInvoke = vi.mocked(invoke);

const profile: Profile = {
  id: "p1",
  name: "web",
  group: "",
  host: "example.com",
  port: 22,
  username: "root",
  auth: { kind: "password", savePassword: false },
  keepaliveSeconds: 30,
  autoReconnect: false,
  createdAt: 0,
  updatedAt: 0,
};

const connectResult: ConnectResult = {
  sessionId: "sess-2",
  host: profile.host,
  port: profile.port,
  username: profile.username,
};

function terminalTab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    kind: "terminal",
    title: profile.name,
    profileId: profile.id,
    host: profile.host,
    ...overrides,
  };
}

describe("duplicateActiveSessionTab (Ctrl+T)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    localStorage.clear();
    useSessions.setState({
      profiles: [profile],
      tabs: [],
      activeTabId: null,
      connections: {},
      connectErrors: {},
    });
  });

  it("opens a NEW tab for the same profile instead of taking over the live one", async () => {
    mockedInvoke.mockResolvedValue(connectResult);
    useSessions.setState({
      tabs: [terminalTab("t1", { sessionId: "sess-1" })],
      activeTabId: "t1",
      connections: { p1: "sess-1" },
    });

    useSessions.getState().duplicateActiveSessionTab();

    await vi.waitFor(() => {
      expect(useSessions.getState().tabs).toHaveLength(2);
    });
    const { tabs, activeTabId, connections } = useSessions.getState();
    const fresh = tabs[1];
    expect(fresh?.profileId).toBe(profile.id);
    expect(fresh?.sessionId).toBe("sess-2");
    expect(fresh?.disconnected).toBeFalsy();
    expect(activeTabId).toBe(fresh?.id);
    // The original tab keeps its own session.
    expect(tabs[0]?.sessionId).toBe("sess-1");
    expect(connections).toEqual({ p1: "sess-2" });
  });

  it("reconnects a disconnected active tab in place", async () => {
    mockedInvoke.mockResolvedValue(connectResult);
    useSessions.setState({
      tabs: [terminalTab("t1", { sessionId: "sess-1", disconnected: true })],
      activeTabId: "t1",
    });

    useSessions.getState().duplicateActiveSessionTab();

    await vi.waitFor(() => {
      expect(useSessions.getState().tabs[0]).toMatchObject({
        id: "t1",
        sessionId: "sess-2",
        disconnected: false,
      });
    });
    expect(useSessions.getState().tabs).toHaveLength(1);
  });

  it("ignores a non-terminal active tab", () => {
    useSessions.setState({
      tabs: [{ id: "tab-settings", kind: "settings", title: "Settings" }],
      activeTabId: "tab-settings",
    });

    useSessions.getState().duplicateActiveSessionTab();

    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(useSessions.getState().tabs).toHaveLength(1);
  });

  it("does nothing when the active terminal tab has no profile", () => {
    useSessions.setState({
      tabs: [{ id: "t1", kind: "terminal", title: "?" }],
      activeTabId: "t1",
    });

    useSessions.getState().duplicateActiveSessionTab();

    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("does nothing when there is no active tab", () => {
    useSessions.setState({ tabs: [terminalTab("t1")], activeTabId: null });

    useSessions.getState().duplicateActiveSessionTab();

    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
