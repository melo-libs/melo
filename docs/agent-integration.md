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
    ├─ AgentEntry.tsx                  Persistent mascot and collision-aware status bubbles
    ├─ AgentApiModelField.tsx          Shared Select, catalog loading and manual model entry
    ├─ AgentSettings.tsx               Connection drafts, eligible access selection and API setup
    ├─ useAgentAccounts.ts             Independent status queries for both tools
    ├─ AgentAccount.tsx                Account status, identity and sign-in actions
    ├─ AgentMessage.tsx                Safe Markdown replies and tool activity
    ├─ AgentAttachments.tsx            Pending and sent file references
    ├─ AgentReceipt.tsx                Inbox receiving progress, separate from AI changes
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
    │    ├─ executionInstructions.ts   Native analysis and Melo MCP routing instructions
    │    ├─ claudeSession.ts           Claude session policy
    │    └─ codexLaunch.ts             Native account reuse and MCP isolation
    ├─ workspace/                      Melo document and file capabilities
    │    ├─ workspaceAccess.ts         Approval, scope and serialized mutations
    │    ├─ workspaceTypes.ts          Protocol-independent capability contracts
    │    ├─ documentAccess.ts          Bridge to existing renderer document sessions
    │    ├─ changeJournal.ts           Change records, backups and undo
    │    ├─ editPreview.ts             Bounded diff generation
    │    └─ fileOrganization.ts        Agreed file destinations and journaled execution
    ├─ mcp/
    │    └─ workspaceTools.ts          MCP schemas, HTTP transport and cancellation
    └─ storage/
         ├─ conversationStore.ts       App-owned SQLite history and change records
         ├─ memory.ts                  Shared user/workspace memory
         ├─ fileIntake.ts              Draft snapshots and stable imported-file identity
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
harness from retaining unrelated notes indefinitely. Every send snapshots the active
workspace file independently of explicit quotes and attachments; switching tabs while
chat remains open takes effect on the next send. No active saved file is represented
explicitly, so history cannot masquerade as the current editor file. Context keeps
the latest eight non-tool messages,
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
each turn uses a fresh MCP endpoint/token and closes its session and tool server
before another session can start. The MCP configuration name stays stable within
the owned process so session transports inherit its timeout.
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

- Open Ask Melo from the persistent mascot, a text selection, or the search palette.
- In the search palette, Ask Melo or `⌘Enter` carries the query into the existing
  conversation as an unsent draft. Existing text and explicit quotes are retained;
  highlighting a search result does not replace the active document context.
- The floating window supports continuous conversation, dragging, resizing and
  closing back to a draggable 48px mascot without stopping the active turn.
  The mascot and expanded window keep separate positions; the mascot's position
  survives restarts. A lightweight placement rule keeps it inside safe margins and
  moves it to the nearest free position around fixed controls marked with
  `data-floating-obstacle`. Temporary avoidance and viewport clamping do not replace
  the saved preference. Layout changes and drag release recalculate placement;
  scrolling and streamed messages do not. Dragging does not open the conversation. Every send follows
  the active document automatically, without a file-reference chip. Explicit quotes
  and attachments retain their own sources when tabs change. File boundaries appear
  in history only after sending and only when the source changes.
  Short status bubbles disappear after three seconds, except pending approvals.
  Hover or keyboard focus reveals details. Replies received while collapsed keep
  an unread expression until opened; cancellation and history loading do not.
  Each question retains its quoted text and source
  in history; the composer shows only pending context. Cited workspace files
  open through the editor after a canonical-path containment check.
  Selecting another passage updates its explicit context and focuses the composer
  without moving or resizing an already expanded window. Selection anchors apply
  only when opening from the collapsed state.
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

## Pasted files

Pasting or dropping into the composer snapshots native files or a screenshot under
the application's private `agent/intake/` directory. Drafts are workspace-scoped,
survive restart, and do not yet appear in the workspace. Removing a draft deletes
only Melo's snapshot. Plain text keeps the normal composer paste behavior.

Sending imports copies into the current workspace's `Inbox/` before starting
inference. Originals stay untouched. A same-volume `.melo/intake/` staging copy
is published with an exclusive hard link, then both staging copies are removed.
The journal records the payload fingerprint and inode before publication so a
retry can recover its own copy without overwriting a user's same-name file.
Conflicts receive a numbered filename. Canceled or failed turns keep completed
imports in Inbox; unimported drafts remain available for retry or removal.

