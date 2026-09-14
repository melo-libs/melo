# Melo

Turn information into knowledge of your own.

Melo is a personal knowledge workspace built around CODE: Collect, Organize, Distill, and Express. Your notes are plain `.md` files in a folder you choose, edited in a true WYSIWYG editor. No account, no lock-in — point it at an existing notes folder and everything just works. (Search runs on a small rebuildable index in `.melo/`; your notes never live inside it.)

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

```bash
pnpm install
pnpm dev            # start the app in dev mode
pnpm run typecheck  # node + web typechecks
pnpm test           # unit tests
pnpm run build:mac  # package for macOS
```

Built with Electron 31, React 18, TypeScript, Tiptap, and Jotai. See `CLAUDE.md` for architecture notes.

## License

[MIT](LICENSE) © 2026 Melo Labs
