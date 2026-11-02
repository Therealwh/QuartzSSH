import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTransfers } from "../store/transfers";
import { CloseIcon } from "./icons";
import { formatBytes } from "../lib/format";

export function TransfersBar() {
  const { t } = useTranslation();
  const transfers = useTransfers((s) => s.transfers);
  const cancel = useTransfers((s) => s.cancel);
  const clearFinished = useTransfers((s) => s.clearFinished);
  const [expanded, setExpanded] = useState(true);

  const list = Object.values(transfers);
  const active = list.filter((x) => x.status === "active");
  if (list.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-[var(--q-border)] bg-[var(--q-panel)] text-xs">
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[var(--q-muted)] hover:text-[var(--q-text)]"
        onClick={() => setExpanded((v) => !v)}
      >
        {t("sftp.transfers")} — {active.length}/{list.length}
        <span className="ml-auto flex gap-2">
          {list.some((x) => x.status !== "active") && (
            <span
              className="underline-offset-2 hover:underline"
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                clearFinished();
              }}
            >
              {t("transfer.clearFinished")}
            </span>
          )}
        </span>
      </button>
      {expanded && (
        <div className="max-h-32 overflow-y-auto px-3 pb-2">
          {list.map((x) => {
            const pct = x.total > 0 ? Math.min(100, Math.round((x.transferred / x.total) * 100)) : 0;
            const color =
              x.status === "failed"
                ? "var(--q-danger)"
                : x.status === "cancelled"
                  ? "var(--q-warning)"
                  : x.status === "done"
                    ? "var(--q-success)"
                    : "var(--q-accent)";
            return (
              <div key={x.id} className="flex items-center gap-2 py-1" aria-live="polite">
                <span className="w-16 shrink-0 text-[var(--q-muted)]">
                  {x.kind === "upload" ? t("transfer.upload") : t("transfer.download")}
                </span>
                <span className="w-40 shrink-0 truncate">{x.fileName}</span>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-[var(--q-elevated)]">
                  <div
                    className="h-full rounded transition-[width] duration-200"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-[var(--q-muted)]">
                  {formatBytes(x.transferred)} / {formatBytes(x.total)}
                </span>
                {x.status === "active" ? (
                  <button
                    className="q-icon-btn"
                    aria-label={t("sftp.cancelTransfer")}
                    onClick={() => void cancel(x.id)}
                  >
                    <CloseIcon size={12} />
                  </button>
                ) : (
                  <span className="w-[26px] text-center" style={{ color }}>
                    {x.status === "done" ? "✓" : x.status === "failed" ? "✕" : "⃠"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
