import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { ipc } from "../../lib/ipc";
import type {
  AppSettings,
  KnownHostEntry,
  McpAuditEntry,
  McpConfirmationMode,
  McpConfirmRequest,
  McpStatus,
} from "../../types";
import { useSettings } from "../../store/settings";
import { useAutoReconnect, useSessions } from "../../store/sessions";
import { useDialogs } from "../../store/dialogs";
import { DEFAULT_THEME_ID, THEMES, buildCustomTheme, getTheme } from "../../themes";
import type { CustomThemeDraft, Theme } from "../../themes";
import { LANGUAGES, type LanguageId } from "../../i18n";
import { manualCheck } from "../../lib/updater";
import { Modal } from "../dialogs/Modal";
import { TrashIcon } from "../icons";

const MCP_PORT_MIN = 47200;
const MCP_PORT_MAX = 47300;

const MONO_FONTS = [
  "Cascadia Mono, Consolas, Menlo, monospace",
  "Consolas, monospace",
  "JetBrains Mono, monospace",
  "Fira Code, monospace",
  "Courier New, monospace",
];

const HEX_RE = /^#[0-9a-f]{6}$/i;

type BuilderColorKey =
  | "uiBg"
  | "uiPanel"
  | "uiAccent"
  | "uiText"
  | "termBg"
  | "termFg"
  | "termCursor"
  | "termSelection";

const BUILDER_COLORS: { key: BuilderColorKey; label: string }[] = [
  { key: "uiBg", label: "themeCustom.uiBg" },
  { key: "uiPanel", label: "themeCustom.uiPanel" },
  { key: "uiAccent", label: "themeCustom.accent" },
  { key: "uiText", label: "themeCustom.text" },
  { key: "termBg", label: "themeCustom.termBg" },
  { key: "termFg", label: "themeCustom.termFg" },
  { key: "termCursor", label: "themeCustom.cursor" },
  { key: "termSelection", label: "themeCustom.selection" },
];

