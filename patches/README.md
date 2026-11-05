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

## `@agentclientprotocol/codex-acp@2.2.2`

Three existing workarounds remain; native permission profiles and permission
metadata patches have been removed. Claude ACP is used without a patch.

- Preserve process-supplied MCP configuration when adding task servers. Otherwise
  the adapter replaces disabled inherited server entries and drops the timeout
  reserved under Melo's process-owned server name. Remove when the public
  configuration path preserves those entries; verify with `codexPolicy.test.ts`.
- Disable adapter-generated conversation titles in Melo-owned processes. Melo owns
  its titles; the extra request can use an unselected model. Remove when a public
  opt-out is available and verify no extra model request occurs.
- Report authentication errors without calling logout. The upstream adapter can
  revoke the user's shared account based on error text. Remove only when upstream
  error handling no longer logs out automatically, verified with an isolated account.

These are temporary integration exceptions, not extension points for Melo policy.
The runtime keeps the configuration name stable within a process, while each task
gets its own URL, bearer and operations. `codexApiIntegration.test.ts` verifies two
successive tasks; enable `MELO_CODEX_TIMEOUT_CHECK=1` with `MELO_CODEX_API_CHECK=1`
to include a 65-second MCP wait beyond Codex's default deadline.
