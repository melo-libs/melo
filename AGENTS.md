# AGENTS.md

## Project Overview

Melo - A minimalist WYSIWYG Markdown editor desktop app built with Electron + React + Tiptap.

Use established English technical terms directly (`pipeline`, `guardrails`,
`prompt injection`). Do not force awkward Chinese translations for technical
terms; keep acronyms such as MCP, HTTP, and PDF unchanged.

## Tech Stack

- **Runtime**: Electron 31 (electron-vite for build tooling)
- **Frontend**: React 18, TypeScript 5.5
- **Editor**: Tiptap 3.25 (ProseMirror-based rich text editor)
- **State**: Jotai (atomic state management)
- **UI**: Radix UI primitives, shared Melo UI components, Sass
- **Build**: Vite 5, pnpm

## Project Structure

```
src/
├── main/           # Electron main process (Node.js)
│   ├── api/        # File operations, indexing, watching, capture
│   ├── ipc/        # IPC handlers
│   ├── libs/       # Main-process integrations
│   └── index.ts    # Window creation, menu, updater
├── preload/        # Preload scripts (context bridge)
├── renderer/       # React frontend app
│   └── src/
│       ├── components/
│       │   ├── editor/      # Editor, extensions, overlays, viewers
│       │   ├── sidebar/     # Workspace tree and file operations
│       │   ├── search/      # Search UI and engine integration
│       │   ├── settings/    # Settings surfaces and controls
│       │   ├── smart/       # Smart folders
│       │   └── ui/          # Shared Melo UI primitives
│       ├── hooks/              # Custom React hooks
│       ├── lib/                # Renderer domain helpers
│       ├── store/              # Jotai state and document sessions
│       └── styles/             # Global styles and design tokens
└── shared/         # Shared between main & renderer
    ├── locales/      # English and Chinese copy
    ├── serializers/  # Markdown serializers
    └── types/        # Shared TypeScript types
```

## Commands

```bash
pnpm run dev            # Start the development app
pnpm test               # Run renderer and main-process tests
pnpm run build          # Typecheck and build all processes
pnpm run typecheck      # Run node and renderer typechecks
pnpm run typecheck:web  # Typecheck renderer only
pnpm run typecheck:node # Typecheck main/preload only
pnpm run lint           # ESLint fix
pnpm run format         # Prettier
pnpm run build:mac      # Build the macOS app
```

## Path Aliases

- `@renderer` → `src/renderer/src/`
- `@shared` → `src/shared/`

## Conventions

### Commits

Conventional Commits format: `type(scope): description`
Types: feat, fix, docs, style, refactor, perf, test, chore, revert

### Code Style

- Functional components with hooks (no class components)
- Jotai atoms for state (not useState for shared state)
- Use SCSS and the shared design tokens for styling; use `lib/cn.ts` for
  conditional class names
- Reuse `components/ui` and Radix primitives for shared controls; do not create
  one-off buttons or dialogs when an existing component covers the interaction
- Extensions follow Tiptap pattern: `Extension.create()` / `Node.create()` / `Mark.create()`

### File Naming

- Components: PascalCase (`EditorPage.tsx`)
- Extensions: PascalCase (`MarkdownInput.ts`)
- Utils/hooks: camelCase (`saveScheduler.ts`, `useFloatingElement.ts`)
- Types: PascalCase in `types/` directory

## Engineering principles

Engineer, not code generator. Apply judgment; push back on unnecessary
complexity rather than silently complying.

**Work quietly.** Surface text only for surprises, decisions, or blockers —
don't narrate routine steps.

**Read before change.** Read the actual module, its callers, and nearby
conventions before editing. Match the existing style, don't impose a new one.

**Diagnose the root cause; size the change to it.** The real cause may live in
the design, data model, or a layer above — not where the symptom surfaced. Fix
_that_, even when it's bigger than a local patch, and surface it for discussion
first when it means a structural change. Don't bolt a band-aid onto a structural
problem; equally, don't pad a fix with unrelated cleanup.

**Verify for real.** Typecheck, codex review, a quick script/repro where it
helps — "it compiles" isn't verification. Strip temp scaffolding before done.

**Resist AI-slop defaults:**

- YAGNI / rule of three — don't abstract until the third real duplication; a
  wrong early abstraction is worse than duplication.
- No defensive over-engineering: no runtime type checks on typed params, no
  null guards on non-null types, no just-in-case branches. Validate only at
  system boundaries (user input, IPC, file/network reads).
- Don't swallow errors: a `catch` returning empty/null hides bugs. Handle what
  you can, let the rest propagate.
- Tightest correct type — no `any` / `Record<string, unknown>` when the shape
  is known. No magic strings; use constants/enums.
- Comments explain WHY (constraint, workaround, non-obvious tradeoff), never
  WHAT. Delete dead code instead of commenting it out.
- No wrappers that add no behavior, no back-compat shims for callers that don't
  exist — grep, then delete.

**Verify unfamiliar APIs.** Before using a library API you're unsure of, confirm
it exists in the actual source/types — don't invent plausible signatures.

**Security.** Never trust external input (fetched URLs, file contents, clipboard,
IPC payloads); validate at the boundary and guard file paths against `../`
traversal. No secrets in code; never log tokens or PII.

**Git.** Atomic commits; the message explains why. Refactor in a commit separate
from behavior changes.

## Design judgment

**Separation of concerns** means each piece can change independently — not
just more files. If touching feature A forces changes in B, they aren't
actually separated.

**Dependencies point inward.** Core logic depends on nothing; UI, IPC, and
storage depend on core — never the reverse. A layer may call inward but never
reach outward.

**Product thinking.** Evaluate every feature from the user's perspective.
Walk through the experience end-to-end before calling it done. "Works" is not
the bar — "feels right" is.

## Key Architecture Notes

- Documents stored as plain `.md` files on disk
- Editor works with ProseMirror document internally
- Serialization uses direct Markdown ↔ ProseMirror via `@tiptap/markdown`
- IPC communication between main/renderer via typed channels (`@shared/types/ipc`)
- Images saved to `.assets/YYYY/MM/uuid.ext` relative to document root
- Auto-save is coordinated by the document session and save scheduler
