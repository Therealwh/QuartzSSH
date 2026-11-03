import { useTranslation } from "react-i18next";
import { useNotifications } from "../store/notifications";
import { CloseIcon } from "./icons";

const KIND_COLORS: Record<string, string> = {
  error: "var(--q-danger)",
  info: "var(--q-accent)",
  success: "var(--q-success)",
};

/** Bottom-right toast stack; connection and transfer errors surface here. */
export function Toasts() {
  const { t } = useTranslation();
  const toasts = useNotifications((s) => s.toasts);
  const dismiss = useNotifications((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-10 right-4 z-[70] flex w-80 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-start gap-2 rounded-lg border-l-4 bg-[var(--q-panel)] p-3 shadow-lg"
          style={{ borderLeftColor: KIND_COLORS[toast.kind] ?? "var(--q-accent)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: KIND_COLORS[toast.kind] }}>
              {toast.kind === "error"
                ? t("errors.generic")
                : toast.kind === "success"
                  ? t("transfer.done")
                  : t("app.title")}
            </div>
            <div className="break-words text-xs">{toast.text}</div>
          </div>
          <button className="q-icon-btn shrink-0" aria-label={t("terminal.close")} onClick={() => dismiss(toast.id)}>
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
