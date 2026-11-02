# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| latest release | yes |
| older releases | no — please update |

## Reporting a vulnerability

If you discover a security vulnerability in QuartzSSH, please **do not open a
public issue**. Instead:

1. Go to the repository → **Security** → **Report a vulnerability** (private
   vulnerability reporting), or contact the maintainer privately if that is
   unavailable.
2. Include a description, reproduction steps, affected version and your
   assessment of the impact.

You will receive a response within 7 days. We will keep you informed about the
fix progress and credit you in the changelog if you wish.

## Security architecture highlights

- **Host key verification** is strict by default: known keys are trusted, new
  keys require explicit confirmation, changed keys are rejected with a
  diagnostic dialog showing both fingerprints (protection against MITM).
- **Credentials** (passwords, key passphrases) are stored only in the operating
  system credential store — never in config files on disk.
- **Algorithms**: SHA-1 based key exchange and signatures (`ssh-rsa`,
  `diffie-hellman-group1-sha1`), `arcfour` and `3des-cbc` are disabled by
  default. Post-quantum hybrid `mlkem768x25519-sha256` is preferred when the
  server supports it.
- **Auto-updates** are signed with Ed25519 (minisign). The public key is
  compiled into the application; the update manifest `latest.json` is validated
  against it, and versions lower than or equal to the current one are never
  applied (anti-rollback). The signing private key lives only in protected CI
  secrets.
- **Supply chain**: all GitHub Actions are pinned to full commit SHAs,
  dependencies are updated by Dependabot, and releases are built by a
  gated pipeline with an `release` environment.

## Scope notes

The SFTP remote code editor (planned) does not execute code — it edits text
only. No telemetry is collected; the application talks to the network only for
SSH/SFTP sessions and update checks.
