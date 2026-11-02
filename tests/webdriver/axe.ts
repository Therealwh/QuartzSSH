// WebDriver accessibility audit for the Tauri application (task section 20.4).
//
// Prerequisites are identical to tests/webdriver/smoke.ts (a tauri-driver on
// 127.0.0.1:4444 and a debug build with the frontend embedded; on Linux also
// WebKitWebDriver, Xvfb and a session bus). Run AFTER the smoke test in the
// same CI job — tauri-driver spawns a fresh application instance for this
// script's own WebDriver session.
//
// How the scan works (no application changes needed):
//   1. The axe-core source (the `axe-core` npm dependency) is read from
//      node_modules/axe-core/axe.min.js and injected into the webview with a
//      plain WebDriver Execute Script (`browser.execute(axeSource)`), which
//      defines `window.axe`. This is the same mechanism Deque's own
//      @axe-core/webdriverio package uses under the hood.
//   2. `axe.run(document, ...)` is invoked via Execute Async Script
//      (`browser.executeAsync`), so the promise resolves through the WebDriver
//      callback and the results cross the process boundary as plain JSON.
//   3. Violations are written to axe-report.json (uploaded as a CI artifact)
//      and summarized in the job log.
//
// Gate (documented fallback): the process exits 1 ONLY when at least one
// violation with impact `critical` or `serious` exists; `moderate`/`minor`
// violations are logged as warnings and do not fail the job. If Execute
// Script injection ever becomes unavailable in a webview (e.g. a driver that
// caps script body size), the documented fallback is to bundle axe-core into
// the frontend behind a query flag (import "axe-core/axe.min.js") so that
// `window.axe` exists at startup — the rest of this script is unchanged.
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

// Where the JSON report lands (repo root in CI; upload as an artifact).
const REPORT_PATH =
  process.env.QUARTZSSH_AXE_REPORT ??
  path.resolve(scriptDir, "../../axe-report.json");

// axe-core ships its minified browser bundle at the package root.
const AXE_SOURCE_PATH = path.resolve(
  scriptDir,
  "../../node_modules/axe-core/axe.min.js",
);

// Deterministic rule set: WCAG 2.1 A/AA plus axe best practices.
const RULE_TAGS = ["wcag2a", "wcag21a", "wcag2aa", "wcag21aa", "best-practice"];

// Only these impacts fail the job (task 20.4); moderate/minor warn only.
const BLOCKING_IMPACTS = new Set(["critical", "serious"]);

const ELEMENT_TIMEOUT_MS = 30_000;
const DRIVER_PORT = 4444;

interface AxeNode {
  target: unknown[];
  failureSummary?: string;
}

interface AxeViolation {
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical" | null;
  help?: string;
  description?: string;
  helpUrl?: string;
  tags?: string[];
  nodes?: AxeNode[];
}

interface RunOutcome {
  axeError?: string;
  violations?: AxeViolation[];
}

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
  // Wait for the shell so the scan runs against a rendered document.
  const shell = browser.$('[data-testid="app-shell"]');
  await shell.waitForExist({
    timeout: ELEMENT_TIMEOUT_MS,
    timeoutMsg: `element [data-testid="app-shell"] did not appear within ${ELEMENT_TIMEOUT_MS} ms`,
  });

  // 1) Inject axe-core: Execute Script evaluates the minified bundle in the
  //    page, which assigns the global `window.axe`.
  const axeSource = fs.readFileSync(AXE_SOURCE_PATH, "utf8");
  await browser.execute(axeSource);

  // 2) Run the audit. WebdriverIO executes an async function through
  //    WebDriver's Execute Async Script (it awaits the returned promise in
  //    the page), so the axe.run result crosses the process boundary as
  //    plain JSON. The function body is serialized into the page: it must
  //    not close over anything from this Node process (the rule tags below
  //    are inlined on purpose — keep them in sync with RULE_TAGS).
  const outcome = (await browser.execute(async () => {
    const w = window as unknown as {
      axe?: { run: (context: Document, options: unknown) => Promise<unknown> };
    };
    if (!w.axe) {
      return { axeError: "window.axe is undefined after injection" };
    }
    try {
      return await w.axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag21a", "wcag2aa", "wcag21aa", "best-practice"],
        },
      });
    } catch (err) {
      return { axeError: String(err) };
    }
  })) as RunOutcome | null;

  if (
    outcome === null ||
    typeof outcome !== "object" ||
    !("violations" in (outcome as RunOutcome)) ||
    (outcome as RunOutcome).axeError
  ) {
    throw new Error(
      `axe.run failed: ${(outcome as RunOutcome | null)?.axeError ?? "no results returned"}`,
    );
  }

  const violations = ((outcome as RunOutcome).violations ?? []) as AxeViolation[];
  const url = await browser.getUrl();

  // 3) Write the machine-readable report (always, even when empty).
  const report = {
    url,
    timestamp: new Date().toISOString(),
    tool: "axe-core",
    ruleTags: RULE_TAGS,
    counts: {
      critical: violations.filter((v) => v.impact === "critical").length,
      serious: violations.filter((v) => v.impact === "serious").length,
      moderate: violations.filter((v) => v.impact === "moderate").length,
      minor: violations.filter((v) => v.impact === "minor").length,
    },
    violations: violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      helpUrl: v.helpUrl,
      tags: v.tags,
      nodes: (v.nodes ?? []).slice(0, 20).map((n) => ({
        target: n.target,
        failureSummary: n.failureSummary,
      })),
    })),
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  // 4) Human-readable summary in the CI log.
  console.log(
    `axe-core audit of ${url}: ${violations.length} violation type(s) — ` +
      `critical: ${report.counts.critical}, serious: ${report.counts.serious}, ` +
      `moderate: ${report.counts.moderate}, minor: ${report.counts.minor}`,
  );
  console.log(`report written to ${REPORT_PATH}`);
  for (const v of violations) {
    const line = `[axe:${v.impact ?? "unknown"}] ${v.id} — ${v.help ?? v.description ?? ""}`;
    if (v.impact && BLOCKING_IMPACTS.has(v.impact)) {
      console.error(line);
    } else {
      console.warn(line);
    }
  }

  const blocking = violations.filter(
    (v) => v.impact !== null && BLOCKING_IMPACTS.has(v.impact),
  );
  if (blocking.length > 0) {
    console.error(
      `GATE FAILED: ${blocking.length} critical/serious violation type(s); see axe-report.json`,
    );
    process.exitCode = 1;
  } else {
    console.log("GATE PASSED: no critical/serious violations");
  }
} finally {
  // Closing the session also makes tauri-driver terminate the spawned app.
  await browser.deleteSession().catch((err: unknown) => {
    console.error("failed to close WebDriver session:", err);
  });
}
