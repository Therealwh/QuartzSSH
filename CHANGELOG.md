# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-11-03

### Fixed

- Crash of the whole application when a session disconnected or a
  disconnected tab was reconnected (React hook order violation).
- Closing the SFTP tab no longer kills a live terminal sharing the same
  SSH session; closing one editor tab no longer discards the other
  editors of that session.
- Dead sessions are removed from the active-connection state (status
  bar counter, SFTP/monitoring targets).
- File drag-and-drop between SFTP panes now works at Windows display
  scaling 125/150%.

### Added

- Connection failures surface as translated toasts and on the
  disconnected-tab overlay (password, host key, timeout, hardware key).
- Settings reorganized into a two-pane category layout.
- Session lifecycle regression tests (15 files / 89 frontend tests,
  63 Rust tests).

### Added

- Accessibility hardening: High Contrast theme (WCAG AAA contrast, covered by
  tests), axe-core audit in the WebDriver CI job (gates on critical/serious
  violations), focus trap in dialogs, table semantics for the SFTP panes.
- Post-quantum status badge in the status bar: shows the actual negotiated
  key exchange (via the russh kex_done hook) — PQ (mlkem768x25519-sha256)
  or classic, per session.
- System tray: Open/Quit menu, left-click restores the window, and an
  optional close-to-tray background mode (spec 26.6) for background MCP
  server and live sessions.
- External ~/.ssh/config change detection: a review dialog lists
  added/removed/changed hosts against the last reviewed snapshot (18.3).
- Broadcast paste: paste (Ctrl+Shift+V / context menu) is sent to every
  connected terminal in broadcast mode.
- Ctrl+T duplicates the active session in a new tab.
- Dependency audit workflow: RustSec advisories and npm audit.

## [0.1.0] - 2026-11-02

### Added

- SSH client: password and key authentication (Ed25519, ECDSA, RSA-SHA2), session profiles
  with groups and search, tabs, keepalive, auto-reconnect.
- Interactive terminal based on xterm.js: True Color, 256 colors, Unicode,
  search (Ctrl+F), copy/paste via context menu and Ctrl+Shift+C/V.
- Strict host key verification with OpenSSH-compatible known_hosts
  (plain and hashed entries), import from `~/.ssh/known_hosts`.
- SFTP manager: two-pane view (local + remote), drag-and-drop, transfer queue
  with progress and cancellation, chmod editing, rename/mkdir/delete.
- Import/export of `~/.ssh/config` (preview with parser warnings).
- Seven color schemes applied to UI and terminal at once:
  Catppuccin Mocha, Dracula, Nord, Tokyo Night, Solarized Dark,
  Gruvbox Dark, One Dark.
- Localization: Russian and English, switchable without restart.
- Signed auto-updates (Ed25519, tauri-plugin-updater) with anti-rollback and
  CI-generated `latest.json` that fails the release when signatures are missing.
- Post-quantum key exchange preference: `mlkem768x25519-sha256` first in the
  KEX list when the server supports it.
- Server monitoring panel: live CPU, RAM, disk and network statistics of the
  connected host.
- Remote code editor (CodeMirror 6) for files on the server: optimistic
  mtime check before every write and as-atomic-as-possible replacement
  (temp file + rename, with an in-place `CREATE|TRUNCATE` fallback).
- Port forwarding: local, remote, and dynamic SOCKS5.
- Workspaces: split view, broadcast input to multiple sessions, session
  restore.
- Optional embedded MCP server for AI agents, off by default: TCP bound to
  `127.0.0.1` only, in-memory Bearer token, loopback `Host` check
  (DNS-rebinding defense), per-profile allowlist, explicit confirmation for
  destructive calls, ring-buffer audit log. See `docs/mcp-server.md`.
- SSH integration test suite in CI: real-protocol tests against an OpenSSH
  server container (auth, shell, SFTP round-trips).
- CI installer size gate: the Windows NSIS installer must stay within the
  20 MiB acceptance budget.
- FIDO2 hardware key detection (`sk-ssh-ed25519@openssh.com`,
  `sk-ecdsa-sha2-nistp256@openssh.com`) with a key-type badge in the connect
  dialog and an honest early error on connect — user-presence signing via
  libfido2 is planned (PR #20).
- Security unit tests: client algorithm preferences keep the post-quantum
  KEX first and exclude SHA-1 KEX/ciphers/MACs plus the bare `ssh-rsa` host
  key algorithm, and known_hosts first-contact/changed-key detection is
  covered.
- `Ctrl + T` opens a new tab connected to the same profile as the active
  terminal (a disconnected active tab is reconnected in place).

### Changed

- Dependencies updated: TypeScript 7, `sha2` 0.11, `base64`, `dirs`, and
  GitHub Actions (checkout, upload-artifact, codeql-action, github-script,
  rust-cache) refreshed and pinned to full commit SHAs.

### Fixed

- known_hosts verification never matched a pinned key (the parser cut the
  key blob after the algorithm name), so every reconnect was misreported as
  a changed host key instead of `Known`; the security unit tests for the
  changed/known/new states caught it.
- russh-sftp `SftpSession::write` opens the target without `TRUNCATE`, so
  writing shorter content left a stale tail on the server (silent
  corruption). All remote write paths now open files with
  `WRITE|CREATE|TRUNCATE`; the editor additionally swaps the whole file via
  temp file + rename where the server supports it.

### Security

- SHA-1 based host key algorithms, `arcfour` and `3des-cbc` are disabled;
  RSA authentication signs with SHA-256.
- Passwords and key passphrases are stored only in the OS credential store.
- All release workflow actions are pinned to full commit SHAs; the release
  publish job runs in a protected `release` environment.
- The embedded MCP server never listens by default, is reachable from
  `127.0.0.1` only, requires a Bearer token, and grants access only to
  profiles explicitly allowlisted by the user.
