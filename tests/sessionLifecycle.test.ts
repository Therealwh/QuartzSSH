import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useSessions, type Tab } from "../src/store/sessions";

const mockedInvoke = vi.mocked(invoke);

function terminalTab(id: string, sessionId?: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    kind: "terminal",
    title: "web",
    profileId: "p1",
    host: "example.com",
    sessionId,
    ...overrides,
  };
}

function sftpTab(id: string, sessionId: string, sftpId: string): Tab {
  return { id, kind: "sftp", title: "web", profileId: "p1", host: "example.com", sessionId, sftpId };
}

describe("closeTab keeps shared sessions alive", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
    localStorage.clear();
    useSessions.setState({
      tabs: [],
      activeTabId: null,
      connections: {},
      connectErrors: {},
      sftpOpenByProfile: {},
      kexBySession: {},
    });
  });

  it("does not disconnect the SSH session while an SFTP tab still uses it", async () => {
    useSessions.setState({
      tabs: [terminalTab("t1", "sess-1"), sftpTab("t2", "sess-1", "sftp-1")],
      activeTabId: "t2",
      connections: { p1: "sess-1" },
      kexBySession: { "sess-1": "curve25519-sha256" },
    });

    await useSessions.getState().closeTab("t2");

    expect(mockedInvoke).not.toHaveBeenCalledWith("ssh_disconnect", expect.anything());
    expect(useSessions.getState().tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(useSessions.getState().connections).toEqual({ p1: "sess-1" });
    expect(useSessions.getState().kexBySession).toEqual({ "sess-1": "curve25519-sha256" });
  });

  it("disconnects the shared session when the last tab using it closes", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    useSessions.setState({
      tabs: [terminalTab("t1", "sess-1"), sftpTab("t2", "sess-1", "sftp-1")],
      activeTabId: "t1",
      connections: { p1: "sess-1" },
      kexBySession: { "sess-1": "curve25519-sha256" },
    });

    await useSessions.getState().closeTab("t1");
    await useSessions.getState().closeTab("t2");

    expect(mockedInvoke).toHaveBeenCalledWith("ssh_disconnect", { sessionId: "sess-1" });
    expect(useSessions.getState().connections).toEqual({});
    expect(useSessions.getState().kexBySession).toEqual({});
  });

  it("closing one editor tab leaves its sibling editor tabs open", async () => {
    useSessions.setState({
      tabs: [
        sftpTab("t2", "sess-1", "sftp-1"),
        { id: "e1", kind: "editor", title: "a.txt", sftpId: "sftp-1", path: "/a.txt" },
        { id: "e2", kind: "editor", title: "b.txt", sftpId: "sftp-1", path: "/b.txt" },
      ],
      activeTabId: "e1",
    });

    await useSessions.getState().closeTab("e1");

    const ids = useSessions.getState().tabs.map((t) => t.id);
    expect(ids).toEqual(["t2", "e2"]);
    // The Files tab still holds the SFTP session.
    expect(mockedInvoke).not.toHaveBeenCalledWith("sftp_close", expect.anything());
  });

  it("closing the Files tab closes its editor tabs and the SFTP session", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    useSessions.setState({
      tabs: [
        terminalTab("t1", "sess-1"),
        sftpTab("t2", "sess-1", "sftp-1"),
        { id: "e1", kind: "editor", title: "a.txt", sftpId: "sftp-1", path: "/a.txt" },
      ],
      activeTabId: "t2",
    });

    await useSessions.getState().closeTab("t2");

    // The terminal tab keeps its session alive; only the SFTP channel closes.
    expect(mockedInvoke).not.toHaveBeenCalledWith("ssh_disconnect", expect.anything());
    expect(mockedInvoke).toHaveBeenCalledWith("sftp_close", { sftpId: "sftp-1" });
    expect(useSessions.getState().tabs.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("markClosed forgets the dead session", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    localStorage.clear();
    useSessions.setState({
      tabs: [],
      activeTabId: null,
      connections: {},
      connectErrors: {},
      kexBySession: {},
    });
  });

  it("marks terminal tabs disconnected and drops the connection record", () => {
    useSessions.setState({
      tabs: [terminalTab("t1", "sess-1"), sftpTab("t2", "sess-1", "sftp-1")],
      connections: { p1: "sess-1" },
      kexBySession: { "sess-1": "mlkem768x25519-sha256" },
    });

    useSessions.getState().markClosed("sess-1");

    const state = useSessions.getState();
    expect(state.tabs[0]).toMatchObject({ id: "t1", disconnected: true });
    expect(state.connections).toEqual({});
    expect(state.kexBySession).toEqual({});
  });
});
