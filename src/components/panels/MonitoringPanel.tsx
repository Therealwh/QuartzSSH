import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { useSessions } from "../../store/sessions";
import { ipc } from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import { GaugeIcon, PlugIcon, RefreshIcon } from "../icons";
import type { SystemStats } from "../../types";

interface StatsEvent {
  sessionId: string;
  stats: SystemStats;
}

interface ErrorEvent {
  sessionId: string;
  message: string;
}

type Translate = ReturnType<typeof useTranslation>["t"];

/** Progress bar color by usage thresholds: <60 ok, 60-85 warn, >85 danger. */
function barColor(percent: number): string {
  if (percent > 85) return "var(--q-danger)";
  if (percent >= 60) return "var(--q-warning)";
  return "var(--q-success)";
}

function Bar({ percent }: { percent: number }) {
  const pct = Math.min(100, Math.max(0, percent));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--q-border)]"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: barColor(pct) }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3 rounded-lg border border-[var(--q-border)] bg-[var(--q-panel)] p-3">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--q-muted)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function MetricRow({
  label,
  value,
  percent,
  hint,
}: {
  label: string;
  value: string;
  percent: number;
  hint?: string;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-[var(--q-text)]" title={label}>
          {label}
        </span>
        <span className="shrink-0 text-[var(--q-muted)]">{value}</span>
      </div>
      <Bar percent={percent} />
      {hint && <div className="mt-1 text-[11px] text-[var(--q-muted)]">{hint}</div>}
    </div>
  );
}

