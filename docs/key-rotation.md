# Updater signing key rotation

The update signing key is the most sensitive artifact of the project: its
public half is compiled into every distributed binary, and updates are only
accepted when they carry a valid signature. **After a release, the embedded
public key cannot simply be replaced** — clients verify signatures against the
key that was baked in at build time. Rotation is therefore a staged,
two-release procedure. Treat it as the most dangerous routine operation of the
project.

## 1. When to rotate

- The private key is compromised, or compromise is suspected.
- The private key is lost (see the recovery note in §4).
- Scheduled rotation — every 12–24 months.
- Change of maintainer / CI infrastructure.

Do not postpone a rotation because of suspected compromise.

## 2. Inventory before you start

- Private key: `~/.tauri/quartzssh.key` (maintainer machine) and the
  `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  repository secrets.
- Public key: embedded in `src-tauri/tauri.conf.json`
  (`plugins.updater.pubkey`).
- The current published release that most clients run.

## 3. Procedure (transitional release)

1. Generate a new keypair:
   `cargo tauri signer generate -w ~/.tauri/quartzssh.key.v2` (or npm tauri
   CLI). Choose a strong password; store it with the same discipline as the
   old one — outside the repository.
2. **Transitional release** (`vX.Y.Z+1`): set
   `plugins.updater.pubkey` in `tauri.conf.json` to the **new** public key
   (or to a key list, if the shipped updater version supports one), but keep
   signing this release with the **old** private key
   (`TAURI_SIGNING_PRIVATE_KEY` still points to the old key in CI).
   Result: old clients accept the transitional update (old signature), and
   after installing it, every client contains the new public key.
3. Wait for adoption: watch download/telemetry-free indicators (release
   asset downloads, issue reports). Do not proceed while a significant share
   of users is still on pre-transitional versions — those clients cannot
   verify new-key signatures.
4. **Switch release**: from the next release on, sign with the **new**
   private key (`TAURI_SIGNING_PRIVATE_KEY` secret replaced).
5. After the switch is confirmed stable: destroy the old private key
   (shred the local file, remove old CI secrets if they were kept under a
   different name) and archive this document's rotation record.

## 4. Verification checklist

- [ ] Transitional release is signed with the OLD key and contains the NEW
      public key.
- [ ] The switch release is signed with the NEW key.
- [ ] CI failed intentionally when a `.sig` was missing
      (`generate-latest-json` gate) — verified at least once.
- [ ] A test client updated: old version → transitional → next release.
- [ ] Old private key destroyed; secrets updated; backup of the NEW key
      stored in a secure vault (not in the repository).
- [ ] `docs/key-rotation.md` records the date, versions, and operator.

## 5. What must never be done

- Simply replacing `pubkey` in `tauri.conf.json` and signing the next
  release with a new key — every client on the previous release loses
  auto-updates permanently.
- Publishing a transitional release signed with the NEW key.
- Storing the private key (old or new) in the repository, in CI logs, or in
  unencrypted files inside CI workspaces.
- Postponing rotation after a suspected compromise.
- Rotating both the signing key and the update endpoint at the same time —
  one variable at a time keeps failures diagnosable.

## 6. Lost-key recovery

If the private key is lost without compromise, the procedure is the same as
§3 — but the transitional release cannot be signed with the lost key. Users
must then update manually once (download the transitional release from the
website/releases page), after which auto-updates work again. Publish a clear
release note; expect support traffic.
