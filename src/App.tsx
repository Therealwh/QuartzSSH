import { useEffect } from "react";
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

export default function App() {
  const { t } = useTranslation();
  const tabs = useSessions((s) => s.tabs);
  const activeTabId = useSessions((s) => s.activeTabId);
  const loadProfiles = useSessions((s) => s.loadProfiles);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

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
