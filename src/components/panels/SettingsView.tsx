import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "../../lib/ipc";
import type { AppSettings, KnownHostEntry } from "../../types";
import { useSettings } from "../../store/settings";
import { useAutoReconnect } from "../../store/sessions";
import { THEMES } from "../../themes";
import { LANGUAGES, type LanguageId } from "../../i18n";
import { manualCheck } from "../../lib/updater";
import { useDialogs } from "../../store/dialogs";
import { TrashIcon } from "../icons";

const MONO_FONTS = [
  "Cascadia Mono, Consolas, Menlo, monospace",
  "Consolas, monospace",
  "JetBrains Mono, monospace",
  "Fira Code, monospace",
  "Courier New, monospace",
];

export function SettingsView() {
  const { t, i18n } = useTranslation();
  const ui = useSettings();
  const setUpdateStatus = useDialogs((s) => s.setUpdateStatus);
  const [backend, setBackend] = useState<AppSettings | null>(null);
  const [hosts, setHosts] = useState<KnownHostEntry[]>([]);
  const [version, setVersion] = useState("");

  useEffect(() => {
    void ipc.settingsGet().then(setBackend).catch(() => undefined);
    void ipc.knownHostsList().then(setHosts).catch(() => undefined);
    void ipc.appVersion().then(setVersion).catch(() => undefined);
  }, []);

  const saveBackend = async (next: AppSettings) => {
    setBackend(next);
    try {
      await ipc.settingsSet(next);
      useAutoReconnect.getState().set(next.autoReconnect, next.reconnectDelaySeconds);
    } catch (e) {
      setUpdateStatus(String(e));
    }
  };

  if (!backend) return null;

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-6 py-6">
      <h1 className="mb-6 text-lg font-semibold">{t("settings.title")}</h1>

      <Section title={t("settings.appearance")}>
        <Row label={t("settings.theme")}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                className={`rounded-lg border p-2 text-left text-xs ${
                  ui.themeId === theme.id
                    ? "border-[var(--q-accent)]"
                    : "border-[var(--q-border)] hover:border-[var(--q-muted)]"
                }`}
                onClick={() => ui.setTheme(theme.id)}
              >
                <div className="mb-1 flex gap-1">
                  {[theme.ui.bg, theme.ui.accent, theme.term.ansi[1], theme.term.ansi[2], theme.term.ansi[4]].map((c, i) => (
                    <span key={i} className="h-4 w-4 rounded" style={{ background: c }} />
                  ))}
                </div>
                {theme.name}
              </button>
            ))}
          </div>
        </Row>
        <Row label={t("settings.language")}>
          <select
            className="q-input w-40"
            value={ui.language}
            onChange={(e) => {
              const lang = e.target.value as LanguageId;
              ui.setLanguage(lang);
              void i18n.changeLanguage(lang);
            }}
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t("settings.font")}>
          <div className="flex items-center gap-3">
            <select
              className="q-input w-64"
              value={ui.fontFamily}
              onChange={(e) => ui.setFont(e.target.value, ui.fontSize)}
            >
              {MONO_FONTS.map((f) => (
                <option key={f} value={f}>
                  {f.split(",")[0]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-[var(--q-muted)]">
              {t("settings.fontSize")}
              <input
                type="range"
                min={9}
                max={24}
                value={ui.fontSize}
                onChange={(e) => ui.setFont(ui.fontFamily, Number(e.target.value))}
              />
              <span className="w-6 text-center">{ui.fontSize}</span>
            </label>
          </div>
        </Row>
      </Section>

      <Section title={t("settings.security")}>
        <Row label={t("settings.hostKeyMode")}>
          <select
            className="q-input w-64"
            value={backend.hostKeyMode}
            onChange={(e) => void saveBackend({ ...backend, hostKeyMode: e.target.value as AppSettings["hostKeyMode"] })}
          >
            <option value="strict">{t("settings.hostKeyStrict")}</option>
            <option value="acceptFirst">{t("settings.hostKeyAcceptFirst")}</option>
          </select>
        </Row>
        <Row label={t("settings.preferPq")} hint={t("settings.preferPqHint")}>
          <input
            type="checkbox"
            checked={backend.preferPqKex}
            onChange={(e) => void saveBackend({ ...backend, preferPqKex: e.target.checked })}
          />
        </Row>
        <Row label={t("connect.autoReconnect")}>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={backend.autoReconnect}
              onChange={(e) => void saveBackend({ ...backend, autoReconnect: e.target.checked })}
            />
            <input
              type="number"
              className="w-20"
              min={1}
              max={120}
              value={backend.reconnectDelaySeconds}
              onChange={(e) => void saveBackend({ ...backend, reconnectDelaySeconds: Number(e.target.value) })}
            />
            <span className="text-xs text-[var(--q-muted)]">сек / sec</span>
          </div>
        </Row>

        <Row label={t("settings.knownHosts")}>
          <div className="w-full">
            {hosts.length === 0 && <div className="text-xs text-[var(--q-muted)]">{t("settings.knownHostsEmpty")}</div>}
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {hosts.map((h, i) => (
                <div key={i} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--q-hover)]">
                  <span className="flex-1 font-mono">
                    {h.host}:{h.port}
                  </span>
                  <span className="max-w-[280px] truncate text-[var(--q-muted)]">{h.fingerprint}</span>
                  <button
                    className="q-icon-btn"
                    title={t("settings.knownHostsRemove")}
                    onClick={async () => {
                      await ipc.knownHostsRemove(h.host, h.port).catch(() => undefined);
                      setHosts(await ipc.knownHostsList());
                    }}
                  >
                    <TrashIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              className="q-btn mt-2 text-xs"
              onClick={async () => {
                await ipc.knownHostsImportSystem().catch(() => undefined);
                setHosts(await ipc.knownHostsList());
              }}
            >
              {t("settings.knownHostsImport")}
            </button>
          </div>
        </Row>
      </Section>

      <Section title={t("settings.updates")}>
        <Row label={t("settings.checkOnStart")}>
          <input
            type="checkbox"
            checked={backend.checkUpdatesOnStart}
            onChange={(e) => void saveBackend({ ...backend, checkUpdatesOnStart: e.target.checked })}
          />
        </Row>
        <Row label={t("settings.interval")}>
          <input
            type="number"
            className="w-24"
            min={30}
            max={10080}
            value={backend.updateCheckIntervalMinutes}
            onChange={(e) => void saveBackend({ ...backend, updateCheckIntervalMinutes: Number(e.target.value) })}
          />
        </Row>
        <Row label={t("settings.checkNow")}>
          <button
            className="q-btn text-xs"
            onClick={async () => {
              const result = await manualCheck();
              if (result === "up_to_date") setUpdateStatus(t("updater.upToDate"));
              else if (result === "failed") setUpdateStatus(t("updater.failed"));
            }}
          >
            {t("settings.checkNow")}
          </button>
        </Row>
      </Section>

      <Section title={t("settings.about")}>
        <Row label={t("settings.version")}>
          <span>{version}</span>
        </Row>
        <Row label={t("settings.license")}>
          <a
            className="text-[var(--q-accent)] underline-offset-2 hover:underline"
            href="https://github.com/Therealwh/QuartzSSH/blob/main/LICENSE"
            target="_blank"
            rel="noreferrer"
          >
            MIT
          </a>
        </Row>
        <Row label={t("settings.repository")}>
          <a
            className="text-[var(--q-accent)] underline-offset-2 hover:underline"
            href="https://github.com/Therealwh/QuartzSSH"
            target="_blank"
            rel="noreferrer"
          >
            github.com/Therealwh/QuartzSSH
          </a>
        </Row>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 border-b border-[var(--q-border)] pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--q-muted)]">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-[var(--q-muted)]">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
