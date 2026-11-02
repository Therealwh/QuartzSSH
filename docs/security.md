# Security

This document describes how QuartzSSH protects your connections and data, and
how to report vulnerabilities. For the disclosure policy see
[SECURITY.md](../SECURITY.md).

## Host key verification

Verification runs inside the SSH handshake (`check_server_key`) and cannot be
skipped by the interface:

| Mode | Behavior | Availability |
| ---- | -------- | ------------ |
| **Strict** (default) | Known key → connect. New key → explicit dialog with the SHA-256 fingerprint (TOFU with consent). Changed key → diagnostic dialog showing both fingerprints; the connection is refused unless the user explicitly accepts the risk, and the new key is never stored silently. | default |
| **Accept-first (TOFU)** | New keys are pinned without asking; changed keys still raise the dialog. | opt-in |
| Non-strict | Accept everything. Debugging only; hidden from the UI, settable only by editing `settings.json`. | hidden |

The `known_hosts` file uses the OpenSSH format, so entries can be inspected
with standard tools. Import from `~/.ssh/known_hosts` merges new lines only.

## Algorithms

- Enabled by default: `mlkem768x25519-sha256` (post-quantum hybrid, preferred),
  `curve25519-sha256`, DH-GEX ≥ 3072-bit with SHA-2, Ed25519, ECDSA
  (NIST P-256/384/521), `rsa-sha2-256/512`, `chacha20-poly1305@openssh.com`,
  `aes256-gcm@openssh.com`, `aes128-gcm@openssh.com`.
- Disabled: `ssh-rsa` (SHA-1 signatures), `diffie-hellman-group1-sha1`,
  `arcfour`, `3des-cbc`. RSA private keys always sign with SHA-256.
- The SHA-1 based MACs are not offered by default.

## Post-Quantum & FIDO2

### Post-quantum key exchange

`mlkem768x25519-sha256` — the hybrid of ML-KEM-768 (FIPS 203) and X25519 — is
enabled by default and preferred during negotiation, so it is used whenever the
server supports it (OpenSSH 9.9+ with post-quantum KEX). The classical
`curve25519-sha256` remains available as a fallback, which means the hybrid
exchange is not a single point of failure: a failure or absence of ML-KEM on
either side degrades to the classical path instead of dropping the connection.

**How to see which KEX actually protects a connection.** russh reports the
negotiated algorithms in its `client::Handler::kex_done` callback; QuartzSSH
records the name there and surfaces it in the status bar: a green
`PQ: mlkem768x25519-sha256` badge when every active session negotiated the
post-quantum hybrid, and a neutral `Classic: …` badge (with the concrete
algorithm name) when at least one session fell back to a classical KEX —
that is the visible sign the server did not offer post-quantum key exchange.
The tooltip explains the classification; the same value is available to
integrations via the `ssh:connected` event and the `ssh_kex_info` command.

### FIDO2 hardware keys (`sk-ssh-ed25519@openssh.com`, `sk-ecdsa-sha2-nistp256@openssh.com`)

Status, honestly stated:

- **Ready — detection and classification.** Key files are inspected
  (`inspect_key_file`): hardware keys are recognized by the companion `.pub`
  file (`sk-ssh-ed25519@openssh.com` / `sk-ecdsa-sha2-nistp256@openssh.com`,
  certificate variants included) and by scanning the decoded private-key blob;
  PuTTY `.ppk` and standard OpenSSH keys are classified too. The connect dialog
  shows a badge with the key kind and, for hardware keys, a hint that a touch
  (user presence) is required at connect time.
- **Ready — honest failure instead of a broken attempt.** The pure-Rust stack
  (russh 0.65 / ssh-key 0.7) can parse and *verify* `sk-*` keys, but it cannot
  perform user-presence signing: the private material never leaves the token.
  Attempting to authenticate with a hardware key returns the explicit error
  `hardware_key_unsupported: FIDO2 user-presence signing requires libfido2
  integration (planned)` instead of an obscure signature failure mid-handshake.
- **Planned — user-presence signing** via libfido2 (or the native OS
  FIDO/CTAP APIs), including touch prompts and PIN handling. No
  authentication attempt is simulated until then.

Limitations:

- Not all servers accept `sk-*` keys — the server must list the `sk-*`
  algorithms in `PubkeyAcceptedAlgorithms` (OpenSSH 8.2+ for the base keys).
- `sk-*` certificate variants (`-cert-v01@openssh.com`) are classified as
  hardware keys as well, since they are signed by the same tokens.
- Encrypted private keys whose blob cannot be decoded without a passphrase
  cannot be pre-classified; the error then comes from the key parser.

## Credential storage

Passwords and key passphrases are stored exclusively in the operating system
credential store (Windows Credential Manager / macOS Keychain / Secret Service).
The profile database on disk contains flags only (`savePassword`), never the
secrets themselves. Secrets typed into dialogs live in memory for the duration
of the connection attempt.

## Auto-update security

- Updates are signed with Ed25519 (minisign-compatible). The **public key is
  compiled into the application**; the private key exists only in protected CI
  secrets (`TAURI_SIGNING_PRIVATE_KEY*`) and is never committed.
- The updater manifest `latest.json` is generated by CI **after** all platform
  builds; the pipeline fails the release if any platform artifact lacks a
  `.sig` file.
- **Anti-rollback**: the updater only applies versions strictly newer than the
  installed one, and the release pipeline does not republish older versions.
- The publish step runs in a protected `release` environment. All workflow
  actions are pinned to full commit SHAs and verified by a CI job.

## Supply chain

- `Cargo.lock` and `package-lock.json` are committed; Dependabot keeps
  dependencies fresh.
- CodeQL scans Rust and TypeScript sources; OpenSSF Scorecard publishes its
  results to code scanning.

## What the app does NOT do

- No telemetry, no analytics, no external services for core functionality.
- Network activity is limited to SSH/SFTP sessions and update checks.
- File contents are never logged; the SFTP editor (planned) will not execute
  code.
