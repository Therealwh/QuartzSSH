# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Security

- SHA-1 based host key algorithms, `arcfour` and `3des-cbc` are disabled;
  RSA authentication signs with SHA-256.
- Passwords and key passphrases are stored only in the OS credential store.
- All release workflow actions are pinned to full commit SHAs; the release
  publish job runs in a protected `release` environment.
