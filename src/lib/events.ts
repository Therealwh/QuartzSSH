import { listen } from "@tauri-apps/api/event";
import type { HostKeyPrompt, SshConnectedEvent, TransferEvent } from "../types";
import { useDialogs } from "../store/dialogs";
import { useTransfers } from "../store/transfers";
import { useSessions } from "../store/sessions";

/** Wire backend events to the global stores once at startup. */
export function setupGlobalListeners(): Array<() => void> {
  const unlisteners: Array<() => void> = [];

  void listen<HostKeyPrompt>("ssh:host-key", (e) => {
    useDialogs.getState().showHostKey(e.payload);
  }).then((un) => unlisteners.push(un));

  void listen<TransferEvent>("sftp:transfer", (e) => {
    useTransfers.getState().apply(e.payload);
  }).then((un) => unlisteners.push(un));

  void listen<{ sessionId: string }>("ssh:closed", (e) => {
    useSessions.getState().markClosed(e.payload.sessionId);
  }).then((un) => unlisteners.push(un));

  void listen<SshConnectedEvent>("ssh:connected", (e) => {
    if (e.payload.kex) useSessions.getState().setSessionKex(e.payload.sessionId, e.payload.kex);
  }).then((un) => unlisteners.push(un));

  return unlisteners;
}
