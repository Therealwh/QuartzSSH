import { Suspense, lazy, useEffect } from "react";
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
  const loadProfiles = useSessions((s) => s.loadProfiles);
  const closeTab = useSessions((s) => s.closeTab);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const editorTabs = tabs.filter((tab) => tab.kind === "editor" && tab.sftpId && tab.path);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <aside
          className="w-[260px] shrink-0 border-r border-[var(--q-border)] bg-[var(--q-panel)]"
          aria-label={t("sessions.title")}
        >
          <SessionsPanel />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-[var(--q-bg)]">
          <TabBar />
          <div className="relative min-h-0 flex-1">
            {activeTab?.kind === "terminal" && <TerminalPane key={activeTab.id} tab={activeTab} />}
            {activeTab?.kind === "sftp" && <SftpPane key={activeTab.id} tab={activeTab} />}
            {activeTab?.kind === "monitoring" && <MonitoringPanel />}
            {activeTab?.kind === "settings" && <SettingsView />}
            {!activeTab && <Welcome />}
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
