import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";
import { useDialogs } from "../../store/dialogs";

export function ConfirmDialog() {
  const { t } = useTranslation();
  const confirm = useDialogs((s) => s.confirm);
  const close = useDialogs((s) => s.closeConfirm);

  if (!confirm) return null;

  return (
    <Modal title={confirm.title} onClose={() => close(false)}>
      <p className="mb-4 text-sm leading-relaxed">{confirm.message}</p>
      <div className="flex justify-end gap-2">
        <button className="q-btn" onClick={() => close(false)}>
          {t("prompt.cancel")}
        </button>
        <button
          className={`q-btn ${confirm.danger ? "q-btn-danger" : "q-btn-primary"}`}
          onClick={() => close(true)}
        >
          OK
        </button>
      </div>
    </Modal>
  );
}
