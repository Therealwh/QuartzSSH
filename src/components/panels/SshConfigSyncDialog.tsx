import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "../../lib/ipc";
import {
  diffEntries,
  loadStoredSnapshot,
  rememberConfigSnapshot,
  type ConfigDiff,
  type ConfigEntrySnapshot,
} from "../../lib/sshConfigSync";
import { Modal } from "../dialogs/Modal";
import { useSessions } from "../../store/sessions";

/**
 * Spec 18.3: when ~/.ssh/config changes externally, offer a preview and
 * re-import — never modify anything silently.
 */
export function SshConfigSyncDialog({ hash, onClose }: { hash: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [diff, setDiff] = useState<ConfigDiff | null>(null);
  const [profiles, setProfiles] = useState<Awaited<ReturnType<typeof ipc.sshConfigImport>> | null>(null);
  const saveProfile = useSessions((s) => s.saveProfile);
  const loadProfiles = useSessions((s) => s.loadProfiles);
  const [busy, setBusy] = useState(false);

  const stored = useMemo<ConfigEntrySnapshot[]>(() => loadStoredSnapshot(), []);

  useEffect(() => {
    void (async () => {
      const result = await ipc.sshConfigImport();
      setProfiles(result);
      setDiff(diffEntries(stored, result.profiles.map(toSnapshot)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = diff ? diff.added.length + diff.removed.length + diff.changed.length : 0;

  const importSelected = async () => {
    if (!profiles) return;
    setBusy(true);
    for (const p of profiles.profiles) {
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
    setBusy(false);
    rememberConfigSnapshot(hash, profiles.profiles.map(toSnapshot));
    onClose();
  };

  return (
    <Modal title={t("sshConfigSync.title")} onClose={onClose} wide>
      <p className="mb-3 text-sm text-[var(--q-muted)]">{t("sshConfigSync.changed")}</p>
      {diff && total > 0 ? (
        <div className="mb-3 space-y-1 text-sm">
          {diff.added.length > 0 && (
            <DiffList label={t("sshConfigSync.added")} hosts={diff.added} color="var(--q-success)" />
          )}
          {diff.removed.length > 0 && (
            <DiffList label={t("sshConfigSync.removed")} hosts={diff.removed} color="var(--q-danger)" />
          )}
          {diff.changed.length > 0 && (
            <DiffList label={t("sshConfigSync.changedLabel")} hosts={diff.changed} color="var(--q-warning)" />
          )}
        </div>
      ) : (
        <div className="mb-3 text-sm text-[var(--q-muted)]">{t("sshConfigSync.noImportableChanges")}</div>
      )}
      <div className="flex justify-end gap-2">
        <button className="q-btn" onClick={onClose}>
          {t("sshConfigSync.later")}
        </button>
        <button
          className="q-btn"
          onClick={() => {
            rememberConfigSnapshot(hash, profiles ? profiles.profiles.map(toSnapshot) : []);
            onClose();
          }}
        >
          {t("sshConfigSync.markReviewed")}
        </button>
        {total > 0 && (
          <button className="q-btn q-btn-primary" disabled={busy} onClick={() => void importSelected()}>
            {t("sshConfigSync.import")}
          </button>
        )}
      </div>
    </Modal>
  );
}

function toSnapshot(p: { name: string; host: string; username: string; port: number; auth: { kind: string; keyPath?: string | null }; keepaliveSeconds: number }) {
  return {
    host: p.name,
    hostname: p.host,
    user: p.username,
    port: p.port,
    identityFiles: p.auth.kind === "publicKey" && p.auth.keyPath ? 1 : 0,
    keepalive: p.keepaliveSeconds,
    proxyJump: undefined,
  } as ConfigEntrySnapshot;
}

function DiffList({ label, hosts, color }: { label: string; hosts: string[]; color: string }) {
  return (
    <div>
      <span className="font-medium" style={{ color }}>
        {label}:
      </span>{" "}
      <span className="font-mono text-xs">{hosts.join(", ")}</span>
    </div>
  );
}
