import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { ipc } from "../lib/ipc";
import { useSessions } from "../store/sessions";
import { useDialogs } from "../store/dialogs";
import { useSettings } from "../store/settings";
import { THEMES, getTheme } from "../themes";

export function StatusBar() {
  const { t, i18n } = useTranslation();
  const connections = useSessions((s) => s.connections);
  const updateStatus = useDialogs((s) => s.updateStatus);
  const themeId = useSettings((s) => s.themeId);
  const setTheme = useSettings((s) => s.setTheme);
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);
  const [version, setVersion] = useState("");
  const [forwardCount, setForwardCount] = useState(0);

  useEffect(() => {
    void ipc.appVersion().then(setVersion).catch(() => undefined);
  }, []);

  // Total number of live forwards across all sessions; refreshed when the
  // connections change and whenever the backend reports a forward change.
  const refreshForwards = useCallback(async () => {
    let total = 0;
    for (const sessionId of Object.values(connections)) {
      try {
        total += (await ipc.forwardList(sessionId)).length;
      } catch {
        // Session may be gone; skip it.
      }
    }
    setForwardCount(total);
  }, [connections]);

  useEffect(() => {
    void refreshForwards();
  }, [refreshForwards]);

  useEffect(() => {
    const unlisten = listen("forward:changed", () => {
      void refreshForwards();
    });
    return () => {
      void unlisten.then((un) => un());
    };
  }, [refreshForwards]);

  const count = Object.keys(connections).length;
  const theme = getTheme(themeId);
  const nextTheme = THEMES[(THEMES.findIndex((x) => x.id === themeId) + 1) % THEMES.length];

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 bg-[var(--q-panel)] px-3 text-[11px] text-[var(--q-muted)]">
      <span aria-live="polite">
        {count > 0 ? t("status.sessions", { count }) : t("status.noSessions")}
      </span>
      {forwardCount > 0 && (
        <span title={t("forward.title")}>{t("forward.active", { count: forwardCount })}</span>
      )}
      {updateStatus && <span className="text-[var(--q-warning)]">{updateStatus}</span>}
      <span className="ml-auto">{version && `v${version}`}</span>
      <button
        className="hover:text-[var(--q-text)]"
        title={t("status.theme")}
        onClick={() => setTheme(nextTheme.id)}
      >
        {theme.name}
      </button>
      <button
        className="hover:text-[var(--q-text)]"
        title={t("status.language")}
        onClick={() => {
          const next = language === "ru" ? "en" : "ru";
          setLanguage(next);
          void i18n.changeLanguage(next);
        }}
      >
        {language.toUpperCase()}
      </button>
    </footer>
  );
}
