<div align="center">

<img src="docs/logo/quartzssh-main.svg" alt="QuartzSSH" width="128" />

# QuartzSSH

**A lightweight, beautiful and fast open-source SSH/SFTP client**

[Русский](README.md) | [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Therealwh/QuartzSSH?include_prereleases)](https://github.com/Therealwh/QuartzSSH/releases/latest)
[![CI](https://github.com/Therealwh/QuartzSSH/actions/workflows/ci.yml/badge.svg)](https://github.com/Therealwh/QuartzSSH/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Therealwh/QuartzSSH/badge)](https://scorecard.dev/viewer/?uri=github.com/Therealwh/QuartzSSH)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#installation)
[![i18n](https://img.shields.io/badge/i18n-RU%20%7C%20EN-green)](#localization)
[![Made with Rust](https://img.shields.io/badge/made%20with-Rust-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Made with Tauri](https://img.shields.io/badge/made%20with-Tauri-24C8DB?logo=tauri&logoColor=white)](https://v2.tauri.app)

</div>

---

**QuartzSSH** is an SSH/SFTP client for developers and system administrators.
Minimal resource usage (Tauri 2 instead of Electron), an aesthetic interface,
strict security defaults and fully open source.

## ✨ Features

- **SSH client**: password and key authentication (Ed25519, ECDSA, RSA-SHA2),
  session profiles with groups and search, tabs, keepalive, auto-reconnect
- **Terminal** powered by xterm.js: True Color, Unicode, buffer search (Ctrl+F),
  copy/paste via context menu and Ctrl+Shift+C/V
- **SFTP manager**: two panes (local + remote), drag-and-drop, transfer queue
  with progress and cancellation, chmod editing, rename
- **Secure by default**: strict host key verification (known_hosts), changed
  keys are rejected with a diagnostic dialog, passwords live only in the OS
  credential store
- **Post-quantum key exchange**: `mlkem768x25519-sha256` is used when the
  server supports it (OpenSSH 9.9+)
- **`~/.ssh/config` import** with a preview and clear warnings, plus export
- **7 color schemes** — Catppuccin Mocha, Dracula, Nord, Tokyo Night,
  Solarized Dark, Gruvbox Dark, One Dark — applied to the UI and the terminal
  at once
- **RU/EN localization** without a restart
- **Signed auto-updates** (Ed25519, anti-rollback)

## 📦 Installation

Download an installer from the [releases](https://github.com/Therealwh/QuartzSSH/releases/latest) page:

| Platform | File |
| -------- | ---- |
| Windows | `QuartzSSH_*_x64-setup.exe` (or `.msi`) |
| macOS | `QuartzSSH_*_aarch64.app.tar.gz` (Apple Silicon), `*_x64.app.tar.gz` (Intel) |
| Linux | `QuartzSSH_*_amd64.AppImage` / `.deb` |

> ✏️ TODO: replace with real application screenshots (sessions, terminal, SFTP, themes).

## 🛠 Building from source

Requirements: **Node.js 20+**, **Rust 1.89+** (MSVC on Windows), **NASM**
(on Windows, required by the `ring` crate); on Linux —
`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`.

```bash
git clone https://github.com/Therealwh/QuartzSSH.git
cd QuartzSSH
npm install
npm run tauri dev     # run in development mode
npm run tauri build   # build the installer
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## 🗺 Roadmap

- [x] Port forwarding (local / remote / dynamic SOCKS)
- [x] Live server statistics panel (CPU, RAM, disk, network)
- [x] Built-in remote code editor (CodeMirror 6, atomic writes with mtime checks)
- [ ] Workspaces, split view and broadcast input
- [ ] FIDO2 hardware keys (`sk-ssh-ed25519@openssh.com`)
- [ ] Optional MCP server for AI agents (off by default)

## 🤝 Contributing

Issues and pull requests are welcome! Read [CONTRIBUTING.md](CONTRIBUTING.md)
to get started. Security issues must be reported privately — see
[SECURITY.md](SECURITY.md).

## 📄 License

The project is licensed under [MIT](LICENSE).

## 🙏 Acknowledgements

- [Tauri](https://v2.tauri.app) — lightweight app shell
- [russh](https://github.com/warp-tech/russh) — SSH protocol in Rust
- [xterm.js](https://xtermjs.org) — terminal emulator
- Palette communities: [Catppuccin](https://catppuccin.com),
  [Dracula](https://draculatheme.com), [Nord](https://nordtheme.com),
  [Tokyo Night](https://github.com/tokyo-night/tokyo-night-vscode-theme),
  [Solarized](https://ethanschoonover.com/solarized/),
  [Gruvbox](https://github.com/morhetz/gruvbox), [One Dark](https://github.com/atom/one-dark-syntax)

---

<div align="center">
Made with ❤️ for the command line
</div>
