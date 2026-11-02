# Testing

QuartzSSH has four test layers, from fastest to slowest:

| Layer                    | Command                     | What it covers                                              |
| ------------------------ | --------------------------- | ----------------------------------------------------------- |
| Frontend unit            | `npx vitest run`            | Pure helpers, i18n key parity, component rendering (jsdom)  |
| Rust unit                | `cargo test` (in `src-tauri`) | Parsers, stores, pure logic                               |
| Rust integration         | `cargo test` with `QUARTZSSH_TEST_SSH_*` set | Real SSH/SFTP protocol against an OpenSSH server |
| WebDriver smoke (this page) | `node tests/webdriver/smoke.ts` | The real packaged binary starts and renders its UI      |

## WebDriver smoke test (tauri-driver)

The smoke test drives the actual application binary over the
[WebDriver](https://www.w3.org/TR/webdriver/) protocol:

1. [`tauri-driver`](https://crates.io/crates/tauri-driver) accepts WebDriver
   requests on `127.0.0.1:4444`.
2. For every new session it spawns the application binary listed in the
   `tauri:options` capability.
3. On Linux the automation backend is `WebKitWebDriver` (package
   `webkit2gtk-driver`), which drives the same WebKitGTK view the app uses.
4. The test (`tests/webdriver/smoke.ts`) asserts the window title and that the
   key shell elements are present:

   - `data-testid="app-shell"` (`src/App.tsx`)
   - `data-testid="sessions-panel"` (`src/App.tsx`)
   - `data-testid="tab-bar"` (`src/components/TabBar.tsx`)

CI runs the same steps in [`.github/workflows/webdriver.yml`].

### Prerequisites (Linux)

- Node.js >= 22.18 (runs the `.ts` test file natively) and npm dependencies
  (`npm install`, `webdriverio` is a devDependency).
- A debug build of the application. Build it through the Tauri CLI — it embeds
  `../dist` (built by the `beforeBuildCommand`) and enables the
  `tauri/custom-protocol` feature, without which the binary would run in dev
  mode and expect the Vite dev server at `localhost:1420`:

  ```sh
  npx tauri build --debug --no-bundle
  ```

  (A plain `cargo build` is not enough for the same reason.)

- `tauri-driver` (independent of the Tauri runtime version; 2.x is the stable
  line for Tauri v2):

  ```sh
  cargo install tauri-driver --version 2.1.0 --locked
  ```

- System packages: `webkit2gtk-driver` (provides `WebKitWebDriver`),
  `xvfb` (virtual display), `dbus` (`dbus-run-session`), plus the usual
  build dependencies (`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev
  patchelf`).

### Running locally (Linux)

```sh
export QUARTZSSH_BINARY="$PWD/src-tauri/target/debug/quartzssh"
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1

dbus-run-session -- xvfb-run -a bash -c '
  "$HOME/.cargo/bin/tauri-driver" > tauri-driver.log 2>&1 &
  driver_pid=$!
  trap "kill $driver_pid 2>/dev/null || true" EXIT
  for i in $(seq 1 30); do
    (echo > /dev/tcp/127.0.0.1/4444) 2>/dev/null && break
    sleep 1
  done
  node tests/webdriver/smoke.ts
'
```

Notes:

- The single `dbus-run-session` matters: `tauri-driver` spawns
  `WebKitWebDriver`, and WebKit automation connects back over the session bus,
  so the driver and the application must share one bus.
- `WEBKIT_DISABLE_COMPOSITING_MODE` / `WEBKIT_DISABLE_DMABUF_RENDERER` avoid
  WebKit GPU paths that hang or crash in virtual displays and CI VMs.
- On a real desktop session (not CI) you can skip `xvfb-run` and
  `dbus-run-session`; keep the two `WEBKIT_*` variables if rendering glitches
  appear.
- `QUARTZSSH_BINARY` defaults to `src-tauri/target/debug/quartzssh` relative to
  the repository root.

### Windows (optional)

`tauri-driver` also works on Windows (backend: Microsoft Edge WebDriver in
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` mode managed by tauri-driver). It is
not wired into CI because the project's e2e gate runs on Linux; to try it
locally install `msedgedriver` matching your Edge version, put it on `PATH`,
and run `tauri-driver` + the same smoke script (the `application` capability
points at `src-tauri\target\debug\quartzssh.exe`).

## Capturing README screenshots

[`tests/webdriver/screenshots.ts`](../tests/webdriver/screenshots.ts) captures
the application in the key UI states used by the README — the fresh shell with
the sessions panel, the settings view, a second color scheme (one click on the
status-bar theme button), and the monitoring tab — into `docs/screenshots/*.png`.

It runs in the same CI job as the smoke test, in its own WebDriver session,
strictly as a best-effort step after the smoke assertions: every capture is
wrapped in `try/catch` and the script always exits 0, so a screenshot problem
can never fail the smoke gate. CI uploads the PNGs as the **app-screenshots**
artifact (retention: 30 days).

To refresh the images embedded in the README:

1. Open the repository on GitHub → **Actions** → *WebDriver smoke* → pick a
   green run → download the `app-screenshots` artifact, or use the CLI:
   `gh run download <run-id> -n app-screenshots`.
2. Unzip it into `docs/screenshots/` in your checkout and review the PNGs
   (they are captured from a 1280x800 window on a headless display).
3. Commit the good ones manually — CI never commits screenshots itself.

To capture locally, build the app (see [Prerequisites](#prerequisites-linux))
and reuse the smoke-test launch recipe with the screenshots script:

```sh
export QUARTZSSH_BINARY="$PWD/src-tauri/target/debug/quartzssh"
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1

dbus-run-session -- xvfb-run -a bash -c '
  "$HOME/.cargo/bin/tauri-driver" > tauri-driver.log 2>&1 &
  driver_pid=$!
  trap "kill $driver_pid 2>/dev/null || true" EXIT
  for i in $(seq 1 30); do
    (echo > /dev/tcp/127.0.0.1/4444) 2>/dev/null && break
    sleep 1
  done
  node tests/webdriver/screenshots.ts
'
```

Output goes to `docs/screenshots/` (override with
`QUARTZSSH_SCREENSHOTS_DIR`).

## Idle memory budget (memory-budget job)

The second job in [`.github/workflows/webdriver.yml`], `memory-budget`,
builds the release binary (`npx tauri build --no-bundle` — a plain
`cargo build --release` is not enough, the binary must embed the frontend),
runs it directly under Xvfb with a private session bus, waits 45 s (first
paint plus the automatic update check) and reads its resident set size with
`ps -o rss= -C quartzssh`. The job fails when idle RSS exceeds
`RSS_BUDGET_MIB` (50 MiB by default, editable in the workflow).

The job currently runs with `continue-on-error: true`: launching the raw
release binary under a virtual display without tauri-driver is a newer,
not-yet-fully-validated path in CI, so budget violations are advisory
until the flag is removed.

## Updating the smoke test

- Keep the assertion list minimal — this suite answers "did the app start and
  render its skeleton", nothing more. Deeper UI coverage belongs in the vitest
  component tests.
- When adding shell-level UI, add a `data-testid` and extend
  `REQUIRED_TESTIDS` in `tests/webdriver/smoke.ts`.
- If the session cannot connect, check `tauri-driver.log` (CI prints it on
  failure) and confirm `WebKitWebDriver` is on `PATH`
  (`dpkg -L webkit2gtk-driver | grep WebDriver`).
