import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Tab } from "../store/sessions";
import { EDITOR_MAX_FILE_BYTES, useSessions } from "../store/sessions";
import { ipc } from "../lib/ipc";
import type { DirectoryListing, FileEntry, LocalListing } from "../types";
import { formatBytes, formatTime, joinPath, parentPath } from "../lib/format";
import { useDialogs } from "../store/dialogs";
import { PromptModal } from "./dialogs/Modal";
import {
  ArrowUpIcon,
  DownloadIcon,
  FolderIcon,
  HomeIcon,
  NewFolderIcon,
  PencilIcon,
  RefreshIcon,
  TrashIcon,
  UploadIcon,
} from "./icons";

type Side = "local" | "remote";

interface PaneState {
  path: string;
  entries: FileEntry[];
}

interface MenuState {
  x: number;
  y: number;
  side: Side;
  entry: FileEntry;
}

const isWindowsPath = (p: string) => /^[A-Za-z]:[\\/]/.test(p);

export function SftpPane({ tab }: { tab: Tab }) {
  const { t } = useTranslation();
  const requestConfirm = useDialogs((s) => s.requestConfirm);
  const setUpdateStatus = useDialogs((s) => s.setUpdateStatus);
  const openEditorTab = useSessions((s) => s.openEditorTab);

  const [local, setLocal] = useState<PaneState | null>(null);
  const [remote, setRemote] = useState<PaneState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<
    | { kind: "remoteMkdir" }
    | { kind: "localMkdir" }
    | { kind: "rename"; side: Side; entry: FileEntry }
    | { kind: "chmod"; entry: FileEntry }
    | null
  >(null);

  const isWin = useMemo(() => local?.path ? isWindowsPath(local.path) : false, [local?.path]);

  const loadLocal = useCallback(async (path: string) => {
    try {
      let listing: LocalListing = await ipc.localList(path);
      if (!path && !listing.entries.length) {
        const home = await ipc.localHome();
        listing = await ipc.localList(home);
      }
      setLocal({ path: listing.path, entries: listing.entries.map((e) => ({ ...e, isSymlink: false, permissions: "" })) });
    } catch (e) {
      setUpdateStatus(String(e));
    }
  }, [setUpdateStatus]);

  const loadRemote = useCallback(async (path: string) => {
    if (!tab.sftpId) return;
    try {
      const listing: DirectoryListing = await ipc.sftpList(tab.sftpId, path || ".");
      setRemote({ path: listing.path, entries: listing.entries });
    } catch (e) {
      setUpdateStatus(String(e));
    }
  }, [tab.sftpId, setUpdateStatus]);

  useEffect(() => {
    void loadLocal("");
    void loadRemote(".");
  }, [loadLocal, loadRemote]);

  // Close the row context menu on any click.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  // Drag & drop from the OS: upload whatever falls onto the remote pane.
  useEffect(() => {
    if (!tab.sftpId) return;
    const un = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const remoteEl = document.getElementById("sftp-pane-remote");
      if (!remoteEl) return;
      const rect = remoteEl.getBoundingClientRect();
      const { x, y } = event.payload.position;
      const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      if (!inside || !remote) return;
      const targetDir = remote.path;
      for (const p of event.payload.paths) {
        void ipc
          .sftpUpload(tab.sftpId!, p, targetDir)
          .catch((e) => setUpdateStatus(String(e)));
      }
      // Refresh when uploads complete (poll once after a delay).
      setTimeout(() => void loadRemote(targetDir), 1200);
    });
    return () => {
      void un.then((f) => f());
    };
  }, [tab.sftpId, remote, loadRemote, setUpdateStatus]);

  const transfer = async (from: Side, entry: FileEntry) => {
    if (!tab.sftpId) return;
    if (entry.isDir) return;
    if (from === "local" && remote) {
      await ipc.sftpUpload(tab.sftpId, entry.path, remote.path).catch((e) => setUpdateStatus(String(e)));
      setTimeout(() => void loadRemote(remote.path), 800);
    } else if (from === "remote" && local) {
      const target = joinPath(local.path || (await ipc.localHome()), entry.name, isWin);
      await ipc.sftpDownload(tab.sftpId, entry.path, target).catch((e) => setUpdateStatus(String(e)));
      setTimeout(() => void loadLocal(local.path), 800);
    }
  };

  const dropInto = async (target: Side, data: string) => {
    let parsed: { side: Side; entry: FileEntry };
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (parsed.side === target) return;
    await transfer(parsed.side, parsed.entry);
  };

  const removeEntry = async (side: Side, entry: FileEntry) => {
    const ok = await requestConfirm(t("sftp.delete"), t("sftp.confirmDelete", { name: entry.name }), true);
    if (!ok) return;
    try {
      if (side === "remote" && tab.sftpId) {
        await ipc.sftpDelete(tab.sftpId, entry.path, entry.isDir);
        await loadRemote(remote?.path ?? ".");
      } else if (side === "local") {
        await ipc.localDelete(entry.path, entry.isDir);
        await loadLocal(local?.path ?? "");
      }
    } catch (e) {
      setUpdateStatus(String(e));
    }
  };

  const navigate = (side: Side, path: string) => {
    if (side === "remote") void loadRemote(path);
    else void loadLocal(path);
  };

  const goUp = (side: Side) => {
    const current = side === "remote" ? remote?.path : local?.path;
    if (!current) return;
    if (side === "remote") {
      navigate("remote", parentPath(current) || "/");
    } else {
      const parent = parentPath(current, isWin);
      if (parent || !isWin) navigate("local", parent);
    }
  };

  const paneProps = (side: Side) => ({
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const data = e.dataTransfer.getData("application/x-quartzssh-entry");
      if (data) void dropInto(side, data);
    },
  });

  const renderRows = (side: Side, state: PaneState | null) => {
    if (!state) return null;
    return state.entries.map((entry) => (
      <div
        key={entry.name}
        role="row"
        className="q-row flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm"
        onClick={() => entry.isDir && navigate(side, entry.path)}
        onDoubleClick={() => {
          if (entry.isDir) {
            navigate(side, entry.path);
            return;
          }
          // Double-click on a remote file opens it in the built-in editor.
          if (side === "remote" && tab.sftpId) {
            if (entry.size > EDITOR_MAX_FILE_BYTES) {
              setUpdateStatus(t("errors.file_too_large"));
              return;
            }
            openEditorTab(tab.sftpId, entry.path);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, side, entry });
        }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-quartzssh-entry", JSON.stringify({ side, entry }));
        }}
      >
        <span role="cell" aria-hidden="true" className="shrink-0 text-[var(--q-muted)]">
          <FolderIcon size={13} />
        </span>
        <span role="cell" className="min-w-0 flex-1 truncate">{entry.name}</span>
        <span role="cell" className="w-20 shrink-0 text-right text-xs text-[var(--q-muted)]">
          {entry.isDir ? "" : formatBytes(entry.size)}
        </span>
        <span role="cell" className="hidden w-36 shrink-0 text-right text-xs text-[var(--q-muted)] xl:block">
          {formatTime(entry.modified)}
        </span>
        <span role="cell" className="hidden w-12 shrink-0 text-right font-mono text-xs text-[var(--q-muted)] lg:block">
          {entry.permissions}
        </span>
      </div>
    ));
  };

  const toolbar = (side: Side) => (
    <div className="flex items-center gap-1 border-b border-[var(--q-border)] px-2 py-1.5">
      <button className="q-icon-btn" title={t("sftp.up")} aria-label={t("sftp.up")} onClick={() => goUp(side)}>
        <ArrowUpIcon size={13} />
      </button>
      <button
        className="q-icon-btn"
        title={t("sftp.home")}
        aria-label={t("sftp.home")}
        onClick={async () =>
          side === "remote" ? navigate("remote", ".") : navigate("local", await ipc.localHome())
        }
      >
        <HomeIcon size={13} />
      </button>
      <button
        className="q-icon-btn"
        title={t("sftp.refresh")}
        aria-label={t("sftp.refresh")}
        onClick={() => navigate(side, (side === "remote" ? remote?.path : local?.path) ?? "")}
      >
        <RefreshIcon size={13} />
      </button>
      <button
        className="q-icon-btn"
        title={t("sftp.newFolder")}
        aria-label={t("sftp.newFolder")}
        onClick={() => setPrompt({ kind: side === "remote" ? "remoteMkdir" : "localMkdir" })}
      >
        <NewFolderIcon size={13} />
      </button>
      <div className="ml-auto text-[10px] text-[var(--q-muted)]">{t("sftp.dragHint")}</div>
    </div>
  );

  const pathBar = (side: Side, state: PaneState | null) => (
    <input
      className="q-input m-1 text-xs"
      value={state?.path ?? ""}
      placeholder={t("sftp.path")}
      onChange={() => undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter") navigate(side, (e.target as HTMLInputElement).value);
      }}
    />
  );

  return (
    <div className="flex h-full">
      <section id="sftp-pane-local" className="flex min-w-0 flex-1 flex-col border-r border-[var(--q-border)]" {...paneProps("local")}>
        <div className="flex items-center gap-2 px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--q-muted)]">
          {t("sftp.local")}
        </div>
        {toolbar("local")}
        {pathBar("local", local)}
        <div role="table" aria-label={t("sftp.local")} className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          {local?.entries.length ? renderRows("local", local) : <Empty t={t} />}
        </div>
      </section>

      <section id="sftp-pane-remote" className="flex min-w-0 flex-1 flex-col" {...paneProps("remote")}>
        <div className="flex items-center gap-2 px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--q-muted)]">
          {t("sftp.remote", { host: tab.host ?? "" })}
        </div>
        {toolbar("remote")}
        {pathBar("remote", remote)}
        <div role="table" aria-label={t("sftp.remote", { host: tab.host ?? "" })} className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          {remote?.entries.length ? renderRows("remote", remote) : <Empty t={t} />}
        </div>
      </section>

      {menu && (
        <div className="q-menu" style={{ left: menu.x, top: menu.y }}>
          {menu.side === "remote" ? (
            <>
              <button className="q-menu-item" onClick={() => { void transfer("remote", menu.entry); setMenu(null); }}>
                <DownloadIcon /> {t("sftp.download")}
              </button>
              <button
                className="q-menu-item"
                disabled={menu.entry.isDir}
                onClick={() => { setPrompt({ kind: "chmod", entry: menu.entry }); setMenu(null); }}
              >
                {t("sftp.permissions")}
              </button>
            </>
          ) : (
            <button className="q-menu-item" onClick={() => { void transfer("local", menu.entry); setMenu(null); }}>
              <UploadIcon /> {t("sftp.upload")}
            </button>
          )}
          <button
            className="q-menu-item"
            onClick={() => { setPrompt({ kind: "rename", side: menu.side, entry: menu.entry }); setMenu(null); }}
          >
            <PencilIcon /> {t("sftp.rename")}
          </button>
          <button
            className="q-menu-item text-[var(--q-danger)]"
            onClick={() => { void removeEntry(menu.side, menu.entry); setMenu(null); }}
          >
            <TrashIcon /> {t("sftp.delete")}
          </button>
        </div>
      )}

      {prompt?.kind === "remoteMkdir" && remote && (
        <PromptModal
          title={t("sftp.newFolder")}
          onSubmit={async (name) => {
            setPrompt(null);
            if (!tab.sftpId) return;
            await ipc.sftpMkdir(tab.sftpId, joinPath(remote.path, name)).catch((e) => setUpdateStatus(String(e)));
            void loadRemote(remote.path);
          }}
          onCancel={() => setPrompt(null)}
        />
      )}
      {prompt?.kind === "localMkdir" && local && (
        <PromptModal
          title={t("sftp.newFolder")}
          onSubmit={async (name) => {
            setPrompt(null);
            await ipc.localMkdir(joinPath(local.path, name, isWin)).catch((e) => setUpdateStatus(String(e)));
            void loadLocal(local.path);
          }}
          onCancel={() => setPrompt(null)}
        />
      )}
      {prompt?.kind === "rename" && (
        <PromptModal
          title={t("sftp.rename")}
          defaultValue={prompt.entry.name}
          onSubmit={async (name) => {
            setPrompt(null);
            try {
              if (prompt.side === "remote" && tab.sftpId) {
                await ipc.sftpRename(tab.sftpId, prompt.entry.path, joinPath(parentPath(prompt.entry.path), name));
                void loadRemote(remote?.path ?? ".");
              } else {
                await ipc.localRename(prompt.entry.path, joinPath(parentPath(prompt.entry.path, isWin), name, isWin));
                void loadLocal(local?.path ?? "");
              }
            } catch (e) {
              setUpdateStatus(String(e));
            }
          }}
          onCancel={() => setPrompt(null)}
        />
      )}
      {prompt?.kind === "chmod" && (
        <PromptModal
          title={`${t("sftp.permissions")} — ${prompt.entry.name}`}
          defaultValue={prompt.entry.permissions || "644"}
          onSubmit={async (value) => {
            setPrompt(null);
            if (!tab.sftpId) return;
            const mode = parseInt(value, 8);
            if (Number.isNaN(mode)) return;
            await ipc.sftpChmod(tab.sftpId, prompt.entry.path, mode).catch((e) => setUpdateStatus(String(e)));
            void loadRemote(remote?.path ?? ".");
          }}
          onCancel={() => setPrompt(null)}
        />
      )}
    </div>
  );
}

function Empty({ t }: { t: (key: string) => string }) {
  return <div className="px-3 py-6 text-center text-xs text-[var(--q-muted)]">{t("sftp.emptyDir")}</div>;
}
