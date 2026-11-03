import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { Modal } from "../dialogs/Modal";
import { ipc } from "../../lib/ipc";
import { useSessions } from "../../store/sessions";
import { useDialogs } from "../../store/dialogs";
import { CloseIcon, PlusIcon } from "../icons";
import type { KeyFileInfo, Profile, ProfileInput } from "../../types";

interface Props {
  profile?: Profile;
  onClose: () => void;
}

export function ConnectDialog({ profile, onClose }: Props) {
  const { t } = useTranslation();
  const saveProfile = useSessions((s) => s.saveProfile);
  const connectProfile = useSessions((s) => s.connectProfile);
  const setUpdateStatus = useDialogs((s) => s.setUpdateStatus);
  const profiles = useSessions((s) => s.profiles);

  const [name, setName] = useState(profile?.name ?? "");
  const [group, setGroup] = useState(profile?.group ?? "");
  const [host, setHost] = useState(profile?.host ?? "");
  const [port, setPort] = useState(profile?.port ?? 22);
  const [username, setUsername] = useState(profile?.username ?? "");
  const [authKind, setAuthKind] = useState<"password" | "publicKey">(
    profile?.auth.kind === "publicKey" ? "publicKey" : "password",
  );
  const [password, setPassword] = useState("");
  const [savePassword, setSavePassword] = useState(false);
  const [keyPath, setKeyPath] = useState(
    profile?.auth.kind === "publicKey" ? (profile.auth.keyPath ?? "") : "",
  );
  const [keyPassphrase, setKeyPassphrase] = useState("");
  const [savePassphrase, setSavePassphrase] = useState(false);
  const [identitiesOnly, setIdentitiesOnly] = useState(
    profile?.auth.kind === "publicKey" ? profile.auth.identitiesOnly : true,
  );
  const [keepalive, setKeepalive] = useState(profile?.keepaliveSeconds ?? 30);
  const keepaliveValue = Number.isFinite(keepalive) && keepalive > 0 ? keepalive : 30;
  const [autoReconnect, setAutoReconnect] = useState(profile?.autoReconnect ?? true);
  const [forwards, setForwards] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [keyInfo, setKeyInfo] = useState<KeyFileInfo | null>(null);

  const setForward = (index: number, value: string) =>
    setForwards((prev) => prev.map((v, i) => (i === index ? value : v)));
  const addForward = () => setForwards((prev) => [...prev, ""]);
  const removeForward = (index: number) =>
    setForwards((prev) => prev.filter((_, i) => i !== index));

  const knownGroups = [...new Set(profiles.map((p) => p.group).filter(Boolean))];

  // Classify the selected key file (standard / PuTTY / FIDO2 hardware) with a
  // small debounce so typing a path does not spam the backend. Informational
  // only: it never blocks connecting — the backend reports an explicit error
  // for key kinds it cannot sign.
  useEffect(() => {
    const trimmed = keyPath.trim();
    if (authKind !== "publicKey" || !trimmed) {
      setKeyInfo(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void ipc
        .keyInspect(trimmed)
        .then(setKeyInfo)
        .catch(() => setKeyInfo(null));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyPath, authKind]);

  const buildInput = (): ProfileInput => ({
    id: profile?.id,
    name: name.trim(),
    group: group.trim(),
    host: host.trim(),
    port: Number(port) || 22,
    username: username.trim(),
    auth:
      authKind === "password"
        ? { kind: "password", savePassword }
        : {
            kind: "publicKey",
            keyPath: keyPath.trim() || null,
            savePassphrase,
            identitiesOnly,
          },
    keepaliveSeconds: keepaliveValue,
    autoReconnect,
  });

  /** Creates the port forwards for the freshly opened session; invalid
   * specs and conflicts surface through the status toast. */
  const applyForwards = async (sessionId: string) => {
    for (const raw of forwards) {
      const spec = raw.trim();
      if (!spec) continue;
      try {
        await ipc.forwardAdd(sessionId, spec);
      } catch (e) {
        setUpdateStatus(t("forward.failed", { message: String(e) }));
      }
    }
  };

  const submit = async (andConnect: boolean) => {
    if (!name.trim() || !host.trim()) return;
    setBusy(true);
    const saved = await saveProfile(
      buildInput(),
      authKind === "password" && password ? password : undefined,
      authKind === "publicKey" && keyPassphrase ? keyPassphrase : undefined,
    );
    if (!saved) {
      setBusy(false);
      setUpdateStatus(t("connect.saveFailed"));
      return;
    }
    if (andConnect) {
      // Reuse the secrets typed into the dialog: when they are not saved to
      // the OS keychain the profile has none, and without them the backend
      // would prompt for the very password the user just entered.
      const sessionId = await connectProfile(saved, {
        password: authKind === "password" && password ? password : undefined,
        keyPassphrase: authKind === "publicKey" && keyPassphrase ? keyPassphrase : undefined,
      });
      if (sessionId) await applyForwards(sessionId);
    }
    setBusy(false);
    onClose();
  };

  return (
    <Modal title={profile ? t("connect.editTitle") : t("connect.newTitle")} onClose={onClose} wide>
      <form
        className="grid grid-cols-2 gap-x-4 gap-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(true);
        }}
      >
        <label className="block">
          <div className="mb-1 text-xs text-[var(--q-muted)]">{t("connect.name")}</div>
          <input className="q-input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label className="block">
          <div className="mb-1 text-xs text-[var(--q-muted)]">{t("connect.group")}</div>
          <input className="q-input" value={group} onChange={(e) => setGroup(e.target.value)} list="q-groups" />
          <datalist id="q-groups">
            {knownGroups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </label>
        <label className="col-span-2 grid grid-cols-[1fr_90px] gap-3">
          <span className="block">
            <span className="mb-1 block text-xs text-[var(--q-muted)]">{t("connect.host")}</span>
            <input className="q-input" value={host} onChange={(e) => setHost(e.target.value)} required />
          </span>
          <span className="block">
            <span className="mb-1 block text-xs text-[var(--q-muted)]">{t("connect.port")}</span>
            <input
              className="q-input"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </span>
        </label>
        <label className="block">
          <div className="mb-1 text-xs text-[var(--q-muted)]">{t("connect.username")}</div>
          <input className="q-input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </label>
        <label className="block">
          <div className="mb-1 text-xs text-[var(--q-muted)]">{t("connect.authType")}</div>
          <select
            className="q-input"
            value={authKind}
            onChange={(e) => setAuthKind(e.target.value as "password" | "publicKey")}
          >
            <option value="password">{t("connect.authPassword")}</option>
            <option value="publicKey">{t("connect.authKey")}</option>
          </select>
        </label>

        {authKind === "password" ? (
          <label className="col-span-2 block">
            <div className="mb-1 text-xs text-[var(--q-muted)]">{t("connect.password")}</div>
            <input
              className="q-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={profile ? "••••••••" : ""}
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-[var(--q-muted)]">
              <input type="checkbox" checked={savePassword} onChange={(e) => setSavePassword(e.target.checked)} />
              {t("connect.savePassword")}
            </label>
          </label>
        ) : (
          <div className="col-span-2 space-y-3">
            <label className="grid grid-cols-[1fr_auto] gap-2">
              <span className="block">
                <span className="mb-1 block text-xs text-[var(--q-muted)]">{t("connect.keyPath")}</span>
                <input className="q-input" value={keyPath} onChange={(e) => setKeyPath(e.target.value)} />
              </span>
              <button
                type="button"
                className="q-btn self-end"
                onClick={async () => {
                  const path = await open({ multiple: false, title: t("connect.keyPath") });
                  if (typeof path === "string") setKeyPath(path);
                }}
              >
                {t("connect.browse")}
              </button>
            </label>
            {keyInfo && (
              <div className="space-y-1.5">
                <div className="text-xs">
                  {keyInfo.kind === "hardwareFido2" ? (
                    <span className="inline-flex items-center rounded border border-[var(--q-border)] bg-[var(--q-hover)] px-1.5 py-0.5 font-medium text-[var(--q-warning,#d97706)]">
                      {t("fido2.badgeHardware", { algorithm: keyInfo.algorithm })}
                    </span>
                  ) : keyInfo.kind === "putty" ? (
                    <span className="inline-flex items-center rounded border border-[var(--q-border)] bg-[var(--q-hover)] px-1.5 py-0.5 text-[var(--q-muted)]">
                      {t("fido2.badgePutty")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded border border-[var(--q-border)] bg-[var(--q-hover)] px-1.5 py-0.5 text-[var(--q-muted)]">
                      {t("fido2.badgeStandard")}
                    </span>
                  )}
                </div>
                {keyInfo.kind === "hardwareFido2" && (
                  <div className="space-y-1 text-xs text-[var(--q-muted)]">
                    <p>{t("fido2.touchHint")}</p>
                    <p>{t("fido2.libfido2Hint")}</p>
                  </div>
                )}
              </div>
            )}
            <label className="block">
              <div className="mb-1 text-xs text-[var(--q-muted)]">{t("connect.keyPassphrase")}</div>
              <input
                className="q-input"
                type="password"
                value={keyPassphrase}
                onChange={(e) => setKeyPassphrase(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--q-muted)]">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={savePassphrase} onChange={(e) => setSavePassphrase(e.target.checked)} />
                {t("connect.savePassphrase")}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={identitiesOnly} onChange={(e) => setIdentitiesOnly(e.target.checked)} />
                {t("connect.identitiesOnly")}
              </label>
            </div>
          </div>
        )}

        <label className="block">
          <div className="mb-1 text-xs text-[var(--q-muted)]">{t("connect.keepalive")}</div>
          <input
            className="q-input"
            type="number"
            min={10}
            max={600}
            value={keepalive}
            onChange={(e) => setKeepalive(Number(e.target.value))}
          />
        </label>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoReconnect} onChange={(e) => setAutoReconnect(e.target.checked)} />
          {t("connect.autoReconnect")}
        </label>

        <div className="col-span-2">
          <div className="mb-1 text-xs text-[var(--q-muted)]">{t("forward.title")}</div>
          <div className="space-y-2">
            {forwards.map((value, index) => (
              <div key={index} className="flex gap-2">
                <input
                  className="q-input flex-1 font-mono text-xs"
                  value={value}
                  placeholder={t("forward.specPlaceholder")}
                  onChange={(e) => setForward(index, e.target.value)}
                  spellCheck={false}
                  aria-label={t("forward.title")}
                />
                <button
                  type="button"
                  className="q-icon-btn"
                  aria-label={t("forward.remove")}
                  title={t("forward.remove")}
                  onClick={() => removeForward(index)}
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" className="q-btn text-xs" onClick={addForward}>
              <PlusIcon size={12} /> {t("forward.add")}
            </button>
            <span className="text-xs text-[var(--q-muted)]">{t("forward.hint")}</span>
          </div>
        </div>

        <div className="col-span-2 mt-2 flex justify-end gap-2">
          <button type="button" className="q-btn" onClick={onClose} disabled={busy}>
            {t("connect.cancel")}
          </button>
          <button type="button" className="q-btn" onClick={() => void submit(false)} disabled={busy || !name.trim() || !host.trim()}>
            {t("connect.save")}
          </button>
          <button type="submit" className="q-btn q-btn-primary" disabled={busy || !name.trim() || !host.trim()}>
            {t("connect.connectAndSave")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
