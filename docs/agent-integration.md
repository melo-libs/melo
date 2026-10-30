# Melo Agent integration

Melo owns conversations, context, memory, document state, and file operations.
Claude Code and Codex supply the execution loop through ACP. Neither provider
owns Melo's durable conversation identity.

## Code ownership

```text
Renderer
  store/agent.ts                       IPC projection, derived timeline, contextual invocation
  components/agent/AgentWindow.tsx      Floating layout, scrolling and focus
    ├─ useAgentController.ts           Loading, history, permissions, undo and provider commands
    ├─ AgentDock.tsx                   Draggable minimized status capsule
    ├─ AgentApiModelField.tsx          Shared Select, catalog loading and manual model entry
    ├─ AgentSettings.tsx               Connection drafts, eligible access selection and API setup
    ├─ useAgentAccounts.ts             Independent status queries for both tools
    ├─ AgentAccount.tsx                Account status, identity and sign-in actions
    ├─ AgentMessage.tsx                Safe Markdown replies and tool activity
    ├─ AgentModelMenu.tsx              Model/effort loading, cached options and retry
    └─ useAgentGeometry.ts              Frame-paced drag/resize and placement
  store/documentSession.ts             Latest editor content, revisions, save/undo
        │ typed IPC
Main
  ipc/agent.ts                         Validation and application composition
  agent/
    ├─ agentService.ts                 Conversation/turn/permission lifecycle
    ├─ agentTypes.ts                   Runtime contracts and execution events
    ├─ context.ts                      Selection, file reference, recent history
    ├─ runtime/                        Harness integration and process ownership
    │    ├─ runtime.ts                 ACP execution and injected tool connection
    │    ├─ harnessSession.ts          Isolated process/auth/session setup
    │    ├─ harnessProcess.ts          Prewarming, turn leases and idle process lifetime
    │    ├─ nativeAuthentication.ts    Read-only CLI status checks and classified failures
    │    ├─ nativeModels.ts            One-time preference inheritance and model discovery
    │    ├─ nativeConfiguration.ts     ACP model/effort option projection and application
    │    ├─ acpConnection.ts           Official ACP SDK over subprocess stdio
    │    ├─ runtimeEnvironment.ts      Node discovery/install and adapter entry points
    │    ├─ runtimeOutput.ts           Streaming output and credential redaction
    │    ├─ toolIdentity.ts            Adapter-provided MCP provenance
    │    ├─ apiTransport.ts            API endpoint/key boundaries and safe HTTP transport
    │    ├─ apiConnection.ts           Stateless Messages/Responses connection probes
    │    ├─ claudeAccess.ts            Claude authentication and API configuration
    │    ├─ claudeSession.ts           Claude session policy
    │    └─ codexLaunch.ts             Native account reuse and MCP isolation
    ├─ workspace/                      Melo document and file capabilities
    │    ├─ workspaceAccess.ts         Approval, scope and serialized mutations
    │    ├─ workspaceTypes.ts          Protocol-independent capability contracts
    │    ├─ documentAccess.ts          Bridge to existing renderer document sessions
    │    ├─ changeJournal.ts           Change records, backups and undo
    │    └─ editPreview.ts             Bounded diff generation
    ├─ mcp/
    │    └─ workspaceTools.ts          MCP schemas, HTTP transport and cancellation
    └─ storage/
         ├─ conversationStore.ts       App-owned SQLite history and change records
         ├─ memory.ts                  Shared user/workspace memory
         └─ agentSettings.ts           Provider settings and encrypted credentials
```

Tests live beside their modules. `ipc/agent.ts` is the composition root: it injects
runtime and workspace implementations. The service depends on Runtime contracts;
MCP calls the protocol-independent workspace contract. Workspace and storage code
do not import MCP or provider implementations. The runtime accepts the tool
connection's ACP configuration and close contract without importing its HTTP
implementation. Dependency direction is kept explicit through direct imports;
there are no barrel re-exports or legacy-path forwarding modules.

