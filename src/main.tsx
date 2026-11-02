import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { initI18n } from "./i18n";
import { applyStartupTheme, useSettings } from "./store/settings";
import { setupGlobalListeners } from "./lib/events";
import { startUpdateCheck } from "./lib/updater";
import { ipc } from "./lib/ipc";
import { useAutoReconnect } from "./store/sessions";

async function bootstrap() {
  const ui = useSettings.getState();
  await initI18n(ui.language);
  applyStartupTheme(ui);
  setupGlobalListeners();
  startUpdateCheck();

  // Sync auto-reconnect preferences from the Rust-side settings store.
  try {
    const s = await ipc.settingsGet();
    useAutoReconnect.getState().set(s.autoReconnect, s.reconnectDelaySeconds);
  } catch {
    // defaults are fine
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
