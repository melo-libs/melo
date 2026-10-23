---
name: electron-e2e
description: Decide when Melo needs Electron E2E or live UI inspection, then reuse the appropriate scripts, builds, and dev sessions. Use for end-to-end regression, Playwright/CUA/CDP checks, screenshots, or duplicate-instance diagnosis. Do not use for unit tests or design decisions.
---

# Electron E2E

Choose the lightest test mode that provides credible evidence. Preserve these invariants:

- Every Electron process tree has one clear owner and cleanup path.
- Inspect existing sessions, processes, and relevant ports before launching or retrying.
- Keep at most one agent-owned interactive dev process tree; do not duplicate a usable existing instance. Isolated automated suites may own their own short-lived processes.
- Do not mutate unrelated processes or replace the user's installed app without explicit authorization.
- A visual change is not verified until the rendered UI has been inspected.

## Decide whether and when to run E2E

Do not start Electron merely because code changed or unit tests passed. First
identify the behavior that needs evidence and whether it requires the real app:

- Pure logic, copy, configuration, or a narrow component behavior: use the
  relevant unit tests and typecheck. No E2E unless a specific integration risk
  remains.
- Layout, styling, or a local interaction: inspect the affected states in a
  usable current dev instance. A visual check is not a reason to rebuild and
  launch a separate automated suite.
- A workflow crossing renderer, IPC, main process, filesystem, or native window
  lifecycle: use a focused E2E when unit/component tests cannot establish the
  behavior. This includes startup, file handoff, persistence, and update flows.
- Packaged startup, signing, installation, or release artifacts: verify the
  packaged build only when that behavior is in scope; do not substitute a dev
  check for release evidence or pull release testing into ordinary UI work.

During implementation, use targeted tests and reuse the dev session for visual
feedback. Run the relevant automated regression after the implementation and
code review have settled, not after every edit. An early E2E is appropriate
when it is the shortest way to reproduce a cross-layer bug; it must have a
specific reproduction target, not become a full-suite detour.

After a passing run, rerun only if subsequent changes affect the tested path.
Respect a user's request for code-only review or no app testing; report any
remaining verification gap instead of launching anyway.

## Reuse the entry point before creating one

Before writing automation, read `package.json` and the nearest existing
`scripts/e2e-*.mjs` implementation. Select in this order:

1. Invoke the existing script that already covers the behavior.
2. Extend the appropriate existing suite when the scenario belongs to its
   workflow; keep its process, profile, fixture, and cleanup conventions.
3. Add a dedicated script only when existing suites do not fit. Reuse any
   established harness rather than inventing a parallel launcher. Do not create
   a throwaway `.codex-*` script for each iteration or add a new framework just
   to share a few lines.

Keep session reuse separate from test isolation: interactive checks should
reuse a healthy current dev instance; automated regressions may deliberately
launch a fresh short-lived instance with an isolated profile. Never attach
unrelated automation to a suite-owned process to save a launch.

Reuse builds deliberately:

- Read the package script before invoking it: E2E entry points may already
  include a build. Do not run a separate build immediately before such an entry.
- If this task already built the current source successfully and no relevant
  main, preload, renderer, build configuration, or dependency changes followed,
  invoke the script directly (for example, `node scripts/e2e-onboarding.mjs`)
  when its package entry has no other required setup. Script-only assertion
  changes do not require rebuilding the app. Do not assume an old `out`
  directory matches the current source.
- Renderer/SCSS feedback in dev uses HMR, not a production build. Main/preload
  changes must be loaded before checking, using the existing process owner and
  restart path rather than starting another dev tree.

Before a run, briefly identify the scenario and chosen existing entry point or
dev session. If a new script, build, or process is necessary, state the concrete
gap it fills. Do not announce a full E2E run for a read-only visual inspection.

## Execute the selected mode

### Automated regression

Use the existing Playwright Electron scripts when they cover the behavior:

- `pnpm run test:e2e:single-instance`
- `pnpm run test:e2e:onboarding`
- `pnpm run test:e2e:workspace`

These package scripts build the current source before launching the built `out`; apply the build-reuse rule above instead of building twice. They use isolated profiles and temporary workspaces. Do not attach unrelated automation to their Electron process or kill it externally. On failure they preserve diagnostic artifacts; on success they clean up.

### Interactive visual verification

For a new interactive dev launch, use a persistent tmux shell so the app remains available across tool calls. Do not restart or duplicate an existing usable dev instance solely to put it under tmux. `melo-e2e` is the project default session name; tmux owns newly launched processes and their logs, while CDP, Playwright, or CUA operates and inspects the UI. The commands below assume macOS or another Unix environment with tmux and `lsof`; on other platforms, use an equivalent supervised process while preserving the same ownership and cleanup invariants.

Choose the data scope before launching:

- Use an isolated instance for tests that mutate files, settings, onboarding state, or other persisted data, and whenever repeatability depends on a known profile. Prefer the automated suites when they cover the workflow.
- For a non-mutating visual check, reuse an already-running dev instance when it is uniquely identifiable and runs the current source. Existing user data need not be relevant to reuse the window, but do not modify it or treat read-only access as permission to change files or settings.
- Use an isolated instance with representative fixtures when the test needs controlled or mutable persisted state, or no existing instance can safely serve the check. A dedicated test instance means the same development app with a temporary `MELO_USER_DATA` profile and temporary workspace, not another installed copy of Melo. Lack of a CDP endpoint alone does not require a new instance if CUA can safely inspect the existing one.
- For an isolated interactive run, create the profile and workspace with `mktemp -d`, keep their returned absolute paths in the task state, pass the profile path through `MELO_USER_DATA`, and open only the temporary workspace in Melo. This profile also isolates Melo's single-instance lock from the user's running instance.