The application creates one `AgentService`. Users see one persistent Melo timeline,
including existing conversations. Workspace-scoped execution records remain internal.
Each turn owns a fresh ACP session with bounded recent context; this prevents the
harness from retaining unrelated notes indefinitely. Follow-ups keep their source
until another note is referenced. Context keeps the latest eight non-tool messages,
including cross-file exchanges with explicit source labels. A 64,000-character
budget prioritizes the current request and selection; memory and older exchanges
are truncated with an explicit marker. This is a character budget, not a tokenizer
estimate. Shared memory remains independent of the harness.
The controller owns command errors and pending state, including overlapping requests.
The window owns geometry, scrolling, and transient settings/search presentation;
it does not call conversation IPC commands or manipulate the controller's state.
Unused public list/open/create and permission-revocation commands are removed; internal
workspace execution records remain available to the service.
Hiding the floating window preserves the reading position and unsent draft.
Opening the panel prepares the selected Harness after its connection is usable.
`runtime/harnessProcess.ts` keeps one adapter process warm across successful turns;
each turn uses a fresh MCP identity and closes its session and tool server before another session can start.
Idle processes expire after five minutes. Workspace, Harness or connection changes,
application shutdown, cancellation and failed turns discard the owned process.
Session IDs fence delayed notifications and permission requests from closed sessions.
The conversation UI uses one quiet processing status across startup and generation.

`AgentTranscript`, `AgentSearch`, and `AgentComposer` render the same timeline.
SQLite keyset pagination loads older messages and search matches on demand.
FTS5 indexes history, with a substring fallback for short queries. The read-only
`melo_search_history` tool retrieves real exchanges; historical citations jump to
the referenced message. Individual messages can be deleted through their context
menu; Connection settings includes a confirmed clear-history action. Neither
operation changes workspace files or shared memory. Clearing all history also
deletes operation records and undo backups across every workspace on this device.
Previously applied file changes remain in place and can no longer be undone
through that history.

## User flow

- Open Ask Melo from the editor toolbar, a text selection, or the search palette.
- The floating window supports continuous conversation, dragging, resizing and
  minimizing to a draggable status capsule. The capsule and expanded window keep
  separate positions; dragging the capsule does not activate its expand action.
  Each question retains its quoted text and source
  in history; the composer shows only pending context. Cited workspace files
  open through the editor after a canonical-path containment check.
  Selecting another passage updates its explicit context and focuses the composer.
  Ask AI dismisses the selection toolbar; background selection changes and chat
  scrolling do not revive it. A contextual invocation also exits history search.
- Claude Code is the initial default. Users can select Codex, reuse a native
  account, or enter an API endpoint, model and key for either provider.
  Claude requires an Anthropic-compatible API; Codex uses an OpenAI
  Responses-compatible endpoint. No billing-source fallback is automatic.
- API setup tests credentials with a short request before saving. Provider
  profiles, catalog sources and endpoint/authentication policies are documented
  in [API providers](agent-api-providers.md).
  Claude API credentials use the owned subprocess's `ANTHROPIC_API_KEY` or
  `ANTHROPIC_AUTH_TOKEN` environment, not ACP gateway bearer authentication:
  the installed Claude SDK replaces that gateway token with `acp-proxy`.
  Native account configuration is left unchanged. Saved keys are bound to
  their exact canonical endpoint and API service/product, including when switching access modes.
- Native login uses the provider's CLI flow in Terminal on macOS. Melo does not
  handle the account password or copy credential files. Authentication status is
  separate from proof that a model request succeeds.
  Sign-in is checked once when the assistant first opens, then cached per provider.
  Switching providers, viewing another access tab, and reopening the window reuse
  that result. Only manual refresh or returning from a Melo-initiated login checks
  again. The check runs only the CLI status command, without an ACP session.
  One status row shows progress and results; signed-in accounts
  have no redundant sign-in action. Both tool cards have independent status;
  checking another tool never updates the selected provider profile. Identity is
  shown only when returned by the CLI. A secondary action refreshes status. Timeouts and
  unexpected CLI failures are reported rather than treated as signed-out. Raw
  CLI error payloads are never exposed.
- If Node.js 22+ is unavailable, setup offers a pinned Node.js 24.14.0 download
  from nodejs.org and verifies its published SHA-256 checksum. Both ACP adapters
  and their provider runtimes are production dependencies.
- Mutations show their destination and proposed content before approval. Stop
  cancels the current task and pending permission; completed edits remain applied.

## Document and filesystem boundary

`melo_read_document` uses the open document's current editor content, including
unsaved changes. Canonical paths resolve to an existing alias session rather than
creating a second writer. Multiple open aliases are refused until the duplicates
are closed.

`melo_edit_document` checks a SHA-256 content revision immediately before applying
its editor transaction. It also compares the disk content with the session's
saved baseline; equal mtimes do not prove equal content. Edits preserve existing
metadata, use the normal save owner, and retain undo history. A stale edit fails
and must be based on a fresh read.