After receipt, the Harness receives stable file IDs and current workspace paths.
It reads ordinary attachments using its native readers, shell, or parsing tools.
Melo does not extract their content or inject it before inference. The local
preview is presentation only, not evidence that the model understood a file.
Markdown reads still use `melo_read_document` for the latest editor content.

`melo_resolve_attachment` returns only the current path, original name, and size
of an imported attachment. It validates the saved file's location without parsing
its content. The Harness uses this metadata when a historical path may have
changed, then reads the saved file itself. Unsupported or failed native reads
must produce an honest unread reason and keep the file in Inbox. There is no
local read-tracking boolean that can veto successful native inspection.

The Harness distinguishes content it read, user-provided descriptions, and unread
files when explaining recommendations. Future built-in parsers should address
measured reliability or cost gaps and expose results through MCP; OCR and Office
parsing remain deferred.

Inbox receipt is a dedicated persisted timeline record, not a file-change card.
It shows receiving/stored/failed/cancelled states and completes before the Harness
starts. Restart marks interrupted receipt items cancelled, preserving completed
copies. Import journaling remains internal for exclusive publication and retry;
receipt creates no public undo actions. Only applied filing changes offer undo,
which returns copied files to Inbox instead of deleting the received files.

The composer uses the shared `ui/FileThumbnail` cell for images, documents and
fallback paper assets.
`main/libs/fileThumbnail.ts` reads an authorized file handle, decodes small images
locally, and uses macOS Quick Look for document covers, HEIC and video thumbnails.
Quick Look gets an owned temporary snapshot with the original extension, never an
external user path. Generation has a timeout, bounded output, a small deduplicated
memory cache and unconditional temporary-file cleanup. Unsupported previews use
the folded-paper fallback. This is local preview generation, not PDF/OCR parsing
or additional model input. The composer accepts native file drops and workspace
tree copies.
Preview support is separate from model readability; an image thumbnail does not
prove the selected model can inspect its content.

File organization is conversational: the Harness reads the files and workspace,
explains destinations, renames and a short rationale, then ends its turn. A follow-up
question explains or revises that recommendation; it does not cancel a pending call
or imply approval. Only after explicit agreement does the Harness call
`melo_organize_files`. The tool executes immediately without a second approval UI.
There is no pending filing plan, approval timer, folder-picker state or suspended
MCP call between messages. Recent dialogue carries the recommendation; recorded
receipts, filing outcomes and undo status enter subsequent context separately from
model text. Historical organization approval records remain read-only and are
labeled as proposals rather than proof of execution.

The execution request contains stable attachment IDs, reading status and agreed
workspace-relative destinations. Unread files stay in place. Original filenames
and extensions are preserved unless a rename was agreed. Verified dates, authors
and useful identifying facts belong in the conversation, not a tool's UI payload.
Note updates use the separate versioned document tool and its confirmation flow.

WorkspaceAccess serializes filing with other mutations. Before creating folders
or moving files, it validates the whole request for duplicate destinations,
extensions, conflicts, path containment, symlinks and source fingerprints. Each
move uses the document-session owner and existing journal; partial failures retain
undoable changes. A no-op produces no filing receipt. Conversational consent is
interpreted by the trusted Harness; it is not a host-enforced authorization token.
Deletion, editing and other MCP approvals retain their existing controls.

Other approval-bearing MCP calls still have a 30-minute Harness deadline. Codex
reserves the configuration name and timeout during prewarming, then each task
supplies a fresh URL and bearer. The existing MCP merge workaround preserves that
timeout and disabled inherited servers. Task endpoints are never reassigned.
Cancellation closes the task server and expires its pending approvals.

`melo_resolve_attachment` resolves a stable UUID to an
imported file in the same workspace; it cannot resolve draft snapshots or arbitrary
external paths. Attachment buttons resolve that UUID again when opened, so
Melo-managed moves and their undo keep references usable. External moves are not
tracked. Latest unsaved Markdown still comes from `melo_read_document`.

