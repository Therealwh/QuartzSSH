import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";
import { useDialogs } from "../../store/dialogs";

export function PasswordDialog() {
  const { t } = useTranslation();
  const prompt = useDialogs((s) => s.passwordPrompt);
  const close = useDialogs((s) => s.closePasswordPrompt);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue("");
    inputRef.current?.focus();
  }, [prompt]);

  if (!prompt) return null;
  const isPassword = prompt.kind === "password";

  return (
    <Modal
      title={isPassword ? t("prompt.passwordTitle", { host: prompt.host }) : t("prompt.keyPassTitle")}
      onClose={() => close(null)}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          close(value);
        }}
      >
        <input
          ref={inputRef}
          type="password"
          className="q-input mb-4"
          placeholder={isPassword ? t("prompt.passwordPlaceholder") : t("prompt.keyPassPlaceholder")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="q-btn" onClick={() => close(null)}>
            {t("prompt.cancel")}
          </button>
          <button type="submit" className="q-btn q-btn-primary" disabled={!value}>
            {t("prompt.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
