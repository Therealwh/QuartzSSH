import { create } from "zustand";
import i18next from "i18next";
import type { Profile } from "../types";
import { ipc } from "../lib/ipc";
import { useDialogs } from "./dialogs";

export type TabKind = "terminal" | "sftp" | "monitoring" | "settings";

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  /** Live SSH session id (terminal and SFTP tabs). */
  sessionId?: string;
  sftpId?: string;
  profileId?: string;
  host?: string;
  /** Terminal tabs: whether the underlying session is gone. */
  disconnected?: boolean;
  busy?: boolean;
}

export interface ConnectError {
  tabId: string;
  code: string;
}

interface SessionsStore {
  profiles: Profile[];
  tabs: Tab[];
  activeTabId: string | null;
  /** profileId -> live sessionId */
  connections: Record<string, string>;
  connectErrors: Record<string, string>;
  sftpOpenByProfile: Record<string, string>;

  loadProfiles: () => Promise<void>;
  saveProfile: (
    input: Parameters<typeof ipc.profileSave>[0],
    password?: string,
    keyPassphrase?: string,
  ) => Promise<Profile | null>;
  deleteProfile: (id: string) => Promise<void>;

  connectProfile: (profile: Profile, secrets?: { password?: string; keyPassphrase?: string }) => Promise<string | null>;
  disconnectTab: (tabId: string) => Promise<void>;
  reconnectTab: (tabId: string) => Promise<void>;

  openSftpForProfile: (profile: Profile) => Promise<void>;
  openMonitoringTab: () => void;
  openSettingsTab: () => void;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => Promise<void>;
  clearConnectError: (tabId: string) => void;
  markClosed: (sessionId: string) => void;
}

function newTabId() {
  return `tab-${Math.random().toString(36).slice(2, 10)}`;
}

async function requestSecret(
  profile: Profile,
  kind: "password" | "keyPassphrase",
): Promise<string | null> {
  return useDialogs.getState().requestPassword(kind, profile.host);
}

