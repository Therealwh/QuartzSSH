# Keyboard shortcuts

The same shortcuts are used everywhere unless remapped by the user. On macOS
`Ctrl` is replaced by `⌘ Cmd`.

| Action | Windows / Linux | macOS |
| ------ | --------------- | ----- |
| New tab | `Ctrl + T` | `⌘ + T` |
| Close tab | `Ctrl + W` | `⌘ + W` |
| Search in terminal | `Ctrl + F` | `⌘ + F` |
| Copy (terminal) | `Ctrl + Shift + C` | `⌘ + C` |
| Paste (terminal) | `Ctrl + Shift + V` | `⌘ + V` |
| Split view | `Ctrl + Shift + M` | `⌘ + Shift + M` |
| Broadcast input | `Ctrl + Shift + B` | `⌘ + Shift + B` |
| Open SFTP for active tab | `Ctrl + Shift + S` | `⌘ + Shift + S` |
| Switch color scheme | `Ctrl + Shift + T` | `⌘ + Shift + T` |
| Switch language RU ⇄ EN | status bar button | — |

## Workspaces notes

- `Ctrl + T` opens a new tab connected to the same profile as the active
  terminal. A disconnected active tab is reconnected in place; switching the
  color scheme stays on `Ctrl + Shift + T`.
- `Ctrl + W` closes the app tab; it is never sent to the remote shell.
- Turning broadcast input off asks for confirmation, so a stray keypress
  does not cut off the other sessions.
- Split view shows up to four terminals (2×2); with fewer than two
  terminals the normal view is kept with a hint.

## Terminal input notes

- `Ctrl + C` / `Ctrl + V` are passed to the remote shell as usual
  (SIGINT, etc.). To copy or paste, use the `Shift`-modified combinations or
  the context menu.
- The search bar closes with `Esc`.

## Planned

| Action | Windows / Linux | macOS |
| ------ | --------------- | ----- |
| Reconnect | `Ctrl + Shift + R` | `⌘ + Shift + R` |