/** Reset the builder fields from a base theme (keeping the typed name). */
function draftFromTheme(theme: Theme, keepName = ""): CustomThemeDraft {
  return {
    name: keepName,
    baseId: theme.id,
    uiBg: theme.ui.bg,
    uiPanel: theme.ui.panel,
    uiAccent: theme.ui.accent,
    uiText: theme.ui.text,
    termBg: theme.term.bg,
    termFg: theme.term.fg,
    termCursor: theme.term.cursor,
    termSelection: theme.term.selection,
    ansi: [...theme.term.ansi],
  };
}

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
            {[...THEMES, ...ui.customThemes].map((theme) => {
              const isCustom = theme.id.startsWith("custom-");
              return (
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
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate">{theme.name}</span>
                    {isCustom && (
                      <span className="shrink-0 rounded bg-[var(--q-elevated)] px-1 text-[9px] uppercase tracking-wide text-[var(--q-muted)]">
                        {t("themeCustom.badge")}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </Row>
        <Row label={t("settings.transparency")} hint={t("settings.transparencyHint")}>
          <label className="flex items-center gap-2 text-xs text-[var(--q-muted)]">
            <input
              type="range"
              min={70}
              max={100}
              value={Math.round(ui.bgOpacity * 100)}
              onChange={(e) => ui.setBgOpacity(Number(e.target.value) / 100)}
            />
            <span className="w-10 text-center">{Math.round(ui.bgOpacity * 100)}%</span>
          </label>
        </Row>
        <ThemeBuilder />
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

      <McpServerSection backend={backend} saveBackend={saveBackend} />

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

// ---------------------------------------------------------------------------
// Theme builder (spec 4.2): pick a base, recolor the essentials, save locally.
// ---------------------------------------------------------------------------

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-[var(--q-muted)]">
      <input
        type="color"
        className="h-7 w-9 shrink-0 cursor-pointer rounded border border-[var(--q-border)] bg-transparent p-0"
        value={HEX_RE.test(value) ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="truncate">{label}</span>
    </label>
  );
}

function ThemeBuilder() {
  const { t } = useTranslation();
  const customThemes = useSettings((s) => s.customThemes);
  const saveCustomTheme = useSettings((s) => s.saveCustomTheme);
  const setTheme = useSettings((s) => s.setTheme);
  const deleteCustomTheme = useSettings((s) => s.deleteCustomTheme);
  const [draft, setDraft] = useState<CustomThemeDraft>(() =>
    draftFromTheme(getTheme(DEFAULT_THEME_ID)),
  );

  // The Theme that the current draft produces (id/isDark computed on the fly).
  const preview = useMemo(() => buildCustomTheme(draft), [draft]);
  const isSaved = customThemes.some((saved) => saved.id === preview.id);

  return (
    <div className="space-y-3 rounded-lg border border-[var(--q-border)] p-3">
      <div className="text-sm">{t("themeCustom.title")}</div>
      <div className="text-xs text-[var(--q-muted)]">{t("themeCustom.hint")}</div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="q-input w-56"
          value={draft.baseId}
          aria-label={t("themeCustom.base")}
          onChange={(e) =>
            setDraft((d) => draftFromTheme(getTheme(e.target.value), d.name))
          }
        >
          {THEMES.map((base) => (
            <option key={base.id} value={base.id}>
              {base.name}
            </option>
          ))}
        </select>
        <input
          className="q-input w-48"
          value={draft.name}
          placeholder={t("themeCustom.namePlaceholder")}
          aria-label={t("themeCustom.name")}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {BUILDER_COLORS.map((field) => (
          <ColorField
            key={field.key}
            label={t(field.label)}
            value={draft[field.key]}
            onChange={(v) => setDraft((d) => ({ ...d, [field.key]: v }))}
          />
        ))}
      </div>

      <div>
        <div className="mb-1 text-xs text-[var(--q-muted)]">{t("themeCustom.ansi")}</div>
        <div className="grid grid-cols-8 gap-1">
          {draft.ansi.map((color, i) => (
            <input
              key={i}
              type="color"
              title={`ANSI ${i}`}
              className="h-6 w-full cursor-pointer rounded border border-[var(--q-border)] bg-transparent p-0"
              value={HEX_RE.test(color) ? color : "#000000"}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  ansi: d.ansi.map((c, j) => (j === i ? e.target.value : c)),
                }))
              }
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {[preview.ui.bg, preview.ui.accent, preview.term.ansi[1], preview.term.ansi[2], preview.term.ansi[4]].map((c, i) => (
            <span key={i} className="h-4 w-4 rounded border border-[var(--q-border)]" style={{ background: c }} />
          ))}
          <span className="ml-2 font-mono text-xs text-[var(--q-muted)]">{preview.id}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="q-btn text-xs" onClick={() => saveCustomTheme(preview)}>
            {t("themeCustom.save")}
          </button>
          <button
            className="q-btn q-btn-primary text-xs"
            onClick={() => {
              saveCustomTheme(preview);
              setTheme(preview.id);
            }}
          >
            {t("themeCustom.apply")}
          </button>
          <button
            className="q-btn q-btn-danger text-xs"
            disabled={!isSaved}
            onClick={() => deleteCustomTheme(preview.id)}
          >
            {t("themeCustom.delete")}
          </button>
          {isSaved && <span className="text-xs text-[var(--q-success)]">{t("themeCustom.saved")}</span>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MCP server ("QuartzSSH as a bridge for AI agents")
// ---------------------------------------------------------------------------

/** Client configuration snippet for opencode.json (see docs/mcp-server.md). */
function opencodeConfig(port: number): string {
  return JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        quartzssh: {
          type: "remote",
          url: `http://127.0.0.1:${port}/mcp`,
          enabled: true,
          headers: { Authorization: "Bearer {env:QUARTZSSH_MCP_TOKEN}" },
        },
      },
    },
    null,
    2,
  );
}

function McpServerSection({
  backend,
  saveBackend,
}: {
  backend: AppSettings;
  saveBackend: (next: AppSettings) => Promise<void>;
}) {
  const { t } = useTranslation();
  const profiles = useSessions((s) => s.profiles);
  const loadProfiles = useSessions((s) => s.loadProfiles);
  const [status, setStatus] = useState<McpStatus | null>(null);
  /** Token of the current run; only known after Start / Regenerate. */
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [audit, setAudit] = useState<McpAuditEntry[]>([]);
  const [confirm, setConfirm] = useState<McpConfirmRequest | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [configCopied, setConfigCopied] = useState(false);
  const [port, setPort] = useState(String(backend.mcp.port));

  const refreshStatus = () => ipc.mcpStatus().then(setStatus).catch(() => undefined);
  const refreshAudit = () => ipc.mcpAuditList().then(setAudit).catch(() => undefined);

  useEffect(() => {
    void refreshStatus();
    void refreshAudit();
    if (useSessions.getState().profiles.length === 0) void loadProfiles();
    const unlisten = listen<McpConfirmRequest>("mcp:confirm", (e) => setConfirm(e.payload));
    return () => {
      void unlisten.then((un) => un());
    };
  }, []);

  useEffect(() => {
    setPort(String(backend.mcp.port));
  }, [backend.mcp.port]);

  const start = async () => {
    try {
      const result = await ipc.mcpStart();
      setToken(result.token);
    } catch (e) {
      useDialogs.getState().setUpdateStatus(String(e));
    }
    await refreshStatus();
  };

  const stop = async () => {
    await ipc.mcpStop().catch(() => undefined);
    setToken(null);
    await refreshStatus();
  };

  const onToggle = () => {
    if (status?.running) {
      void stop();
    } else if (!backend.mcp.enabled) {
      // First enablement: show the warning once, then persist the opt-in.
      setShowWarning(true);
    } else {
      void start();
    }
  };

  const acceptFirstEnable = async () => {
    setShowWarning(false);
    await saveBackend({ ...backend, mcp: { ...backend.mcp, enabled: true } });
    await start();
  };

  const copyToken = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const toggleAllow = (id: string) => {
    const current = backend.mcp.allowlistProfileIds;
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    void saveBackend({ ...backend, mcp: { ...backend.mcp, allowlistProfileIds: next } });
  };

  const savePort = () => {
    const parsed = Number(port);
    const clamped = Math.min(MCP_PORT_MAX, Math.max(MCP_PORT_MIN, parsed || 47215));
    setPort(String(clamped));
    if (clamped !== backend.mcp.port) {
      void saveBackend({ ...backend, mcp: { ...backend.mcp, port: clamped } });
    }
  };

  const answerConfirm = (approved: boolean) => {
    if (confirm) void ipc.mcpConfirm(confirm.callId, approved).catch(() => undefined);
    setConfirm(null);
  };

  const copyConfig = async () => {
    await navigator.clipboard.writeText(opencodeConfig(status?.port ?? backend.mcp.port));
    setConfigCopied(true);
    setTimeout(() => setConfigCopied(false), 1500);
  };

  return (
    <Section title={t("mcp.title")}>
      <Row label={t("mcp.serverStatus")} hint={t("mcp.description")}>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${status?.running ? "text-[var(--q-success)]" : "text-[var(--q-muted)]"}`}>
            {status?.running ? t("mcp.running") : t("mcp.stopped")}
          </span>
          <button
            className={`q-btn text-xs ${status?.running ? "q-btn-danger" : "q-btn-primary"}`}
            onClick={onToggle}
          >
            {status?.running ? t("mcp.stop") : t("mcp.start")}
          </button>
        </div>
      </Row>

      <Row label={t("mcp.port")} hint={t("mcp.portHint")}>
        <input
          type="number"
          className="q-input w-28"
          min={MCP_PORT_MIN}
          max={MCP_PORT_MAX}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          onBlur={savePort}
        />
      </Row>

      <Row label={t("mcp.token")} hint={t("mcp.tokenHint")}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs">
            {token ? `••••${token.slice(-4)}` : status?.hasToken ? t("mcp.tokenMasked") : "—"}
          </span>
          <button className="q-btn text-xs" disabled={!token} onClick={() => void copyToken()}>
            {copied ? t("mcp.copied") : t("mcp.copy")}
          </button>
          <button className="q-btn text-xs" onClick={() => void start()}>
            {t("mcp.regenerate")}
          </button>
        </div>
      </Row>

      <Row label={t("mcp.allowlist")} hint={t("mcp.allowlistHint")}>
        <div className="w-full">
          {profiles.length === 0 && (
            <div className="text-xs text-[var(--q-muted)]">{t("mcp.allowlistEmpty")}</div>
          )}
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {profiles.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--q-hover)]"
              >
                <input
                  type="checkbox"
                  checked={backend.mcp.allowlistProfileIds.includes(p.id)}
                  onChange={() => toggleAllow(p.id)}
                />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="font-mono text-[var(--q-muted)]">
                  {p.host}:{p.port}
                </span>
              </label>
            ))}
          </div>
        </div>
      </Row>

      <Row label={t("mcp.confirmationMode")} hint={t("mcp.confirmationModeHint")}>
        <select
          className="q-input w-64"
          value={backend.mcp.confirmationMode}
          onChange={(e) =>
            void saveBackend({
              ...backend,
              mcp: { ...backend.mcp, confirmationMode: e.target.value as McpConfirmationMode },
            })
          }
        >
          <option value="always">{t("mcp.confirmAlways")}</option>
          <option value="destructive">{t("mcp.confirmDestructive")}</option>
          <option value="never">{t("mcp.confirmNever")}</option>
        </select>
      </Row>

      <Row label={t("mcp.clientConfig")} hint={t("mcp.clientConfigHint")}>
        <button className="q-btn text-xs" onClick={() => setShowConfig(true)}>
          {t("mcp.showClientConfig")}
        </button>
      </Row>

      <Row label={t("mcp.audit")} hint={t("mcp.auditHint")}>
        <div className="w-full">
          {audit.length === 0 && (
            <div className="text-xs text-[var(--q-muted)]">{t("mcp.auditEmpty")}</div>
          )}
          <div className="max-h-48 space-y-1 overflow-y-auto font-mono text-xs">
            {audit
              .slice(-20)
              .reverse()
              .map((entry, i) => (
                <div
                  key={`${entry.timestamp}-${i}`}
                  className="flex items-center gap-2 rounded px-2 py-1 hover:bg-[var(--q-hover)]"
                >
                  <span className="shrink-0 text-[var(--q-muted)]">
                    {new Date(entry.timestamp * 1000).toLocaleTimeString()}
                  </span>
                  <span className="shrink-0">{entry.tool}</span>
                  <span className="shrink-0 text-[var(--q-muted)]">{entry.host}</span>
                  <span className="flex-1 truncate text-[var(--q-muted)]">{entry.argsSummary}</span>
                  <span
                    className="shrink-0"
                    style={{ color: entry.status === "ok" ? "var(--q-success)" : "var(--q-danger)" }}
                  >
                    {entry.status}
                  </span>
                </div>
              ))}
          </div>
          {audit.length > 0 && (
            <button
              className="q-btn mt-2 text-xs"
              onClick={async () => {
                await ipc.mcpAuditClear().catch(() => undefined);
                await refreshAudit();
              }}
            >
              {t("mcp.auditClear")}
            </button>
          )}
        </div>
      </Row>

      {showWarning && (
        <Modal title={t("mcp.warningTitle")} onClose={() => setShowWarning(false)}>
          <p className="text-sm leading-relaxed">{t("mcp.warningText")}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="q-btn" onClick={() => setShowWarning(false)}>
              {t("mcp.cancel")}
            </button>
            <button className="q-btn q-btn-primary" onClick={() => void acceptFirstEnable()}>
              {t("mcp.warningAccept")}
            </button>
          </div>
        </Modal>
      )}

      {confirm && (
        <Modal title={t("mcp.confirmTitle")} onClose={() => setConfirm(null)}>
          <p className="text-sm">{t("mcp.confirmText")}</p>
          <dl className="mt-3 space-y-2 rounded-lg border border-[var(--q-border)] bg-[var(--q-bg)] p-3 text-sm">
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-[var(--q-muted)]">{t("mcp.confirmTool")}</dt>
              <dd className="font-mono">{confirm.tool}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-[var(--q-muted)]">{t("mcp.confirmHost")}</dt>
              <dd className="font-mono">{confirm.host}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-[var(--q-muted)]">{t("mcp.confirmSummary")}</dt>
              <dd className="break-all font-mono">{confirm.summary}</dd>
            </div>
          </dl>
          <div className="mt-4 flex justify-end gap-2">
            <button className="q-btn" onClick={() => answerConfirm(false)}>
              {t("mcp.deny")}
            </button>
            <button className="q-btn q-btn-danger" onClick={() => answerConfirm(true)}>
              {t("mcp.approve")}
            </button>
          </div>
        </Modal>
      )}

      {showConfig && (
        <Modal title={t("mcp.clientConfigTitle")} onClose={() => setShowConfig(false)} wide>
          <p className="text-xs text-[var(--q-muted)]">{t("mcp.clientConfigHint")}</p>
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-[var(--q-border)] bg-[var(--q-bg)] p-3 font-mono text-xs">
            {opencodeConfig(status?.port ?? backend.mcp.port)}
          </pre>
          <div className="mt-4 flex justify-end gap-2">
            <button className="q-btn" onClick={() => void copyConfig()}>
              {configCopied ? t("mcp.copied") : t("mcp.copy")}
            </button>
          </div>
        </Modal>
      )}
    </Section>
  );
}
