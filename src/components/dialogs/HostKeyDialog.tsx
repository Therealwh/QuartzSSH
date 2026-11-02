import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";
import { useDialogs } from "../../store/dialogs";
import { useSessions } from "../../store/sessions";
import { ShieldIcon } from "../icons";

export function HostKeyDialog() {
  const { t } = useTranslation();
  const hostKey = useDialogs((s) => s.hostKey);
  const answerHostKey = useDialogs((s) => s.answerHostKey);
  const dismissHostKey = useDialogs((s) => s.dismissHostKey);
  const openSettingsTab = useSessions((s) => s.openSettingsTab);

  if (!hostKey) return null;
  const changed = hostKey.status === "changed";

  return (
    <Modal
      title={changed ? t("hostkey.changedTitle") : t("hostkey.newTitle")}
      onClose={dismissHostKey}
      wide
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-1 shrink-0"
          style={{ color: changed ? "var(--q-danger)" : "var(--q-warning)" }}
        >
          <ShieldIcon size={28} />
        </span>
        <p className="text-sm leading-relaxed">
          {changed ? t("hostkey.changedText", { host: hostKey.host }) : t("hostkey.newText", { host: hostKey.host })}
        </p>
      </div>

      <dl className="mt-4 space-y-2 rounded-lg border border-[var(--q-border)] bg-[var(--q-bg)] p-3 text-sm">
        <div className="flex gap-2">
          <dt className="w-44 shrink-0 text-[var(--q-muted)]">{t("hostkey.keyType")}</dt>
          <dd className="font-mono">{hostKey.keyType}</dd>
        </div>
        {changed && (
          <div className="flex gap-2">
            <dt className="w-44 shrink-0 text-[var(--q-muted)]">{t("hostkey.previousFingerprint")}</dt>
            <dd className="break-all font-mono text-[var(--q-danger)]">{hostKey.previousFingerprint}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="w-44 shrink-0 text-[var(--q-muted)]">{t("hostkey.fingerprint")}</dt>
          <dd className="break-all font-mono">{hostKey.fingerprint}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          className="q-btn"
          onClick={() => {
            dismissHostKey();
            openSettingsTab();
          }}
        >
          {t("hostkey.openKnownHosts")}
        </button>
        {!changed && (
          <button className="q-btn q-btn-primary" onClick={() => answerHostKey("acceptRemember")}>
            {t("hostkey.acceptRemember")}
          </button>
        )}
        {changed ? (
          <button className="q-btn q-btn-danger" onClick={() => answerHostKey("accept")}>
            {t("hostkey.acceptDanger")}
          </button>
        ) : (
          <button className="q-btn" onClick={() => answerHostKey("accept")}>
            {t("hostkey.accept")}
          </button>
        )}
        <button className="q-btn" onClick={dismissHostKey}>
          {t("hostkey.reject")}
        </button>
      </div>
    </Modal>
  );
}
