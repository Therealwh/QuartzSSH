import { Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityBar } from "./components/ActivityBar";
import { SessionsPanel } from "./components/panels/SessionsPanel";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
import { TerminalPane } from "./components/TerminalPane";
import { SftpPane } from "./components/SftpPane";
import { SettingsView } from "./components/panels/SettingsView";
import { MonitoringPanel } from "./components/panels/MonitoringPanel";
import { TransfersBar } from "./components/TransfersBar";
import { HostKeyDialog } from "./components/dialogs/HostKeyDialog";
import { PasswordDialog } from "./components/dialogs/PasswordDialog";
import { ConfirmDialog } from "./components/dialogs/ConfirmDialog";
import { UpdateDialog } from "./components/dialogs/UpdateDialog";
import { useSessions } from "./store/sessions";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";

// The editor (and its CodeMirror chunk) is only loaded when an editor tab
// exists. Editor tabs stay mounted while hidden so unsaved buffers survive
// switching to another tab.
const FileEditor = lazy(() =>
  import("./components/editor/FileEditor").then((m) => ({ default: m.FileEditor })),
);

export default function App() {
  const { t } = useTranslation();
  const tabs = useSessions((s) => s.tabs);
  const activeTabId = useSessions((s) => s.activeTabId);
  const splitView = useSessions((s) => s.splitView);
  const broadcastMode = useSessions((s) => s.broadcastMode);
  const toggleBroadcastMode = useSessions((s) => s.toggleBroadcastMode);
  const setActiveTab = useSessions((s) => s.setActiveTab);
  const loadProfiles = useSessions((s) => s.loadProfiles);
  const restoreWorkspaceSnapshot = useSessions((s) => s.restoreWorkspaceSnapshot);
  const closeTab = useSessions((s) => s.closeTab);
  useGlobalShortcuts();

  // The workspace restores once profiles are known, so auto-reconnect can
  // pick the right profiles (24.3).
  const [profilesReady, setProfilesReady] = useState(false);
  useEffect(() => {
    void loadProfiles().finally(() => setProfilesReady(true));
  }, [loadProfiles]);
  useEffect(() => {
    if (profilesReady) restoreWorkspaceSnapshot();
  }, [profilesReady, restoreWorkspaceSnapshot]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const editorTabs = tabs.filter((tab) => tab.kind === "editor" && tab.sftpId && tab.path);

  const terminalTabs = tabs.filter((tab) => tab.kind === "terminal");
  const visibleTerminals = terminalTabs.slice(0, 4);
  const connectedCount = terminalTabs.filter((tab) => !tab.disconnected && tab.sessionId).length;
  const showGrid = splitView && visibleTerminals.length >= 2;

  return (
    <div className="flex h-full w-full flex-col" data-testid="app-shell">
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <aside
          className="w-[260px] shrink-0 border-r border-[var(--q-border)] bg-[var(--q-panel)]"
          aria-label={t("sessions.title")}
          data-testid="sessions-panel"
        >
          <SessionsPanel />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-[var(--q-bg)]">
          <TabBar />
          {broadcastMode && (
            <div className="flex shrink-0 items-center gap-3 bg-[var(--q-accent)] px-3 py-1 text-xs font-semibold text-[var(--q-accentText)]">
              <span className="flex-1">{t("workspaces.banner", { count: connectedCount })}</span>
              <button
                className="rounded px-2 py-0.5 hover:bg-black/10"
                onClick={() => void toggleBroadcastMode()}
              >
                {t("workspaces.turnOff")}
              </button>
            </div>
          )}
          {splitView && !showGrid && (
            <div className="shrink-0 border-b border-[var(--q-border)] bg-[var(--q-panel)] px-3 py-1 text-xs text-[var(--q-muted)]">
              {t("workspaces.splitHint")}
            </div>
          )}
          <div className="relative min-h-0 flex-1">
            {showGrid ? (
              <div
                className={`grid h-full w-full gap-px bg-[var(--q-border)] ${
                  visibleTerminals.length > 2 ? "grid-rows-2" : "grid-rows-1"
                }`}
                style={{ gridTemplateColumns: "1fr 1fr" }}
              >
                {visibleTerminals.map((tab) => (
                  <div
                    key={tab.id}
                    className={`min-h-0 min-w-0 overflow-hidden bg-[var(--q-bg)] ${
                      tab.id === activeTabId ? "ring-1 ring-inset ring-[var(--q-accent)]" : ""
                    }`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <TerminalPane key={tab.id} tab={tab} />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {activeTab?.kind === "terminal" && <TerminalPane key={activeTab.id} tab={activeTab} />}
                {activeTab?.kind === "sftp" && <SftpPane key={activeTab.id} tab={activeTab} />}
                {activeTab?.kind === "monitoring" && <MonitoringPanel />}
                {activeTab?.kind === "settings" && <SettingsView />}
                {!activeTab && <Welcome />}
              </>
            )}
            {editorTabs.length > 0 && (
              <Suspense fallback={<EditorLoading />}>
                {editorTabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={activeTab?.id === tab.id ? "absolute inset-0" : "hidden"}
                  >
                    <FileEditor
                      key={tab.id}
                      sftpId={tab.sftpId ?? ""}
                      path={tab.path ?? ""}
                      tabId={tab.id}
                      onClose={() => void closeTab(tab.id)}
                    />
                  </div>
                ))}
              </Suspense>
            )}
          </div>
          <TransfersBar />
        </main>
      </div>
      <StatusBar />
      <HostKeyDialog />
      <PasswordDialog />
      <ConfirmDialog />
      <UpdateDialog />
    </div>
  );
}

function EditorLoading() {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--q-muted)]">
      {t("editor.loading")}
    </div>
  );
}

function Welcome() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--q-muted)]">
      <img src="/logo.svg" alt="" width={72} height={72} />
      <div className="text-lg font-medium text-[var(--q-text)]">{t("app.title")}</div>
      <div className="text-sm">{t("sessions.emptyHint")}</div>
    </div>
  );
}