Other tools list all file types, search the existing Markdown index, create
Markdown notes/folders, move/rename individual files, and move files to the
system Trash. Mutations are serialized across conversations. Moves prepare and
flush the owning session, keep it intact on failure, and close affected text or
viewer tabs only after success. Directory moves and permanent deletion are not
exposed. Existing filesystem watchers update the tree and index.

Paths must remain inside the active workspace and outside hidden directories.
The MCP endpoint has a random server name, an ephemeral loopback port and a
per-runtime bearer token. It rejects browser Origins, unexpected Hosts,
unauthenticated requests and oversized payloads. A path or display title is not
a tool identity: automatic MCP approval requires adapter-provided provenance,
the owned server name and an exact tool allowlist. Claude reports ACP-supplied
HTTP/stdio servers as `dynamic` and in-process ones as `sdk`; only the fresh
Melo server in its strict MCP configuration is automatically approved.

Claude has only native read/search/web tools, no native write or shell tools,
strict MCP configuration, no settings sources, disabled hooks and disabled
native memory. Codex runs read-only with shell/patch features disabled. Its
launch disables inherited hooks, plugins, apps and native memory, and disables
pre-existing MCP servers before adding Melo's randomly named server. Native
write/execute permission requests are refused; approved mutations go through
Melo. Provider safety checks for native reads are still shown to the user.

Workspace contents and memory are context, not trusted instructions. These
policies constrain execution; a system prompt alone is not the write boundary.

## Persistence and lifecycle

Under the application's `agent/` data directory:

- `conversations.db`: conversations, streaming message checkpoints, and file-change records.
- `settings.json`: separate Claude/Codex profiles; API keys encrypted with
  Electron `safeStorage`. Insecure Linux `basic_text` storage is refused.
- `memory.md`: explicit user preferences shared by every provider.
- `change-backups/`: private document snapshots and copies used to restore trashed files.
- `runtime/`: an optional managed Node.js runtime.

Workspace memory is `.melo/memory.md`. Both scopes use the same service and MCP
revision checks. Memory updates require explicit approval. Writes use a private
staging file, sync its contents, and atomically replace the destination; failed
replacements retain the previous memory and clean up the staging file. Symlinks
and hard links are rejected before memory content is read or written. Harness-specific
automatic memory is disabled rather than synchronized after the fact.

Streaming view snapshots are coalesced over 32 ms before cloning and IPC.
Approvals, completion and cancellation flush immediately. SQLite checkpoints
write only changed messages, retaining the existing 250 ms checkpoint interval.
Message timestamps remain stable across plan updates so reloading preserves order.
On database startup, legacy approvals are migrated to structured operations,
interrupted tool calls are marked failed and pending approvals
are marked expired across the entire timeline before history is paged or displayed.

`ipc/agent.ts` composes `workspace/workspaceAccess.ts` with the
`mcp/workspaceTools.ts` transport. Business
operations validate paths and revisions independently of HTTP or ACP, and can
be tested without starting a server. The MCP transport binds each request to an
AbortSignal, routes authenticated cancellation notifications to the originating
request ID, and aborts disconnected calls. Pending approvals expire on cancellation;
queued mutations recheck the signal before entering the write operation. Already
started, approved writes drain and report their completed change.

Suspension has separate workspace, window and configuration scopes. An index
refresh cannot release a window-close suspension. Before window close, the app
stops new Agent mutations, cancels/drains owned runtimes, then invokes the
existing renderer flush protocol. Canceling close restores only its own scope.
Startup cancellation reaches partially-created subprocesses as well as tool
servers. ACP teardown owns the whole Unix process group.

## Approvals, progress, and undo

ACP plan updates are rendered directly as a step list when the harness supplies
one. Tool activity and file-change summaries come from execution events, not
from claims in the assistant reply. The composer has separate harness and model
selectors; API model changes remain in Connection settings. Native model and
reasoning choices come from ACP `configOptions`; only advertised selectors are
shown, using the shared Select component. A model switch consumes the complete
replacement option list so reasoning levels match the selected model.

Native preferences are global within Melo and independent for each harness.
`runtime/nativeModels.ts` discovers options in a short-lived, prompt-free session
with a neutral cwd and no Melo tools. First discovery inherits only model/effort
preferences automatically on first use, then snapshots the effective values and
their display labels in Melo's settings. The harness resolves
global defaults and per-model effort in the neutral directory; Melo projects
only the advertised model and thought-level selectors, without parsing CLI
configuration or copying its other settings. Subsequent CLI changes do not
replace this snapshot.

