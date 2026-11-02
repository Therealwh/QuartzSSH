// Best-effort README screenshot capture for the Tauri application.
//
// Runs in the same CI job as the smoke test (see .github/workflows/webdriver.yml),
// in its own WebDriver session, AFTER the smoke assertions have passed. The
// captured PNGs land in docs/screenshots/ and are uploaded as the
// "app-screenshots" artifact; a human downloads them and commits the good
// ones (docs/testing.md -> "Capturing README screenshots").
//
// This script NEVER fails the CI job: every step is wrapped in try/catch and
// the process always exits 0. A missing or partial set of screenshots only
// shrinks the artifact.
//
// Prerequisites are identical to tests/webdriver/smoke.ts (a tauri-driver on
// 127.0.0.1:4444 and an application build; on Linux also WebKitWebDriver,
// Xvfb and a session bus).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { remote } from "webdriverio";

// WebdriverIO's capability types don't know the `tauri:options` vendor prefix
// that tauri-driver consumes, so the capabilities object goes through a cast.
type RemoteParameters = Parameters<typeof remote>[0];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

// tauri-driver launches this binary for every new session.
const APP_BINARY =
  process.env.QUARTZSSH_BINARY ??
  path.resolve(scriptDir, "../../src-tauri/target/debug/quartzssh");

// Output directory: docs/screenshots in the repository, overridable for
// local experiments.
const OUT_DIR =
  process.env.QUARTZSSH_SCREENSHOTS_DIR ??
  path.resolve(scriptDir, "../../docs/screenshots");

// The application window is 1280x800 (src-tauri/tauri.conf.json); normalize
// the viewport so shots look the same regardless of the display setup.
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;

const ELEMENT_TIMEOUT_MS = 30_000;
// Waits that only guard screenshot content are short: on timeout we still
// capture, we just log a warning.
const CONTENT_TIMEOUT_MS = 10_000;
const DRIVER_PORT = 4444;

const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

fs.mkdirSync(OUT_DIR, { recursive: true });

let captured = 0;
const failures: string[] = [];

async function attempt(name: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
    captured += 1;
  } catch (err: unknown) {
    failures.push(name);
    console.error(`screenshot step "${name}" failed (continuing):`, err);
  }
}

async function save(name: string): Promise<void> {
  const file = path.join(OUT_DIR, name);
  await browser.saveScreenshot(file);
  console.log(`saved ${name}`);
}

async function waitTestid(testid: string, timeout = ELEMENT_TIMEOUT_MS): Promise<void> {
  const selector = `[data-testid="${testid}"]`;
  await browser.$(selector).waitForExist({
    timeout,
    timeoutMsg: `element ${selector} did not appear within ${timeout} ms`,
  });
}

async function clickTestid(testid: string): Promise<void> {
  const selector = `[data-testid="${testid}"]`;
  const element = browser.$(selector);
  await element.waitForExist({
    timeout: ELEMENT_TIMEOUT_MS,
    timeoutMsg: `element ${selector} did not appear within ${ELEMENT_TIMEOUT_MS} ms`,
  });
  await element.click();
}

// Best-effort wait: resolves even when the condition never becomes true
// (the caller still captures a screenshot in that case).
async function waitUntilOrContinue(
  name: string,
  condition: () => Promise<boolean>,
): Promise<void> {
  try {
    await browser.waitUntil(condition, { timeout: CONTENT_TIMEOUT_MS });
  } catch {
    console.warn(`condition "${name}" was not met within ${CONTENT_TIMEOUT_MS} ms; capturing anyway`);
    await settle(500);
  }
}

const browser = await remote({
  hostname: "127.0.0.1",
  port: DRIVER_PORT,
  logLevel: "error",
  connectionRetryCount: 15,
  connectionRetryTimeout: 45_000,
  capabilities: {
    "tauri:options": { application: APP_BINARY },
  } as RemoteParameters["capabilities"],
});

try {
  await attempt("viewport", async () => {
    await browser.setWindowSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  });

  // 1) Main window with the sessions panel (fresh profile: empty sessions,
  //    welcome area in the main pane).
  await attempt("01-main-window", async () => {
    await waitTestid("app-shell");
    await waitTestid("sessions-panel");
    await settle(800); // let fonts/icon render settle
    await save("01-main-window.png");
  });

  // 2) Settings view (activity bar -> settings button).
  await attempt("02-settings", async () => {
    await clickTestid("activity-settings");
    // SettingsView renders a single <h1> inside <main> once the backend
    // settings have loaded; language-independent and unique in the app.
    await browser
      .$("main h1")
      .waitForExist({ timeout: CONTENT_TIMEOUT_MS, timeoutMsg: "settings heading did not appear" });
    await settle(400);
    await save("02-settings.png");
  });

  // 3) Second color scheme: one click on the status-bar theme button cycles
  //    to the next built-in theme (works from any tab; we return to the main
  //    window first so the shot shows the shell, not the settings form).
  await attempt("03-second-theme", async () => {
    await clickTestid("activity-sessions");
    await waitTestid("statusbar-theme");
    const themeButton = browser.$('[data-testid="statusbar-theme"]');
    const before = await themeButton.getText();
    await themeButton.click();
    await waitUntilOrContinue("theme button label changed", async () => {
      const label = await themeButton.getText();
      return label !== before;
    });
    await settle(400);
    await save("03-second-theme.png");
  });

  // 4) Monitoring tab (activity bar -> monitoring button). With no active
  //    connections this shows the monitoring empty state.
  await attempt("04-monitoring", async () => {
    await clickTestid("activity-monitoring");
    // The monitoring entry becomes the active one (`itemActive` adds the
    // bg-[var(--q-active)] class) as soon as the tab has switched.
    await waitUntilOrContinue("monitoring tab active", async () => {
      const className = await browser
        .$('[data-testid="activity-monitoring"]')
        .getAttribute("class");
      return (className ?? "").includes("q-active");
    });
    await settle(400);
    await save("04-monitoring.png");
  });
} finally {
  // Closing the session also makes tauri-driver terminate the spawned app.
  await browser.deleteSession().catch((err: unknown) => {
    console.error("failed to close WebDriver session:", err);
  });
}

console.log(`screenshots: ${captured} captured into ${OUT_DIR}`);
if (failures.length > 0) {
  console.warn(`screenshot steps that failed (best-effort, not fatal): ${failures.join(", ")}`);
}
// Always exit 0: screenshot capture must never fail the CI job.
process.exitCode = 0;
