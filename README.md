<div align="center">

<img src="docs/logo/quartzssh-main.svg" alt="QuartzSSH" width="128" />

# QuartzSSH

**Лёгкий, красивый и быстрый open-source SSH/SFTP-клиент**

[Русский](README.md) | [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Therealwh/QuartzSSH?include_prereleases)](https://github.com/Therealwh/QuartzSSH/releases/latest)
[![CI](https://github.com/Therealwh/QuartzSSH/actions/workflows/ci.yml/badge.svg)](https://github.com/Therealwh/QuartzSSH/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Therealwh/QuartzSSH/badge)](https://scorecard.dev/viewer/?uri=github.com/Therealwh/QuartzSSH)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#-установка)
[![i18n](https://img.shields.io/badge/i18n-RU%20%7C%20EN-green)](#-возможности)
[![Made with Rust](https://img.shields.io/badge/made%20with-Rust-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Made with Tauri](https://img.shields.io/badge/made%20with-Tauri-24C8DB?logo=tauri&logoColor=white)](https://v2.tauri.app)

</div>

---

**QuartzSSH** — клиент SSH/SFTP для разработчиков и системных администраторов.
Минимальное потребление ресурсов (Tauri 2 вместо Electron), эстетичный
интерфейс, строгая безопасность и открытый исходный код.

## ✨ Возможности

- **SSH-клиент**: пароль и ключи (Ed25519, ECDSA, RSA-SHA2), профили с группами
  и поиском, вкладки, keepalive, автопереподключение
- **Терминал** на xterm.js: True Color, Unicode, поиск по буферу (Ctrl+F),
  копирование/вставка через контекстное меню и Ctrl+Shift+C/V
- **SFTP-менеджер**: две панели (локально + сервер), drag-and-drop, очередь
  передач с прогрессом и отменой, chmod, переименование
- **Безопасность по умолчанию**: строгая проверка ключей сервера (known_hosts),
  отклонение изменённых ключей с диагностикой, пароли — только в хранилище ОС
- **Постквантовый обмен ключами**: `mlkem768x25519-sha256` используется при
  поддержке сервера (OpenSSH 9.9+); фактический согласованный KEX виден
  в строке состояния (бейдж «PQ» / «Классика»)
- **Импорт `~/.ssh/config`** с предпросмотром и понятными предупреждениями,
  экспорт обратно
- **7 цветовых схем** — Catppuccin Mocha, Dracula, Nord, Tokyo Night,
  Solarized Dark, Gruvbox Dark, One Dark — применяются к интерфейсу и
  терминалу одновременно
- **Локализация RU/EN** без перезапуска
- **Подписанные автообновления** (Ed25519, anti-rollback)

## 📦 Установка

Скачайте установщик со страницы [релизов](https://github.com/Therealwh/QuartzSSH/releases/latest):

| Платформа | Файл |
| --------- | ---- |
| Windows | `QuartzSSH_*_x64-setup.exe` (или `.msi`) |
| macOS | `QuartzSSH_*_aarch64.app.tar.gz` (Apple Silicon), `*_x64.app.tar.gz` (Intel) |
| Linux | `QuartzSSH_*_amd64.AppImage` / `.deb` |

> ✏️ TODO: заменить на реальные скриншоты приложения (сессии, терминал, SFTP, темы).

## 🛠 Сборка из исходников

Требования: **Node.js 20+**, **Rust 1.89+** (MSVC на Windows), **NASM**
(на Windows, нужен крейту `ring`); на Linux —
`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`.

```bash
git clone https://github.com/Therealwh/QuartzSSH.git
cd QuartzSSH
npm install
npm run tauri dev     # запуск в режиме разработки
npm run tauri build   # сборка установщика
```

Подробнее — в [CONTRIBUTING.md](CONTRIBUTING.md).

## 🗺 Планы

- [x] Порт-форвардинг (local / remote / dynamic SOCKS)
- [x] Панель живой статистики сервера (CPU, RAM, диск, сеть)
- [x] Встроенный редактор кода для файлов на сервере (CodeMirror 6, атомарная запись с проверкой mtime)
- [x] Workspaces, split-view и broadcast-ввод
- [x] Аппаратные ключи FIDO2 (`sk-ssh-ed25519@openssh.com`) — частично:
  детекция и профильная поддержка готовы, user-presence подпись через
  libfido2 — в планах

- [x] Опциональный MCP-сервер для интеграции с AI-агентами (выключен по умолчанию; [docs/mcp-server.md](docs/mcp-server.md))
- [x] Smoke e2e на tauri-driver (WebDriver, CI)
- [x] Broadcast-вставка (paste) в split-view
- [ ] E2E-проверка автообновлений после первого релиза


## 🤝 Участие

Приветствуются issue и pull request'ы! Прочитайте
[CONTRIBUTING.md](CONTRIBUTING.md), чтобы начать. Вопросы безопасности —
только приватно, через [SECURITY.md](SECURITY.md).

## 📄 Лицензия

Проект распространяется по лицензии [MIT](LICENSE).

## 🙏 Благодарности

- [Tauri](https://v2.tauri.app) — лёгкая оболочка приложений
- [russh](https://github.com/warp-tech/russh) — SSH-протокол на Rust
- [xterm.js](https://xtermjs.org) — эмулятор терминала
- Сообществам палитр: [Catppuccin](https://catppuccin.com),
  [Dracula](https://draculatheme.com), [Nord](https://nordtheme.com),
  [Tokyo Night](https://github.com/tokyo-night/tokyo-night-vscode-theme),
  [Solarized](https://ethanschoonover.com/solarized/),
  [Gruvbox](https://github.com/morhetz/gruvbox), [One Dark](https://github.com/atom/one-dark-syntax)

---

<div align="center">
Сделано с ❤️ для командной строки
</div>
