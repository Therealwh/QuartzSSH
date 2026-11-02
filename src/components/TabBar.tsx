import { useTranslation } from "react-i18next";
import { useSessions } from "../store/sessions";
import { CloseIcon, FolderIcon, SettingsIcon, TerminalIcon } from "./icons";

export function TabBar() {
  const { t } = useTranslation();
  const tabs = useSessions((s) => s.tabs);
  const activeTabId = useSessions((s) => s.activeTabId);
  const setActiveTab = useSessions((s) => s.setActiveTab);
  const closeTab = useSessions((s) => s.closeTab);

  return (
    <div
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-[var(--q-border)] bg-[var(--q-panel)]"
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(e) => e.key === "Enter" && setActiveTab(tab.id)}
            className={`group flex min-w-[120px] max-w-[220px] cursor-pointer items-center gap-2 border-r border-[var(--q-border)] px-3 text-sm ${
              active
                ? "bg-[var(--q-bg)] text-[var(--q-text)]"
                : "bg-[var(--q-panel)] text-[var(--q-muted)] hover:text-[var(--q-text)]"
            }`}
          >
            {tab.kind === "terminal" && <TerminalIcon />}
            {tab.kind === "sftp" && <FolderIcon />}
            {tab.kind === "settings" && <SettingsIcon />}
            <span className="flex-1 truncate">{tab.title}</span>
            {tab.disconnected && (
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--q-danger)]" title={t("terminal.disconnected")} />
            )}
            <button
              className="q-icon-btn opacity-0 group-hover:opacity-100"
              aria-label={`${t("sftp.delete")} ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation();
                void closeTab(tab.id);
              }}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
