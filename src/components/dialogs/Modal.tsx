import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "../icons";

interface ModalProps {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ title, onClose, children, wide }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="q-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`q-modal ${wide ? "min-w-[520px] max-w-[720px]" : ""}`}
      >
        <div className="flex items-center justify-between border-b border-[var(--q-border)] px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {onClose && (
            <button className="q-icon-btn" aria-label="Close" onClick={onClose}>
              <CloseIcon size={14} />
            </button>
          )}
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

interface PromptModalProps {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** Small single-field prompt (used for rename / new folder). */
export function PromptModal({ title, label, defaultValue = "", placeholder, onSubmit, onCancel }: PromptModalProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Modal title={title} onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        {label && <div className="mb-2 text-[var(--q-muted)]">{label}</div>}
        <input
          ref={inputRef}
          className="q-input mb-4"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="q-btn" onClick={onCancel}>
            {t("connect.cancel")}
          </button>
          <button type="submit" className="q-btn q-btn-primary" disabled={!value.trim()}>
            OK
          </button>
        </div>
      </form>
    </Modal>
  );
}
