---
name: electron-e2e
description: Run Melo Electron E2E and live UI checks with clear process ownership. Use for Playwright suites, tmux-managed dev inspection, CUA/CDP automation, screenshots, or duplicate-instance diagnosis. Do not use for unit tests or design decisions.
---

# Electron E2E

Choose the lightest test mode that provides credible evidence. Preserve these invariants:

- Every Electron process tree has one clear owner and cleanup path.
- Inspect existing sessions, processes, and relevant ports before launching or retrying.
- Keep at most one interactive dev process tree. Isolated automated suites may own their own short-lived processes.
- Do not mutate unrelated processes or replace the user's installed app without explicit authorization.
- A visual change is not verified until the rendered UI has been inspected.

## Choose the mode

### Automated regression

Use the existing Playwright Electron scripts when they cover the behavior:

- `pnpm run test:e2e:single-instance`
- `pnpm run test:e2e:workspace`

Both package scripts build the current source before launching the built `out`. They use isolated profiles and temporary workspaces. Do not attach unrelated automation to their Electron process or kill it externally. On failure they preserve diagnostic artifacts; on success they clean up.

### Interactive visual verification

Use a persistent tmux shell when the dev app must remain available across tool calls. `melo-e2e` is the project default session name; tmux owns the process and logs, while CDP, Playwright, or CUA operates and inspects the UI. The commands below assume macOS or another Unix environment with tmux and `lsof`; on other platforms, use an equivalent supervised process while preserving the same ownership and cleanup invariants.

Choose the data scope before launching:

- Tests that create, edit, move, or delete files use a temporary `MELO_USER_DATA` profile and a temporary workspace. Prefer the automated suites when they cover the workflow.
- A non-mutating visual check may reuse the real profile when existing user state is relevant. Do not turn that access into permission to modify real workspace files.
- For an isolated interactive run, create the profile and workspace with `mktemp -d`, keep their returned absolute paths in the task state, pass the profile path through `MELO_USER_DATA`, and open only the temporary workspace in Melo.

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
ps -axo pid,ppid,command | rg -F "$project_root/node_modules/" | rg 'electron-vite|Electron \.'
```

Interpret the evidence before acting:

- A healthy `melo-e2e` session is reused. Renderer or SCSS changes normally arrive through HMR; do not restart for them.
- An idle `melo-e2e` shell is reused for the next launch.
- A project dev process outside the session is not permission to create another one. Reuse it, or resolve and stop only its exact PIDs before a deliberate restart.
- Port 9223 is the default CDP port, not a product requirement. If it is occupied, identify the owner first; then either reuse the relevant instance or choose one available port and use it consistently for that run.
- If the Electron executable is missing, repair the dependency installation before launching. Repeating `pnpm run dev` cannot fix `ENOENT`.

Never use broad `pkill` patterns against Electron; other applications share its executable and bundle identity.

## Start and reuse one tmux process

When `melo-e2e` is absent, create a persistent shell first. When it already exists and is idle, skip `new-session`. Then send the dev command into that shell. These commands use the project defaults; adapt the session name or CDP port only when the observed environment requires it, and keep the chosen values consistent for the run. For an isolated run, prefix the dev command with `MELO_USER_DATA=` and the literal temporary profile path returned earlier.

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
