import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessions } from "../../store/sessions";
import { useDialogs } from "../../store/dialogs";
import { ipc } from "../../lib/ipc";
import type { Profile } from "../../types";
import { ConnectDialog } from "./ConnectDialog";
import { PlugIcon, PlusIcon, SearchIcon, PencilIcon, TrashIcon, FolderIcon, TerminalIcon } from "../icons";

interface MenuState {
  x: number;
  y: number;
  profile: Profile;
}

export function SessionsPanel() {
  const { t } = useTranslation();
  const profiles = useSessions((s) => s.profiles);
  const connections = useSessions((s) => s.connections);
  const connectProfile = useSessions((s) => s.connectProfile);
  const openSftpForProfile = useSessions((s) => s.openSftpForProfile);
  const deleteProfile = useSessions((s) => s.deleteProfile);
  const requestConfirm = useDialogs((s) => s.requestConfirm);
  const setUpdateStatus = useDialogs((s) => s.setUpdateStatus);

  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = profiles.filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.host.toLowerCase().includes(q) ||
        p.username.toLowerCase().includes(q),
    );
    const map = new Map<string, Profile[]>();
    for (const p of filtered) {
      const key = p.group || t("sessions.ungrouped");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [profiles, query, t]);

  const importSshConfig = async () => {
    try {
      const result = await ipc.sshConfigImport();
      if (result.profiles.length === 0) {
        setUpdateStatus(t("sessions.importNone"));
        return;
      }
      setImporting(true);
    } catch (e) {
      setUpdateStatus(String(e));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-3 pt-3">
        <h1 className="flex-1 text-xs font-semibold uppercase tracking-wide text-[var(--q-muted)]">
          {t("sessions.title")}
        </h1>
        <button className="q-icon-btn" title={t("sessions.newConnection")} aria-label={t("sessions.newConnection")} onClick={() => setCreating(true)}>
          <PlusIcon />
        </button>
      </div>

      <div className="relative px-3 py-2">
        <SearchIcon size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[var(--q-muted)]" />
        <input
          className="q-input pl-7"
          placeholder={t("sessions.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-[var(--q-muted)]">
            <div>{t("sessions.empty")}</div>
            <button className="q-btn mt-3" onClick={() => setCreating(true)}>
              <PlusIcon /> {t("sessions.newConnection")}
            </button>
          </div>
        )}
        {groups.map(([group, items]) => (
          <div key={group} className="mb-2">
            <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--q-muted)]">
              {group}
            </div>
            {items.map((p) => {
              const connected = !!connections[p.id];
              return (
                <button
                  key={p.id}
                  className="q-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                  onClick={() => void connectProfile(p)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, profile: p });
                  }}
                  title={`${p.username ? `${p.username}@` : ""}${p.host}:${p.port}`}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: connected ? "var(--q-success)" : "var(--q-muted)" }}
                  />
                  <span className="flex-1 truncate">{p.name}</span>
                  {connected && (
                    <span className="text-[10px] uppercase text-[var(--q-success)]">
                      {t("sessions.connected")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--q-border)] p-2">
        <button className="q-menu-item text-xs text-[var(--q-muted)] hover:text-[var(--q-text)]" onClick={() => void importSshConfig()}>
          <TerminalIcon size={13} /> {t("sessions.importConfig")}
        </button>
      </div>

      {menu && (
        <div className="q-menu" style={{ left: menu.x, top: menu.y }}>
          <button className="q-menu-item" onClick={() => { void connectProfile(menu.profile); setMenu(null); }}>
            <PlugIcon /> {t("sessions.connect")}
          </button>
          <button className="q-menu-item" onClick={() => { void openSftpForProfile(menu.profile); setMenu(null); }}>
            <FolderIcon /> {t("sessions.sftp")}
          </button>
          <button className="q-menu-item" onClick={() => { setEditing(menu.profile); setMenu(null); }}>
            <PencilIcon /> {t("sessions.edit")}
          </button>
          <button
            className="q-menu-item text-[var(--q-danger)]"
            onClick={async () => {
              setMenu(null);
              const ok = await requestConfirm(
                t("sessions.delete"),
                t("sessions.confirmDelete", { name: menu.profile.name }),
                true,
              );
              if (ok) void deleteProfile(menu.profile.id);
            }}
          >
            <TrashIcon /> {t("sessions.delete")}
          </button>
        </div>
      )}

      {(creating || editing) && (
        <ConnectDialog
          profile={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Awaited<ReturnType<typeof ipc.sshConfigImport>> | null>(null);
  const saveProfile = useSessions((s) => s.saveProfile);
  const loadProfiles = useSessions((s) => s.loadProfiles);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    void ipc.sshConfigImport().then((result) => {
      setData(result);
      setSelected(new Set(result.profiles.map((p) => p.name)));
    });
  }, []);

  if (!data) return null;

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="q-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="q-modal" style={{ minWidth: 520 }}>
        <div className="border-b border-[var(--q-border)] px-4 py-3 text-sm font-semibold">
          {t("sessions.importTitle")}
        </div>
        <div className="px-4 py-3">
          <div className="mb-2 text-xs text-[var(--q-muted)]">
            {t("sessions.importFound", { count: data.profiles.length })} — {data.source}
          </div>
          {data.warnings.length > 0 && (
            <details className="mb-2 text-xs text-[var(--q-warning)]">
              <summary className="cursor-pointer">{t("sessions.importWarnings")} ({data.warnings.length})</summary>
              <ul className="mt-1 list-disc pl-5">
                {data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="max-h-56 overflow-y-auto rounded-md border border-[var(--q-border)]">
            {data.profiles.map((p) => (
              <label key={p.id} className="q-row flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(p.name)}
                  onChange={() => toggle(p.name)}
                />
                <span className="flex-1">{p.name}</span>
                <span className="text-xs text-[var(--q-muted)]">
                  {p.username ? `${p.username}@` : ""}
                  {p.host}:{p.port}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 pb-4">
          <button className="q-btn" onClick={onClose}>
            {t("connect.cancel")}
          </button>
          <button
            className="q-btn q-btn-primary"
            onClick={async () => {
              for (const p of data.profiles) {
                if (!selected.has(p.name)) continue;
                await saveProfile({
                  name: p.name,
                  group: p.group || "Imported",
                  host: p.host,
                  port: p.port,
                  username: p.username,
                  auth: p.auth,
                  keepaliveSeconds: p.keepaliveSeconds,
                  autoReconnect: p.autoReconnect,
                });
              }
              await loadProfiles();
              onClose();
            }}
          >
            {t("sessions.importAll")}
          </button>
        </div>
      </div>
    </div>
  );
}