function formatUptime(secs: number, t: Translate): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}${t("monitoring.upD")}`);
  if (h > 0 || d > 0) parts.push(`${h}${t("monitoring.upH")}`);
  parts.push(`${m}${t("monitoring.upM")}`);
  return parts.join(" ");
}

function StatsView({ stats }: { stats: SystemStats }) {
  const { t } = useTranslation();
  const memPercent = stats.memTotal > 0 ? (stats.memUsed / stats.memTotal) * 100 : 0;
  const swapPercent = stats.swapTotal > 0 ? (stats.swapUsed / stats.swapTotal) * 100 : 0;

  return (
    <div>
      <Section title={t("monitoring.cpu")}>
        <div className="mb-2 flex items-end justify-between gap-3">
          <span className="text-2xl font-semibold tabular-nums text-[var(--q-text)]">
            {stats.cpuPercent === null ? "—" : `${stats.cpuPercent.toFixed(0)}%`}
          </span>
          <span className="pb-1 text-xs tabular-nums text-[var(--q-muted)]">
            {t("monitoring.load")}: {stats.load.map((v) => v.toFixed(2)).join(" / ")}
          </span>
        </div>
        {stats.cpuPercent !== null && <Bar percent={stats.cpuPercent} />}
      </Section>

      <Section title={t("monitoring.memory")}>
        <MetricRow
          label={t("monitoring.memory")}
          value={`${formatBytes(stats.memUsed)} / ${formatBytes(stats.memTotal)}`}
          percent={memPercent}
        />
        <MetricRow
          label={t("monitoring.swap")}
          value={`${formatBytes(stats.swapUsed)} / ${formatBytes(stats.swapTotal)}`}
          percent={swapPercent}
        />
      </Section>

      <Section title={t("monitoring.disks")}>
        {stats.disks.length === 0 ? (
          <div className="text-xs text-[var(--q-muted)]">{t("monitoring.noDiskData")}</div>
        ) : (
          stats.disks.map((d) => (
            <MetricRow
              key={d.mount}
              label={d.mount}
              value={`${formatBytes(d.used)} / ${formatBytes(d.total)}`}
              percent={d.total > 0 ? (d.used / d.total) * 100 : 0}
              hint={t("monitoring.free", { amount: formatBytes(Math.max(0, d.total - d.used)) })}
            />
          ))
        )}
      </Section>

      <Section title={t("monitoring.network")}>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-[var(--q-muted)]">{t("monitoring.rx")}</div>
            <div className="tabular-nums text-[var(--q-text)]">
              {t("monitoring.perSecond", { rate: formatBytes(stats.netRxBps) })}
            </div>
          </div>
          <div>
            <div className="text-[var(--q-muted)]">{t("monitoring.tx")}</div>
            <div className="tabular-nums text-[var(--q-text)]">
              {t("monitoring.perSecond", { rate: formatBytes(stats.netTxBps) })}
            </div>
          </div>
        </div>
      </Section>

      <Section title={t("monitoring.system")}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-[var(--q-muted)]">{t("monitoring.os")}</dt>
          <dd className="truncate text-[var(--q-text)]" title={stats.osName}>
            {stats.osName || "—"}
          </dd>
          <dt className="text-[var(--q-muted)]">{t("monitoring.kernel")}</dt>
          <dd className="truncate text-[var(--q-text)]" title={stats.kernel}>
            {stats.kernel || "—"}
          </dd>
          <dt className="text-[var(--q-muted)]">{t("monitoring.uptimeLabel")}</dt>
          <dd className="text-[var(--q-text)]">{formatUptime(stats.uptimeSecs, t)}</dd>
        </dl>
      </Section>

      <Section title={t("monitoring.processes")}>
        {stats.top.length === 0 ? (
          <div className="text-xs text-[var(--q-muted)]">{t("monitoring.noProcesses")}</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--q-muted)]">
                <th className="pb-1 font-medium">{t("monitoring.procName")}</th>
                <th className="pb-1 text-right font-medium">{t("monitoring.procCpu")}</th>
                <th className="pb-1 text-right font-medium">{t("monitoring.procMem")}</th>
              </tr>
            </thead>
            <tbody>
              {stats.top.map((p, i) => (
                <tr key={`${p.name}-${i}`} className="border-t border-[var(--q-border)]">
                  <td className="truncate py-1 pr-2 text-[var(--q-text)]" title={p.name}>
                    {p.name}
                  </td>
                  <td className="py-1 text-right tabular-nums text-[var(--q-text)]">
                    {p.cpuPercent.toFixed(1)}%
                  </td>
                  <td className="py-1 text-right tabular-nums text-[var(--q-text)]">
                    {p.memPercent.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

export function MonitoringPanel() {
  const { t } = useTranslation();
  const connections = useSessions((s) => s.connections);
  const profiles = useSessions((s) => s.profiles);

  const sessions = useMemo(
    () =>
      Object.entries(connections).map(([profileId, sessionId]) => {
        const profile = profiles.find((p) => p.id === profileId);
        return { sessionId, label: profile ? profile.name : sessionId };
      }),
    [connections, profiles],
  );

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the selection valid as sessions come and go.
  useEffect(() => {
    if (sessionId && !sessions.some((s) => s.sessionId === sessionId)) {
      setSessionId(sessions[0]?.sessionId ?? null);
      setStats(null);
      setError(null);
    } else if (!sessionId && sessions.length > 0) {
      setSessionId(sessions[0].sessionId);
    }
  }, [sessions, sessionId]);

  // Watcher lifecycle: open on selection, stop on switch/unmount.
  useEffect(() => {
    if (!sessionId) return;
    setStats(null);
    setError(null);
    void ipc.monitoringOpen(sessionId).catch((e) => setError(String(e)));
    return () => {
      void ipc.monitoringClose(sessionId).catch(() => undefined);
    };
  }, [sessionId]);

  // Live data and errors, filtered to the selected session.
  useEffect(() => {
    if (!sessionId) return;
    const unlisteners: Array<() => void> = [];
    void listen<StatsEvent>("monitor:stats", (e) => {
      if (e.payload.sessionId !== sessionId) return;
      setStats(e.payload.stats);
      setError(null);
    }).then((un) => unlisteners.push(un));
    void listen<ErrorEvent>("monitor:error", (e) => {
      if (e.payload.sessionId !== sessionId) return;
      setError(e.payload.message);
    }).then((un) => unlisteners.push(un));
    return () => unlisteners.forEach((un) => un());
  }, [sessionId]);

  const retry = () => {
    if (!sessionId) return;
    setError(null);
    void ipc.monitoringOpen(sessionId).catch((e) => setError(String(e)));
  };

  if (sessions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[var(--q-muted)]">
        <GaugeIcon size={28} />
        <div className="text-sm text-[var(--q-text)]">{t("monitoring.noSessions")}</div>
        <div className="text-xs">{t("monitoring.connectHint")}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--q-border)] bg-[var(--q-panel)] px-4 py-2">
        <h1 className="text-xs font-semibold uppercase tracking-wide text-[var(--q-muted)]">
          {t("monitoring.title")}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <PlugIcon size={13} className="text-[var(--q-muted)]" />
          <select
            className="q-input max-w-[220px] py-1 text-xs"
            value={sessionId ?? ""}
            onChange={(e) => setSessionId(e.target.value)}
            aria-label={t("monitoring.selectSession")}
          >
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <div className="mb-3 flex items-center gap-3 rounded-md border border-[var(--q-danger)] px-3 py-2 text-xs text-[var(--q-danger)]">
            <span className="flex-1 break-all">
              {t("monitoring.errorTitle")}: {error}
            </span>
            <button className="q-btn shrink-0 px-2 py-1 text-xs" onClick={retry}>
              <RefreshIcon size={12} /> {t("monitoring.retry")}
            </button>
          </div>
        )}
        {!stats && !error && (
          <div className="py-10 text-center text-xs text-[var(--q-muted)]">
            {t("monitoring.waiting")}
          </div>
        )}
        {stats && <StatsView stats={stats} />}
      </div>
    </div>
  );
}