## Preflight the interactive app

Run from the repository root. Do not launch first.

```bash
tmux has-session -t melo-e2e
```

If it exists, inspect it with `tmux capture-pane -pt melo-e2e -S -120` before deciding whether it is healthy, idle, or failed.

If the session is absent or is not clearly healthy, check the executable, expected ports, and project-scoped processes:

```bash
electron_path="$(node -p "require('electron')")"
test -x "$electron_path"
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:9223 -sTCP:LISTEN
project_root="$(git rev-parse --show-toplevel)"
ps -axo pid,ppid,lstart,command | rg -F "$project_root/node_modules/" | rg 'electron-vite|Electron \.'
```

Interpret the evidence before acting:

- A healthy `melo-e2e` session is reused. Renderer or SCSS changes normally arrive through HMR; do not restart for them.
- An idle `melo-e2e` shell is reused for the next launch.
- One project dev process outside the session is not permission to create another process in the same profile. For CDP, confirm its dev URL and automation endpoint; for read-only CUA, confirm the exact app/window identity. If neither route is usable, ask the user to close it, obtain authorization to stop its exact PID, or use an isolated profile when the test actually requires one.
- If multiple unmanaged project Electron processes remain and ownership is unclear, stop preflight. Report their exact PIDs, parent PIDs, and start times; do not launch, attach by a generic app identity, or terminate them without authorization.
- Port 9223 is the default CDP port, not a product requirement. If it is occupied, identify the owner first; then either reuse the relevant instance or choose one available port and use it consistently for that run.
- If the Electron executable is missing, repair the dependency installation before launching. Repeating `pnpm run dev` cannot fix `ENOENT`.

Never use broad `pkill` patterns against Electron; other applications share its executable and bundle identity.

## Start and reuse one tmux process

Only use this launch path after deciding a new interactive process is necessary. When `melo-e2e` is absent, create a persistent shell first. When it already exists and is idle, skip `new-session`. Then send the dev command into that shell. These commands use the project defaults; adapt the session name or CDP port only when the observed environment requires it, and keep the chosen values consistent for the run. For an isolated run, prefix the dev command with `MELO_USER_DATA=` and the literal temporary profile path returned earlier.

```bash
tmux new-session -d -s melo-e2e -c "$(git rev-parse --show-toplevel)"
tmux send-keys -t melo-e2e 'REMOTE_DEBUGGING_PORT=9223 pnpm run dev' Enter
```

`REMOTE_DEBUGGING_PORT` is supported by the project's installed `electron-vite` version and exposes the renderer to CDP.

Readiness has two stages:

1. `tmux capture-pane -pt melo-e2e -S -120` shows the renderer URL and `start electron app...` without a later fatal error.
2. `curl --fail --silent http://127.0.0.1:9223/json` returns a page target whose URL matches the Vite URL from the session, after which the target window is visibly rendered and interactive.

Forty seconds is a reasonable first readiness window, not a hard global timeout. If logs show forward progress on a slow machine, continue observing the same process; if they show failure or no progress, diagnose instead of launching again. Vite may choose a port other than 5173 when an unrelated process owns it, so use the URL printed by the session.

For an intentional restart, send `Ctrl-C` to the same session:

```bash
tmux send-keys -t melo-e2e C-c
tmux capture-pane -pt melo-e2e -S -80
```

Before sending the dev command again, verify that the project Electron child and its debug port have exited. If a child was orphaned, resolve its exact project-owned PID and terminate only that PID.

## Operate and inspect the UI

- Prefer Playwright connected over CDP for deterministic renderer interactions and assertions against the existing dev process. Do not use Playwright's Electron launcher for this interactive mode because that creates another process owner.
- Use CUA when native window state, menus, focus, or visual inspection matters. Prefer the already-running app resolved from `node -p "require('electron')"`; on macOS this executable is inside Electron.app. A generic `Electron` name or `com.github.Electron` is acceptable only when the target is unambiguous.
- Some CUA entry points launch an app when none is attached. Verify exactly one project Electron process before attaching; if attachment fails, inspect the process and port state instead of retrying with another launch.
- Give CUA attachment calls a bounded tool timeout. Treat one timeout as a failed attachment; do not retry through a generic name or bundle identity. When multiple Electron windows must coexist, prefer the isolated instance's CDP endpoint for renderer checks; native-window inspection may require the user to close the ambiguous instance first.
- Exercise the affected workflow end to end. For visual work, inspect the actual pixels rather than treating typecheck or DOM assertions as visual verification.
- Check only states relevant to the change, such as active/inactive window, light/dark appearance, resize/overflow, hover, selection, focus, disabled state, and representative narrow/wide sizes.

Store temporary screenshots under `/tmp` unless an E2E script explicitly owns another artifact location. Record what was visually checked and what was not covered.

## Stop conditions and handoff

Do not repeat the same launch against unchanged state. Retry only after identifying a cause or confirming that the prior process tree is gone. If the same failure remains, stop and report the session log, relevant ports, and exact project PIDs.

If the user needs to inspect the app, leave the single `melo-e2e` session running and say so. Otherwise:

1. Send `Ctrl-C` to `melo-e2e`.
2. Verify the project Electron child and debug port are gone.
3. Run `tmux kill-session -t melo-e2e`.

Packaged or installed builds may be tested when the task is specifically about release behavior; keep that separate from the tmux dev workflow and do not replace an installed copy without authorization.

In the handoff, report the relevant automated coverage, UI states inspected, log errors, and whether a dev session was left running. Omit checklist items that do not apply to the task.