`runtime/harnessSession.ts` owns subprocess environment, authentication, session
creation and cancellation for both discovery and real turns. It applies Melo's
model/reasoning snapshot through per-process overrides and ACP session settings,
never a CLI configuration write or a process-wide environment change. Window
and workspace suspension cancel and drain model discovery alongside active turns. Turn
creation captures its configuration; menu changes affect the next turn. API
profiles and encrypted credentials remain separate from native preferences.

Users can approve one action or workspace-file changes for the current execution.
That grant expires when the execution finishes or is canceled. It does not extend
to later turns in the continuous timeline. Memory updates and native-tool requests
still require their own approval.

`shared/agentCapabilities.ts` defines tool IDs, read-only classification, structured
operation payloads, and per-operation approval policy. MCP registration, provenance
validation, activity rendering, and approval controls share those definitions.
Operation kinds and paths are independent of localized display labels; previews
no longer encode paths and content in newline-delimited display strings.

Approval cards are persisted as timeline records with an explicit pending,
allowed, declined, or expired state. Interrupted requests remain visible and
cannot be approved after their tool call ends. Permission granted does not mean
a change was applied; the change summary reports completed mutations.
Edit previews use jsdiff with three context lines and a bounded computation time.
The document revision is checked before review and again before applying the edit.
Claude and the owned Codex MCP server use a 30-minute tool deadline for human
review. A timeout or cancellation leaves an expired confirmation record.
Reopening a hidden window keeps a live approval. A failed approval checkpoint
rejects that request and expires its card without poisoning the queue for later
requests.

`ChangeJournal` stores private undo records in the conversation database and
keeps previous document content or trashed-file copies in
`userData/agent/change-backups`. The renderer receives file metadata only.
Backups remain until their change is undone; undo removes the corresponding
backup. File mutations and undo share the same workspace write queue. Paths
are recorded canonically and checked again on undo. Document edits use the
existing document session and revision checks, including unsaved content.

Change summaries retain their conversation/workspace ownership even when a
question is deleted or a history page starts mid-turn. Historical changes from
another workspace can be read, but undo is disabled until that workspace is active.
Each change can be undone; Undo all applies inverses in reverse execution order.
It stops at a conflict and keeps earlier successful reversals visible. This is
not an atomic filesystem transaction. Undo refuses changed file content,
nonempty created folders, and occupied restore destinations. Restoring a
trashed file copies the private backup to its original path; it does not remove
the OS Trash entry. An interrupted `prepared` journal entry is retained for
recovery and is never offered as a completed, undoable change.

## Dependencies and distribution

| Dependency                              | Version |
| --------------------------------------- | ------- |
| `@agentclientprotocol/sdk`              | 2.0.2   |
| `@modelcontextprotocol/sdk`             | 1.28.0  |
| `@agentclientprotocol/claude-agent-acp` | 0.95.0  |
| `@agentclientprotocol/codex-acp`        | 2.2.2   |

The pnpm patch for Codex ACP preserves host-supplied MCP configuration when the
adapter adds the client's servers. Without it, session creation drops the
disabled entries. It also reports authentication failures as ACP auth-required
instead of automatically logging out the shared native account.
`codexAuthenticationPolicy.test.ts` verifies that error path without starting
Codex or reading credentials. `codexPolicy.test.ts` verifies the MCP boundary against the real
adapter and an isolated Codex home, with a local API fixture and no model call.
Run it with `MELO_CODEX_POLICY_CHECK=1` before upgrading this dependency.

Electron 31's main build bundles the ESM-only ACP SDK. External Node runs the
adapters; it cannot read asar, so production dependencies and launch resources
are unpacked. The Codex launcher is executable and forwards stdio directly;
there is no shell interpolation. Windows process ownership and interactive
login are not supported by this implementation. Packaged installation needs
release validation; development E2E is not evidence for a signed release.

## Verification

```sh
pnpm run lint
pnpm run typecheck
pnpm test
node scripts/check-agent-build.mjs
pnpm run test:e2e:agent
```

The default tests do not call models or use a developer's account. The focused
Agent E2E owns an isolated profile and workspace. To include a real authorized
Codex turn after building:

