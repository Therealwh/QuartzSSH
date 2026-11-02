import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
// Type-only import: erased at build time, keeps the codemirror chunk lazy.
import type { EditorView } from "@codemirror/view";
import { ipc } from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import { useDialogs } from "../../store/dialogs";
import { useSessions } from "../../store/sessions";
import { useSettings } from "../../store/settings";
import { getTheme } from "../../themes";
import { Modal } from "../dialogs/Modal";
import { baseName } from "./language";

interface FileEditorProps {
  /** Live SFTP session (shared with the Files tab the file was opened from). */
  sftpId: string;
  /** Absolute remote path of the file. */
  path: string;
  /** Owning tab, used to publish the dirty flag. */
  tabId: string;
  /** Called by the Close button (the tab strip has its own close button). */
  onClose: () => void;
}

function errorToMessage(raw: string, t: (key: string) => string): string {
  if (raw.includes("file_too_large")) return t("errors.file_too_large");
  if (raw.includes("binary_file")) return t("errors.binary_file");
  return raw;
}

export function FileEditor({ sftpId, path, tabId, onClose }: FileEditorProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const darkSetterRef = useRef<((isDark: boolean) => void) | null>(null);
  const fontSetterRef = useRef<((family: string, size: number) => void) | null>(null);
  const mtimeRef = useRef<number | null>(null);
  const baselineRef = useRef<string>("");
  const saveRef = useRef<(force: boolean) => void>(() => undefined);

  const themeId = useSettings((s) => s.themeId);
  const fontFamily = useSettings((s) => s.fontFamily);
  const fontSize = useSettings((s) => s.fontSize);
  const setTabDirty = useSessions((s) => s.setTabDirty);
  const requestConfirm = useDialogs((s) => s.requestConfirm);
  const setUpdateStatus = useDialogs((s) => s.setUpdateStatus);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [size, setSize] = useState(0);
  const [conflict, setConflict] = useState(false);

  const readFile = useCallback(
    async () => ipc.sftpReadFile(sftpId, path),
    [sftpId, path],
  );

  const markClean = useCallback(() => {
    setDirty(false);
    setTabDirty(tabId, false);
  }, [tabId, setTabDirty]);

  const doSave = useCallback(
    async (force: boolean) => {
      const view = viewRef.current;
      if (!view || saving) return;
      const content = view.state.doc.toString();
      setSaving(true);
      try {
        await ipc.sftpWriteFile(sftpId, path, content, mtimeRef.current, force);
        // The write bumped the server mtime: refresh the baseline so the
        // next save compares against the fresh value instead of always
        // reporting a false conflict.
        try {
          const fresh = await ipc.sftpReadFile(sftpId, path);
          mtimeRef.current = fresh.mtime;
        } catch {
          // Baseline stays stale; a false conflict can then be force-saved.
        }
        baselineRef.current = content;
        setSize(new TextEncoder().encode(content).length);
        markClean();
        setConflict(false);
      } catch (e) {
        const code = String(e);
        if (code.includes("mtime_conflict")) {
          setConflict(true);
        } else {
          setUpdateStatus(errorToMessage(code, t));
        }
      } finally {
        setSaving(false);
      }
    },
    [saving, sftpId, path, t, setUpdateStatus, markClean],
  );

  // The editor keymap captures the save callback at creation time; route it
  // through a ref so Ctrl+S always calls the latest one.
  useEffect(() => {
    saveRef.current = (force: boolean) => void doSave(force);
  }, [doSave]);

  // Create the editor once per tab: read the file, then lazily load the
  // CodeMirror chunk and build the view.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const file = await readFile();
        if (disposed) return;
        const { createCodeEditor } = await import("./cm");
        if (disposed || !containerRef.current) return;
        const theme = getTheme(themeId);
        const created = createCodeEditor({
          parent: containerRef.current,
          doc: file.content,
          path,
          isDark: theme.isDark,
          fontFamily,
          fontSize,
          getBaseline: () => baselineRef.current,
          onSave: () => saveRef.current(false),
          onUpdate: (line, col, isDirty) => {
            setCursor({ line, col });
            setDirty((prev) => (prev === isDirty ? prev : isDirty));
            setTabDirty(tabId, isDirty);
          },
        });
        viewRef.current = created.view;
        darkSetterRef.current = created.setDark;
        fontSetterRef.current = created.setFont;
        mtimeRef.current = file.mtime;
        baselineRef.current = file.content;
        setSize(new TextEncoder().encode(file.content).length);
        setReady(true);
      } catch (e) {
        if (!disposed) setError(errorToMessage(String(e), t));
      }
    })();
    return () => {
      disposed = true;
      viewRef.current?.destroy();
      viewRef.current = null;
      darkSetterRef.current = null;
      fontSetterRef.current = null;
    };
    // Runs once per mounted tab; file/theme changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live theme switching: rebuild only the syntax theme compartment.
  useEffect(() => {
    darkSetterRef.current?.(getTheme(themeId).isDark);
  }, [themeId]);

  // Live font switching from the settings store.
  useEffect(() => {
    fontSetterRef.current?.(fontFamily, fontSize);
  }, [fontFamily, fontSize]);

  const doReload = useCallback(
    async (promptWhenDirty: boolean) => {
      const view = viewRef.current;
      if (!view || saving) return;
      const dirtyNow =
        view.state.doc.length !== baselineRef.current.length ||
        view.state.doc.toString() !== baselineRef.current;
      if (promptWhenDirty && dirtyNow) {
        const ok = await requestConfirm(t("editor.reloadTitle"), t("editor.reloadConfirm"));
        if (!ok) return;
      }
      try {
        const file = await readFile();
        const v = viewRef.current;
        if (!v) return;
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: file.content } });
        mtimeRef.current = file.mtime;
        baselineRef.current = file.content;
        setSize(new TextEncoder().encode(file.content).length);
        markClean();
      } catch (e) {
        setUpdateStatus(errorToMessage(String(e), t));
      }
    },
    [saving, requestConfirm, t, readFile, markClean, setUpdateStatus],
  );

  const doClose = useCallback(async () => {
    const view = viewRef.current;
    const dirtyNow =
      view &&
      (view.state.doc.length !== baselineRef.current.length ||
        view.state.doc.toString() !== baselineRef.current);
    if (dirtyNow) {
      const ok = await requestConfirm(t("editor.closeTitle"), t("editor.closeConfirm"), true);
      if (!ok) return;
    }
    onClose();
  }, [requestConfirm, t, onClose]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="text-sm text-[var(--q-danger)]">{error}</div>
        <button className="q-btn" onClick={onClose}>
          {t("editor.close")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--q-bg)] text-sm text-[var(--q-muted)]">
            {t("editor.loading")}
          </div>
        )}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-[var(--q-border)] bg-[var(--q-panel)] px-3 text-xs text-[var(--q-muted)]">
        <span className="min-w-0 max-w-[40%] truncate font-mono" title={path}>
          {baseName(path)}
        </span>
        <span className="shrink-0">{formatBytes(size)}</span>
        <span className="shrink-0">{t("editor.cursor", cursor)}</span>
        {dirty && (
          <span className="shrink-0 text-[var(--q-warning)]" title={t("editor.unsaved")}>
            ●
          </span>
        )}
        {saving && <span className="shrink-0">{t("editor.saving")}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            className="q-btn"
            disabled={saving || !ready}
            onClick={() => void doSave(false)}
          >
            {t("editor.save")}
          </button>
          <button
            className="q-btn"
            disabled={saving || !ready}
            onClick={() => void doReload(true)}
          >
            {t("editor.reload")}
          </button>
          <button className="q-btn" onClick={() => void doClose()}>
            {t("editor.close")}
          </button>
        </div>
      </div>

      {conflict && (
        <Modal title={t("editor.conflictTitle")} onClose={() => setConflict(false)}>
          <p className="mb-4 text-sm">{t("editor.conflictText")}</p>
          <div className="flex justify-end gap-2">
            <button
              className="q-btn"
              onClick={() => {
                setConflict(false);
                void doReload(false);
              }}
            >
              {t("editor.conflictLoad")}
            </button>
            <button className="q-btn q-btn-danger" onClick={() => void doSave(true)}>
              {t("editor.conflictOverwrite")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