Undoing a filing move returns the copy to Inbox. The import journal remains private to receipt/recovery, and is not included in
filing undo. Fingerprint and revision checks reject modified or replaced files. Clearing history removes undo records,
but retains imported files and attachment identity. Intake metadata lives in its
own table in `conversations.db`, independently of conversation deletion.

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

### Tags and Smart Folders

`melo_read_tags` reads the workspace tag vocabulary and, optionally, one Markdown
document's current tags and revision. `melo_update_tags` adds/removes tags through
the document session, preserving the body, other YAML fields, and unsaved editor
content. Metadata-only writes use the same save owner, approval, and change journal
as document edits. Failed saves restore the previous metadata; stale edits and
undo attempts cannot overwrite newer content. Tags are stored in Markdown
frontmatter, not in a separate attachment database.

The editor shows saved Markdown tags above the body. Tag links open the existing
search palette with an exact tag filter, including multi-word and Unicode labels.
With no tags, the entry appears only near the first content block on hover or
keyboard focus. The empty entry floats in the existing page inset without reserving
a row, including while typing the first tag. Once a tag is added it becomes a
normal metadata row. With tags, the trailing
add control is a quiet plus. The document menu, search command, and tag row activate
the same inline editor. Suggestions
reuse workspace tags and usage counts. Each addition or removal saves immediately;
Escape or outside focus ends editing. Tag undo/redo stays local to the tag editor.
Manual tag edits share
document-session revision checks and saving with Agent changes, while retaining
normal editor file-size support. Displayed metadata follows the owning session,
so Agent edits, undo, tab changes, and external reloads update the tag row without
replacing the Tiptap document. Writes are serialized and revision checked; a failed
write rolls back queued edits with a visible error. External metadata changes reset
tag undo history so an old undo cannot overwrite another writer.

`melo_read_smart_folders` exposes current definitions, their revision, and the
supported rule vocabulary. The Agent previews matching files with
`melo_preview_smart_folder` before proposing `melo_save_smart_folder`. Saving creates
or updates a view; it does not move files. Manual and Agent changes share the same
rule definitions and revision-checked storage. The journal supports undo until a
newer configuration replaces that revision.

App-owned changes notify the renderer to refresh Smart Folders and counts. A
builder draft keeps its opening revision, so an intervening Agent edit produces a
conflict instead of silently overwriting it. Existing incomplete filters remain
editable. This notification path does not implement external-file or device sync.

Paths must remain inside the active workspace and outside hidden directories.
The MCP endpoint has a random server name, an ephemeral loopback port and a
per-runtime bearer token. It rejects browser Origins, unexpected Hosts,
unauthenticated requests and oversized payloads. A path or display title is not
a tool identity: automatic MCP approval requires adapter-provided provenance,
the owned server name and an exact tool allowlist. Claude reports ACP-supplied
HTTP/stdio servers as `dynamic` and in-process ones as `sdk`; only the fresh
Melo server in its strict MCP configuration is automatically approved.

Melo trusts the Harness to execute the user's task. Both the process cwd and
session cwd point to the real workspace. A private temporary directory holds
parser output and other intermediates across fresh turn sessions. It is removed
after the owned process stops; it is an artifact lifetime, not a security boundary.

Claude uses its original ACP adapter, native tools, strict MCP configuration,
no settings sources and no sandbox. Before a task runs, Melo selects
`bypassPermissions` through ACP `session/set_config_option`. Codex uses the native
`agent-full-access` mode and process-local `danger-full-access`/`never` configuration.
Neither changes the user's saved permission settings. Melo does not maintain a
second resource-grant cache or inject permission metadata into either adapter.
A native approval request that still reaches Melo requires a user decision; it
is never automatically accepted just because the Harness uses a broad mode.
Only an offered one-time option is selected, and cancellation/inactive tasks deny it.

`runtime/executionInstructions.ts` directs native analysis to temporary storage and
application operations to Melo MCP. MCP owns business confirmation, revision checks,
operation records and undo. These checks still execute inside the MCP tools even
when the Harness itself needs no permission prompt. Routing workspace changes to
Melo MCP is an agent instruction, not an enforced filesystem restriction: native
shell or file-tool writes can bypass that route and do not receive Melo undo records.

