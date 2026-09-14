# Dependency patches

## `@parcel/watcher`

`@parcel/watcher` publishes N-API binaries as platform-specific optional
dependencies. They already work with Electron and should not be rebuilt by
`@electron/rebuild`.

The patch removes the package's `binding.gyp` so electron-builder leaves those
prebuilt binaries intact. `pnpm.supportedArchitectures` installs both x64 and
arm64 optional dependencies for the current operating system, matching Melo's
macOS release targets.

When upgrading `@parcel/watcher`, regenerate or remove the patch and verify:

- both target architecture packages are installed;
- the packaged app contains the matching `watcher.node` outside `app.asar`;
- the workspace watcher E2E test passes from the packaged app.
