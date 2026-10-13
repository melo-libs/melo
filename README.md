# Melo

Turn information into knowledge of your own.

Melo is a personal knowledge workspace built around CODE: Collect, Organize, Distill, and Express. Your notes are plain `.md` files in a folder you choose, edited in a true WYSIWYG editor. No account, no lock-in — point it at an existing notes folder and everything just works. (Search runs on a small rebuildable index in `.melo/`; your notes never live inside it.)

## Get Melo

Download a macOS build for your Mac (Apple silicon or Intel) from [GitHub Releases](https://github.com/melo-libs/melo/releases). Choose a folder as your workspace, or open an individual Markdown file; Melo keeps your notes in their original location.

The latest published release may be older than the features described here. Check the release notes for the version you download. Unsigned macOS builds may require approval in Privacy & Security before opening; they can check for updates, but new versions must be installed manually from GitHub Releases.

## What it does

**Write**

- WYSIWYG Markdown editing (Tiptap/ProseMirror) — headings, lists, task lists, quotes, tables
- Syntax-highlighted code blocks with a language picker, line numbers and smart indentation
- LaTeX math (inline `$…$` and block `$$…$$`, rendered with KaTeX) with a guided equation editor
- Slash commands (`/`), block drag handles, find & replace (`⌘F` / `⌥⌘F`)
- Wikilinks (`[[…]]`) with backlinks, unlinked mentions and a local graph

**Collect**

- Web clipping: paste a URL into the search palette (`⌘K`) and the article is extracted, converted to Markdown and saved — images downloaded into the workspace so clips read offline
- Paste or drag images straight into notes (stored under `.assets/`, relative paths)
- Files of any kind live alongside notes: PDF reading, image / video / audio viewing built in

**Find**

- `⌘K` palette: title + full-text search with filters (`#tag`, `kind:pdf`, `path:inbox`) and a live preview pane
- Smart folders: saved rule-based views over the whole workspace (source, kind, dates, tags…)

**Own**

- Everything is a file on your disk; edits made outside Melo are picked up live
- Export any note as Markdown, standalone HTML (a single self-contained file) or PDF
- English and 简体中文 interface; light / dark / system theme

## Development

Use Node.js 24 and the pnpm version pinned in `package.json`.

```bash
pnpm install
pnpm run dev                 # start the app in dev mode
pnpm run lint                # read-only ESLint and Prettier checks
pnpm run lint:fix            # apply ESLint fixes
pnpm run typecheck           # main/preload and renderer typechecks
pnpm test                    # unit tests
pnpm run release:check       # lint, typechecks, tests, production build
pnpm run build:mac:unsigned  # local unsigned macOS package
```

CI validates macOS arm64 and x64 builds; publishing a release is a separate manual step. Built with Electron 31, React 18, TypeScript, Tiptap, and Jotai. See [AGENTS.md](AGENTS.md) for architecture notes.

## License

[MIT](LICENSE) © 2026 Melo Labs
