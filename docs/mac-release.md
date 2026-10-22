# macOS releases

Release builds use a fixed self-signed certificate with electron-updater / Squirrel.Mac.
This is not an Apple Developer ID certificate and does not provide notarization. macOS may still require approval in Privacy & Security on first launch.

## Signing credentials

Default directory: `~/Library/Application Support/Melo Release Signing/`.

- `melo.keychain-db`: Dedicated signing Keychain.
- `password`: Keychain password, readable only by the current user.
- `certificate.p12`: Encrypted certificate and private-key backup.
- `certificate.pem`: Public certificate.

Pinned SHA-1 fingerprint: `125C912085E6A07277A8F679B26F8628D6826E09`.
Future releases must use the same certificate. Keep a separate backup of the encrypted P12 and its password; never commit them to Git or upload them as release assets.

On another Mac, import the same P12 and set `MELO_MAC_SIGNING_KEYCHAIN` to the dedicated Keychain path.
Use `MELO_MAC_SIGNING_PASSWORD_FILE` to specify a password file, or unlock the Keychain manually before building.
The build does not change system trust settings. Any Keychain search-list entry added temporarily is removed when the build finishes.

## Build a candidate

Update the version in `package.json`, prepare `docs/releases/<version>.md`, then run:

```sh
pnpm run build:mac
```

This runs lint, typechecks, and tests, then compiles once into an isolated temporary directory without overwriting the development app's `out` directory.
Artifacts are written to `dist/macos-<version>/`: arm64 and x64 DMGs, ZIPs, blockmaps, and an update feed.
Existing candidate directories are never overwritten. Save or move an earlier candidate before rebuilding.

The script verifies each ZIP's app signature, version, and update source; compares every compiled file; validates the DMGs and update-feed sizes and SHA-512 checksums; and writes `verified-release.json`.
Signed builds enable native updates in the app manifest. A missing certificate or mismatched signature fails the build.

Use `pnpm run build:mac:unsigned` for CI or local checks without a certificate. These ad-hoc-signed builds do not enable native updates and cannot be uploaded through the release command.

## Verify and upload

Run the existing startup checks with isolated profiles, without installing into Applications:

```sh
node scripts/e2e-packaged-startup.mjs arm64 dist/macos-<version>/mac-arm64/Melo.app
node scripts/e2e-packaged-startup.mjs x64 dist/macos-<version>/mac/Melo.app
```

After installation testing, run `pnpm run deploy:mac`. It rechecks the existing candidate without recompiling and creates a **GitHub Draft Release**, not a public release.
Before uploading, confirm that the PR is merged and CI is green. Review the draft's tag, target, and release notes before publishing manually.
The DMGs, ZIPs, blockmaps, and `latest-mac.yml` must come from the same build. Never mix update feeds from different candidates.

Users on ad-hoc-signed 2.0.1 or earlier must install the new app manually once. Subsequent releases signed with the same fixed certificate can then be installed by restarting Melo from the update window.