Inherited hooks, plugins, apps, native memory and foreign MCP servers stay disabled.
Codex shell subprocesses exclude model keys and launch configuration from their
environment. This reduces accidental exposure; broad execution is not a credential
sandbox. The host does not write native configuration files or automatically log
out a shared native account.

Completed access decisions and raw tool activity share one collapsed “Processing
details” entry per turn. Its label does not infer task success or failure from
individual attempts. Expanding shows structured ACP activity kinds and file targets;
raw commands and resolved native permissions remain available on demand. Activity
metadata is persisted independently of permissions.

Use Melo MCP for existing application capabilities, including Markdown reads
and writes, workspace discovery/search, managed file changes, history, and
Memory. Native tools handle ordinary attachments and capabilities outside that
surface. A failed or declined Melo operation is not permission to bypass it.
Routing is product guidance, not an OS-enforced guarantee that arbitrary native
commands cannot change files. Native user-approved actions are not covered by
Melo's managed change journal or undo. Workspace and web contents remain
untrusted task data. No separate execution MCP or `melo-cli` is added here.

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
Harness tool deadlines still apply while waiting for human review (see the
MCP lifecycle above). A timeout or cancellation leaves an expired
confirmation record.
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
Ordinary changes use a collapsed result line with undo (or restore for trash).
A single change has one action; multiple changes also offer individual actions
inside the details. Each confirmed filing
has a persisted batch ID and an independent timeline marker. Journal entries
carry that ID, including created folders; Inbox imports
are excluded. Filing receipts are read-only details with one batch undo action.
The renderer sends only the batch ID, and the main process loads every applied
entry for that batch within its conversation and workspace. It rejects attempts
to undo batch-owned entries through the ordinary per-change command.

History pages hydrate a complete filing summary from the journal even when the
approval or batch marker is outside the page. Cursor bounds still use the raw
message rows. Deleting a question does not alter batch membership; multiple
filings within one turn remain independent. Old entries without an explicit
batch ID remain ordinary history; no ownership is inferred from nearby messages.
An interrupted applying batch becomes failed on restart, and partial undo can be
retried using only the remaining entries. Batch undo applies inverses in reverse
execution order.
It stops at a conflict and keeps earlier successful reversals visible. This is
not an atomic filesystem transaction. Undo refuses changed file content,
nonempty created folders, and occupied restore destinations. Restoring a
trashed file copies the private backup to its original path; it does not remove
the OS Trash entry. An interrupted `prepared` journal entry is retained for
recovery and is never offered as a completed, undoable change. Filing summaries
retain these entries as unresolved metadata with their source and target paths.
Confirmed inverses can run independently, but unresolved entries prevent a
receipt from reporting a complete undo. The receipt keeps an explicit checking
state even after every confirmed change has been undone.

Undo refreshes its live batch projection from the journal in its finalizer,
including on errors and retries that skip already-undone entries. A backup
cleanup failure is reported separately from the committed inverse; it cannot
leave a receipt advertising an undo that has already completed.

Filing summaries carry a persisted, monotonically increasing version. A canonical
renderer cache retains the latest version across conversation and workspace
switches; delayed history pages cannot restore an older receipt state.

Before a move or deletion, the journal captures the exact imported attachment
IDs at that path. Its applied/undone checkpoint also records a pending registry
sync. Registry updates and acknowledgement are idempotent: startup, subsequent
commands, and attachment resolution replay pending syncs without repeating the
filesystem operation. Reusing a filename never reconnects an older removed
attachment ID to a different file. Legacy records without captured IDs are not
repaired by guessing from paths.

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
handoff, business approval, file-change summaries, reverse-order undo,
editor/disk synchronization and history. The installed Claude adapter also
reads PDF/image/text attachments natively, runs compound inspection, temporary
conversion, repeated native reads, workspace writes and local network requests
without execution prompts. Filing suggestions finish their turn without moving
files; questions retain that recommendation, and explicit agreement executes it.
Cancellation, other operation approvals and undo remain covered by application tests.
API fixtures use isolated profiles and local endpoints, not native accounts.
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
provider. Tags apply to Markdown documents only. Automatic link rewriting after
rename is not an Agent tool in this version. Undo is a Melo control, not a harness tool.
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