```sh
CODEX_HOME="$MELO_TEST_CODEX_HOME" MELO_AGENT_LIVE=1 node scripts/e2e-agent.mjs
```

It verifies setup, contextual invocation, composer focus/draft retention,
dragging, position retention, API validation/save, Markdown replies, search
handoff, execution-scoped approval, file-change summaries, reverse-order undo,
editor/disk synchronization and history.
`MELO_E2E_NATIVE_MODELS=1` adds native Codex model/effort menu switching and
narrow-panel checks, without a model turn. `MELO_NATIVE_MODELS_CHECK=1` enables
the real ACP capability/persistence test and verifies the CLI config is unchanged.
`MELO_CODEX_LIVE=1` separately enables the ACP/MCP fixture integration test.
`MELO_CLAUDE_API_CHECK=1 pnpm run test:main` additionally runs the installed
Claude adapter against local Anthropic API fixtures for every service profile. It
verifies real API key/bearer requests without using an account or remote model.
`MELO_CODEX_API_CHECK=1 pnpm run test:main` runs the installed Codex adapter against
local Responses fixtures, including two successive MCP turns and native-setting isolation.
`claudeIntegration.test.ts` supports optional native/live MCP checks through
`MELO_AGENT_NODE` and `MELO_CLAUDE_ACP_ENTRY`. Acknowledgement alone is not
connection verification. Runtime transcripts redact configured credentials,
including keys split across streaming chunks.

Current limits: Markdown-only full-text search and document editing; other
files can be listed and organized, with native read support depending on the
provider. Smart Folder editing and automatic link rewriting after rename are
not Agent tools in this version. Undo is a Melo control, not a harness tool.
New harness sessions receive the bounded context described above; the durable
database retains the complete history.

The original architecture record remains in
[Discussion #28](https://github.com/melo-libs/melo/discussions/28).

References: [ACP SDK](https://github.com/agentclientprotocol/typescript-sdk),
[Claude ACP](https://github.com/agentclientprotocol/claude-agent-acp),
[Codex ACP](https://github.com/agentclientprotocol/codex-acp),
[Claude environment variables](https://code.claude.com/docs/en/env-vars).

Native-account integration tests require `CODEX_HOME` to resolve inside the
system temporary directory, using a dedicated test login. Never copy developer
credentials into that directory. Native E2E and capability checks reject the
normal user directory before starting an adapter.
The opt-in Claude adapter integration likewise requires a temporary
`CLAUDE_CONFIG_DIR`, including when using an API endpoint.
The default Agent E2E creates empty Claude and Codex directories under its test
root and uses a local API fixture, independently of developer logins.

Connection settings use tool cards and the shared Radix segmented control.
Harness and usable connection choices persist immediately. Viewing an unsigned,
checking or failed native account does not replace an active API connection.
After logging in from that preview, users explicitly choose to use the account.
An incomplete API draft activates only after connection validation succeeds.
Slow connection writes are serialized and coalesced to the latest selection;
the tabs and API fields remain editable while they finish. API connection actions stay in their
section. Settings navigation uses the header back arrow, without a fixed save
footer. History clearing uses a red shared button and an anchored Radix Popover
with confirmation, cancellation and retryable failure feedback.

Tool cards describe the saved active connection, independently of the tab being
viewed. Native mode uses the CLI's
account status; API mode shows “API configured” only for a saved key, endpoint
and model, otherwise “Setup required.” Both saved profiles are projected as
non-secret status metadata, so an inactive API tool is not mislabeled by its
unrelated native account. “Configured” does not claim a fresh network check.

Connection settings live in the Harness selector's footer. Saved model and reasoning
choices display immediately after restart, independently of the candidate catalog.
Opening either menu refreshes the catalog; there is no background catalog refresh.
The shared Select keeps the saved choice visible during loading or a failure.
Loading and retry states live inside the popup; triggers keep their value and icon,
and cached candidates remain hidden until the refresh completes.
Catalog loading does not block typing or sending with an existing configuration.
Requests, results and discovery queues are scoped by Harness. Background metadata
does not advance foreground connection generations or replace an active connection;
late catalog responses remain available after navigating away and back, provided
they have not been superseded by a newer model choice. Refreshing candidates does
not persist preferences; only initial inheritance and explicit changes do.
First-use inheritance shows loading until the effective default has been saved.
Failures remain in the menu with a retry action. Model settings help
uses Radix Tooltip at the menu heading rather than a permanent footer paragraph.
