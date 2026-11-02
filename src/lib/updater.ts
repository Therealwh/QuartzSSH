import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useDialogs } from "../store/dialogs";
import { ipc } from "./ipc";

export function startUpdateCheck() {
  void (async () => {
    let enabled = true;
    try {
      const settings = await ipc.settingsGet();
      enabled = settings.checkUpdatesOnStart;
    } catch {
      // keep the default (enabled)
    }
    if (!enabled) return;
    // Do not slow down startup: check after the first render settles.
    setTimeout(() => void runCheck(), 5000);
  })();
}

async function runCheck() {
  try {
    const update = await check();
    if (update) {
      useDialogs.getState().showUpdate(update.version, update.body ?? undefined);
    }
  } catch {
    // Update check failures must never bother the user silently; the status
    // bar exposes a manual "check now" action instead.
  }
}

export async function installUpdate() {
  const update = await check();
  if (!update) return;
  const dialogs = useDialogs.getState();
  dialogs.setUpdating(true);
  try {
    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    dialogs.setUpdating(false);
    dialogs.setUpdateStatus(`${useDialogs.getState().updateStatus ?? ""}`);
    console.error("update failed", e);
  }
}

export async function manualCheck(): Promise<string> {
  try {
    const update = await check();
    if (update) {
      useDialogs.getState().showUpdate(update.version, update.body ?? undefined);
      return "available";
    }
    return "up_to_date";
  } catch {
    return "failed";
  }
}
