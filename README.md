<div align="center">

<img src="resources/icon.png" width="112" alt="Melo logo" />

# Melo

**Turn information into knowledge of your own.**

A local-first knowledge workspace for macOS — plain Markdown files, a true WYSIWYG editor,<br />
and an AI assistant that reads, organizes, and edits alongside you.

[![Latest release](https://img.shields.io/github/v/release/melo-libs/melo?label=release&color=f5b301)](https://github.com/melo-libs/melo/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/melo-libs/melo/total?color=f5b301)](https://github.com/melo-libs/melo/releases)
[![CI](https://github.com/melo-libs/melo/actions/workflows/ci.yml/badge.svg)](https://github.com/melo-libs/melo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/melo-libs/melo?color=blue)](LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey)

[**Download for macOS**](https://github.com/melo-libs/melo/releases/latest) · [Website](https://www.melolib.com) · [Release notes](CHANGELOG.md) · [Discussions](https://github.com/melo-libs/melo/discussions)

English | [简体中文](README.zh-CN.md)

</div>

<!-- TODO(screenshots): hero image or short GIF of the main editor, e.g.
<p align="center"><img src="docs/assets/hero.png" width="880" alt="Melo editor" /></p>
-->

## Why Melo

- **Your notes are just files.** Every note is a `.md` file in a folder you choose. Point Melo at an existing notes folder and it just works; edits made in other apps show up live.
- **No account, no lock-in.** Nothing to sign up for, nothing to export your way out of. Search runs on a small, rebuildable index in `.melo/` — your notes never live inside it.
- **Writing that feels like writing.** A real WYSIWYG editor, not a split-pane preview, with clean Markdown underneath.
- **An assistant that works in your workspace.** Ask about the note you're reading, hand it a pile of attachments to file, or have it tidy tags and folders — every change is reviewable and undoable.

## Built around CODE

Melo follows the CODE workflow: **Collect → Organize → Distill → Express.**

<!-- TODO(screenshots): one image per section below, e.g. docs/assets/collect.png -->

### Collect

- **Web clipping** — paste a URL into the `⌘K` palette; the article is extracted, converted to Markdown, and saved with its images so it reads offline
- **Paste or drag images** straight into notes (stored under `.assets/` with relative paths)
- **Any file type** lives alongside your notes, with built-in PDF reading and image, video, and audio viewing
- **Inbox through chat** — drop attachments into the assistant and they land in your Inbox, ready to be organized

### Organize

- **`⌘K` palette** — title and full-text search with filters (`#tag`, `kind:pdf`, `path:inbox`) and a live preview
- **Smart Folders** — saved, rule-based views over the whole workspace (source, kind, dates, tags…)
- **Tags** shown above the text and edited in place, with suggestions from your existing tags
- **Wikilinks** (`[[…]]`) with backlinks, unlinked mentions, and a local graph

### Distill

- **WYSIWYG Markdown** (Tiptap/ProseMirror) — headings, lists, task lists, quotes, tables
- **Code blocks** with syntax highlighting, a language picker, line numbers, and smart indentation
- **LaTeX math** — inline `$…$` and block `$$…$$`, rendered with KaTeX, plus a guided equation editor
- **Slash commands** (`/`), block drag handles, and find & replace (`⌘F` / `⌥⌘F`)

### Express

- **Export** any note as Markdown, a single self-contained HTML file, or PDF
- **Share cards** for passages worth passing on
- English and Simplified Chinese interface; light, dark, or system theme

## Meet the assistant

<!-- TODO(screenshots): docs/assets/assistant.png — conversation window next to a note -->

Melo's assistant runs on **Claude Code** or **Codex**, using your own account or a supported API service — DeepSeek, Zhipu, Kimi, Anthropic, OpenAI, or a custom endpoint.

- **Ask about what you're reading.** The assistant follows the active document as you switch tabs, and selected text can be sent straight from the editor.
- **Organize through conversation.** Discuss destinations and filenames before anything moves. Managed changes come with an undo that checks for newer edits first.
- **Tags and Smart Folders on request**, using the same rules as the rest of the app.
- **Stays out of the way.** Close the window to a floating fish that shows when Melo is working, waiting for you, or has a new reply.
- **Your keys stay on your Mac.** API credentials are kept in the system's secure storage. Claude Code and Codex are downloaded on first use, or Melo reuses a compatible installation you already have.

## Install

1. Download the latest `.dmg` from [Releases](https://github.com/melo-libs/melo/releases/latest) — `arm64` for Apple silicon, `x64` for Intel Macs.
2. Drag Melo into Applications and open it.
3. Choose a folder as your workspace — or open a single Markdown file. Your notes stay where they are.

> [!NOTE]
> Builds are signed with a self-signed certificate and are not notarized by Apple. On first launch, macOS may ask you to approve Melo in **System Settings → Privacy & Security**. After that, updates install from inside the app.

## Contributing

Bug reports, ideas, and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and conventions, and [AGENTS.md](AGENTS.md) for architecture notes. For questions and ideas, use [Discussions](https://github.com/melo-libs/melo/discussions). To report a security issue, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Melo Labs
