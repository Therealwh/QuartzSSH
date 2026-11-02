import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";
import { useDialogs } from "../../store/dialogs";
import { installUpdate } from "../../lib/updater";

export function UpdateDialog() {
  const { t } = useTranslation();
  const update = useDialogs((s) => s.update);
  const hideUpdate = useDialogs((s) => s.hideUpdate);

  if (!update) return null;

  return (
    <Modal title={t("updater.available", { version: update.version })} onClose={update.downloading ? undefined : hideUpdate}>
      {update.notes && (
        <pre className="mb-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--q-border)] bg-[var(--q-bg)] p-3 text-xs leading-relaxed text-[var(--q-muted)]">
          {update.notes}
        </pre>
      )}
      <div className="flex justify-end gap-2">
        <button className="q-btn" disabled={update.downloading} onClick={hideUpdate}>
          {t("updater.later")}
        </button>
        <button
          className="q-btn q-btn-primary"
          disabled={update.downloading}
          onClick={() => void installUpdate()}
        >
          {update.downloading ? t("updater.downloading") : t("updater.install")}
        </button>
      </div>
    </Modal>
  );
}