export const useSessions = create<SessionsStore>((set, get) => ({
  profiles: [],
  tabs: [],
  activeTabId: null,
  connections: {},
  connectErrors: {},
  sftpOpenByProfile: {},

  loadProfiles: async () => {
    try {
      const profiles = await ipc.profileList();
      set({ profiles });
    } catch (e) {
      console.error("profile_list failed", e);
    }
  },

  saveProfile: async (input, password, keyPassphrase) => {
    try {
      const profile = await ipc.profileSave(input, password, keyPassphrase);
      await get().loadProfiles();
      return profile;
    } catch (e) {
      console.error("profile_save failed", e);
      return null;
    }
  },

  deleteProfile: async (id) => {
    try {
      await ipc.profileDelete(id);
      await get().loadProfiles();
    } catch (e) {
      console.error("profile_delete failed", e);
    }
  },

  connectProfile: async (profile, secrets) => {
    try {
      const result = await ipc.sshConnect(
        profile.id,
        secrets?.password,
        secrets?.keyPassphrase,
      );
      set((s) => ({
        connections: { ...s.connections, [profile.id]: result.sessionId },
        connectErrors: Object.fromEntries(
          Object.entries(s.connectErrors).filter(([, v]) => v !== result.sessionId),
        ),
      }));
      // Reuse an existing terminal tab for this profile, otherwise open one.
      const existing = get().tabs.find(
        (t) => t.kind === "terminal" && t.profileId === profile.id && t.disconnected,
      );
      if (existing) {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === existing.id
              ? { ...t, sessionId: result.sessionId, disconnected: false, busy: false }
              : t,
          ),
          activeTabId: existing.id,
        }));
        return result.sessionId;
      }
      const tab: Tab = {
        id: newTabId(),
        kind: "terminal",
        title: profile.name,
        sessionId: result.sessionId,
        profileId: profile.id,
        host: profile.host,
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
      return result.sessionId;
    } catch (e) {
      const code = String(e);
      if (code === "password_required") {
        const pass = await requestSecret(profile, "password");
        if (pass !== null) return get().connectProfile(profile, { password: pass });
        return null;
      }
      if (code.includes("key_passphrase_required")) {
        const pass = await requestSecret(profile, "keyPassphrase");
        if (pass !== null) return get().connectProfile(profile, { keyPassphrase: pass });
        return null;
      }
      // Surface the error on the tab (or as a placeholder tab).
      const existing = get().tabs.find((t) => t.profileId === profile.id && t.kind === "terminal");
      const tabId = existing?.id ?? newTabId();
      set((s) => ({
        connectErrors: { ...s.connectErrors, [tabId]: code },
        tabs: existing
          ? s.tabs
          : [
              ...s.tabs,
              {
                id: tabId,
                kind: "terminal",
                title: profile.name,
                profileId: profile.id,
                host: profile.host,
                disconnected: true,
              },
            ],
        activeTabId: tabId,
      }));
      return null;
    }
  },

  disconnectTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab?.sessionId) return;
    try {
      await ipc.sshDisconnect(tab.sessionId);
    } catch {
      // already gone
    }
    get().markClosed(tab.sessionId);
  },

  reconnectTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab?.profileId) return;
    const profile = get().profiles.find((p) => p.id === tab.profileId);
    if (!profile) return;
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, busy: true } : t)),
    }));
    await get().connectProfile(profile);
  },

  openSftpForProfile: async (profile) => {
    let sessionId: string | undefined = get().connections[profile.id];
    if (!sessionId) {
      sessionId = (await get().connectProfile(profile)) ?? undefined;
      if (!sessionId) return;
    }
    try {
      const sftpId = await ipc.sftpOpen(sessionId);
      const tab: Tab = {
        id: newTabId(),
        kind: "sftp",
        title: profile.name,
        sessionId,
        sftpId,
        profileId: profile.id,
        host: profile.host,
      };
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        sftpOpenByProfile: { ...s.sftpOpenByProfile, [profile.id]: sftpId },
      }));
    } catch (e) {
      useDialogs.getState().setUpdateStatus(String(e));
    }
  },

  openSettingsTab: () => {
    const existing = get().tabs.find((t) => t.kind === "settings");
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tab: Tab = { id: "tab-settings", kind: "settings", title: "Settings" };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  /** Single-instance server health tab. */
  openMonitoringTab: () => {
    const existing = get().tabs.find((t) => t.kind === "monitoring");
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tab: Tab = {
      id: "tab-monitoring",
      kind: "monitoring",
      title: i18next.t("activity.monitoring"),
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  closeTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.sessionId && !tab.disconnected) {
      try {
        await ipc.sshDisconnect(tab.sessionId);
      } catch {
        // ignore
      }
      set((s) => {
        const connections = { ...s.connections };
        for (const [pid, sid] of Object.entries(connections)) {
          if (sid === tab.sessionId) delete connections[pid];
        }
        return { connections };
      });
    }
    if (tab.sftpId) {
      void ipc.sftpClose(tab.sftpId).catch(() => undefined);
    }
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeTabId =
        s.activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : s.activeTabId;
      return { tabs, activeTabId };
    });
  },

  clearConnectError: (tabId) =>
    set((s) => {
      const errors = { ...s.connectErrors };
      delete errors[tabId];
      return { connectErrors: errors };
    }),

  markClosed: (sessionId) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.sessionId === sessionId && t.kind === "terminal" ? { ...t, disconnected: true } : t,
      ),
    }));
    const ar = useAutoReconnect.getState();
    if (!ar.enabled) return;
    const tab = get().tabs.find(
      (t) => t.sessionId === sessionId && t.kind === "terminal",
    );
    const profile = tab?.profileId
      ? get().profiles.find((p) => p.id === tab.profileId)
      : undefined;
    if (!profile?.autoReconnect) return;
    const delay = ar.delaySeconds * 1000;
    setTimeout(() => {
      const stillDisconnected = get().tabs.find(
        (t) => t.id === tab!.id && t.disconnected,
      );
      if (stillDisconnected) void get().reconnectTab(tab!.id);
    }, delay);
  },
}));

// Auto-reconnect preferences come from the Rust-side settings; a tiny store
// keeps them observable from the session store without circular imports.
import { create as createZustand } from "zustand";
export const useAutoReconnect = createZustand<{
  enabled: boolean;
  delaySeconds: number;
  set: (enabled: boolean, delaySeconds: number) => void;
}>((set) => ({
  enabled: true,
  delaySeconds: 5,
  set: (enabled, delaySeconds) => set({ enabled, delaySeconds }),
}));
