import { useTranslation } from "react-i18next";
import { useSessions } from "../store/sessions";
import { TerminalIcon, FolderIcon, SettingsIcon } from "./icons";

export function ActivityBar() {
  const { t } = useTranslation();
  const tabs = useSessions((s) => s.tabs);
  const activeTabId = useSessions((s) => s.activeTabId);
  const setActiveTab = useSessions((s) => s.setActiveTab);
  const openSettingsTab = useSessions((s) => s.openSettingsTab);

  const firstTerminalTab = tabs.find((tab) => tab.kind === "terminal");

  const item =
    "flex h-12 w-12 items-center justify-center text-[var(--q-muted)] hover:text-[var(--q-text)] hover:bg-[var(--q-hover)]";
  const itemActive = "text-[var(--q-text)] bg-[var(--q-active)]";

  return (
    <nav
      className="flex w-12 shrink-0 flex-col items-center border-r border-[var(--q-border)] bg-[var(--q-panel)]"
      aria-label="Activity bar"
    >
      <button
        className={`${item} ${firstTerminalTab && activeTabId === firstTerminalTab.id ? itemActive : ""}`}
        title={t("activity.sessions")}
        aria-label={t("activity.sessions")}
        onClick={() => firstTerminalTab && setActiveTab(firstTerminalTab.id)}
      >
        <TerminalIcon size={20} />
      </button>
      <button
        className={`${item} ${tabs.some((tab) => tab.id === activeTabId && tab.kind === "sftp") ? itemActive : ""}`}
        title={t("activity.sftp")}
        aria-label={t("activity.sftp")}
        onClick={() => firstTerminalTab && setActiveTab(firstTerminalTab.id)}
      >
        <FolderIcon size={20} />
      </button>
      <button
        className={`${item} ${tabs.some((tab) => tab.id === activeTabId && tab.kind === "settings") ? itemActive : ""}`}
        title={t("activity.settings")}
        aria-label={t("activity.settings")}
        onClick={openSettingsTab}
      >
        <SettingsIcon size={20} />
      </button>
    </nav>
  );
}
