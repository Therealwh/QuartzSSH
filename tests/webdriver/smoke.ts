// WebDriver smoke test for the Tauri application (task section 19.3).
//
// Prerequisites (all provided by .github/workflows/webdriver.yml on CI,
// or by hand locally — see docs/testing.md):
//   1. A `tauri-driver` process listening on 127.0.0.1:4444.
//   2. A debug build of the application at
//      src-tauri/target/debug/quartzssh (frontend must be built into
//      ../dist BEFORE `cargo build`, because Tauri embeds the assets).
//   3. On Linux: WebKitWebDriver (package `webkit2gtk-driver`) on PATH.
//
// tauri-driver spawns the application binary from the `tauri:options`
// capability, so the script itself only opens the WebDriver session and
// asserts that the shell UI rendered. It exits non-zero on the first
// assertion failure.
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

// Key elements of the application shell. Kept intentionally small: this
// suite only answers "did the app start and render its skeleton".
const REQUIRED_TESTIDS = ["app-shell", "sessions-panel", "tab-bar"] as const;

// The application window title comes from the static index.html.
const EXPECTED_TITLE = "QuartzSSH";

const ELEMENT_TIMEOUT_MS = 30_000;
const DRIVER_PORT = 4444;

const browser = await remote({
  hostname: "127.0.0.1",
  port: DRIVER_PORT,
  logLevel: "error",
  // Retry while tauri-driver / WebKitWebDriver finish booting.
  connectionRetryCount: 15,
  connectionRetryTimeout: 45_000,
  capabilities: {
    "tauri:options": { application: APP_BINARY },
  } as RemoteParameters["capabilities"],
});

try {
  // Elements first: their polling guarantees the initial document has
  // finished loading, which makes the static title check race-free.
  for (const testid of REQUIRED_TESTIDS) {
    const selector = `[data-testid="${testid}"]`;
    await browser.$(selector).waitForExist({
      timeout: ELEMENT_TIMEOUT_MS,
      timeoutMsg: `element ${selector} did not appear within ${ELEMENT_TIMEOUT_MS} ms`,
    });
  }

  const title = await browser.getTitle();
  if (!title.includes(EXPECTED_TITLE)) {
    throw new Error(
      `unexpected window title: "${title}", expected to contain "${EXPECTED_TITLE}"`,
    );
  }

  console.log(
    `WebDriver smoke: OK — title "${title}", elements present: ${REQUIRED_TESTIDS.join(", ")}`,
  );
} finally {
  // Closing the session also makes tauri-driver terminate the spawned app.
  await browser.deleteSession().catch((err: unknown) => {
    console.error("failed to close WebDriver session:", err);
  });
}
