# Release runbook

How to cut a QuartzSSH release. The pipeline is
[`.github/workflows/release.yml`](../.github/workflows/release.yml); it is
triggered only by pushing a `v*` tag (or manually via `workflow_dispatch` for
dry runs). For key incidents during a release see
[key-rotation.md](key-rotation.md).

## Pre-tag checklist

Everything below must be true **on `main`** before tagging:

1. **CI is green on `main`**: the `ci.yml` workflow (fmt, clippy, tests,
   TypeScript, vitest, CodeQL, installer size gate) and the
   `integration.yml` SSH suite pass on the commit you are about to tag.
2. **Secrets are present** in the repository settings
   (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — Ed25519 minisign-compatible updater key
     (its public half is compiled into the app, see `tauri.conf.json`);
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`;
   - macOS signing secrets (`APPLE_CERTIFICATE*`, `APPLE_ID`,
     `APPLE_PASSWORD`, `APPLE_TEAM_ID`) — a release without them produces
     unsigned macOS artifacts, which `latest.json` generation will reject.
3. **CHANGELOG is filled**: every entry under `## [Unreleased]` corresponds
   to a commit actually merged into `main` (check with `git log`). Entries
   for open PRs must not ship.
4. **Versions are in sync** (currently `0.1.0`):
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `package.version`
   - `package.json` → `version`
   - `src-tauri/Cargo.lock` is refreshed (`cargo check` in `src-tauri`) and
     committed if `Cargo.toml` changed.
5. **Version bump commit is on `main`** before tagging — the tag must point
   at a commit where all three versions already read the release number.

## Tagging

```bash
git checkout main
git pull origin main
git tag v0.1.0
git push origin v0.1.0
```

Tag name = the release version with a `v` prefix (`v0.1.0`). To redo a tag
before anything is published: delete the draft release, delete the tag
(`git push origin :refs/tags/v0.1.0`), and tag again — **never** re-tag an
already published release (see Anti-rollback in [security.md](security.md)).

## What happens automatically

1. **`create-release`** — a GitHub Actions job creates a **draft** release
   for the tag.
2. **`build`** — a matrix builds and signs four platform bundles:
   - `windows-latest` (NSIS installer, NASM installed automatically);
   - `macos-latest` twice (`aarch64-apple-darwin` and `x86_64-apple-darwin`);
   - `ubuntu-22.04` (AppImage).
   Each bundle is signed with `TAURI_SIGNING_PRIVATE_KEY`; every
   `<installer>` gets a `<installer>.sig` sibling.
3. **`generate-latest-json`** — assembles `latest.json` from the signed
   assets. It **fails the workflow** if any of the four platforms is missing
   an installer, lacks a `.sig`, or has an empty signature: an unsigned
   update is never published. The file is uploaded to the release as the
   updater feed consumed via
   `https://github.com/Therealwh/QuartzSSH/releases/latest/download/latest.json`.
4. **`publish-release`** — flips the draft to a published release. This job
   runs in the protected `release` environment and requires the configured
   reviewer (repository owner) to approve the run in Actions first. Until
   that approval, everything stays in drafts.

## Post-release verification

1. The release page lists installers for **all four platforms**, each with a
   `.sig` file, plus `latest.json`.
2. `latest.json` contains **all four platform entries**
   (`windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`),
   each with a non-empty `signature` and a download URL.
3. The Windows NSIS installer is **≤ 20 MiB** (the same budget CI enforces).
4. **Updater end-to-end**: install the previous release, then run the new
   one — or vice versa — and confirm the app detects and applies the update
   (endpoint above, signature verified against the compiled public key).
5. Sanity-check one installer by installing and connecting to a test host.

## Rollback / incident

- **Broken release published**: do not delete the release (anti-rollback
  keeps clients from "updating backwards", and re-publishing older versions
  is not supported by the pipeline). Fix forward: prepare a patch release
  with an incremented patch version and a new tag.
- **Updater key compromise or rotation**: follow the full procedure in
  [key-rotation.md](key-rotation.md).
- **Workflow failure mid-run**: the release stays a draft; re-run the failed
  job. If the tag must move, delete the draft release and the tag, then tag
  again (pre-publish only).
