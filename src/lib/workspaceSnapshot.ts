// Workspace snapshot persistence (section 24.3): which tabs were open, so
// the workspace can be brought back after a restart. Only tab kinds that
// can survive an app restart are stored — SFTP/editor tabs reference live
// session handles that die with the process, so they are not restored.

import type { Tab, TabKind } from "../store/sessions";

const STORAGE_KEY = "quartzssh.workspace";
const MAX_TABS = 50;
const SNAPSHOT_KINDS: readonly TabKind[] = ["terminal", "monitoring", "settings"];

export interface WorkspaceViewState {
  splitView: boolean;
  broadcastMode: boolean;
}

export function saveWorkspaceSnapshot(tabs: Tab[], view: WorkspaceViewState): void {
  try {
    const payload = {
      version: 1,
      tabs: tabs.filter((tab) => SNAPSHOT_KINDS.includes(tab.kind)).map(toStoredTab),
      view,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage may be unavailable — the workspace simply is not restored.
  }
}

export function loadWorkspaceSnapshot(): Tab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.tabs)) return [];
    const tabs: Tab[] = [];
    for (const entry of parsed.tabs) {
      const tab = parseTab(entry);
      if (tab) tabs.push(tab);
      if (tabs.length >= MAX_TABS) break;
    }
    return tabs;
  } catch {
    return [];
  }
}

/** Terminal tabs always come back disconnected; live handles are stripped. */
function toStoredTab(tab: Tab): Tab {
  if (tab.kind === "terminal") {
    return {
      id: tab.id,
      kind: "terminal",
      title: tab.title,
      profileId: tab.profileId,
      host: tab.host,
      disconnected: true,
    };
  }
  return {
    id: tab.kind === "settings" ? "tab-settings" : "tab-monitoring",
    kind: tab.kind,
    title: tab.title,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTab(raw: unknown): Tab | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.kind !== "string" || !SNAPSHOT_KINDS.includes(raw.kind as TabKind)) return null;
  const kind = raw.kind as TabKind;
  const title = typeof raw.title === "string" ? raw.title : "";
  if (kind === "terminal") {
    return {
      id: raw.id,
      kind: "terminal",
      title,
      profileId: typeof raw.profileId === "string" ? raw.profileId : undefined,
      host: typeof raw.host === "string" ? raw.host : undefined,
      disconnected: true,
    };
  }
  return {
    id: kind === "settings" ? "tab-settings" : "tab-monitoring",
    kind,
    title,
  };
}
