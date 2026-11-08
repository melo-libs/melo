<div align="center">

<img src="resources/icon.png" width="112" alt="Melo logo" />

# Melo

**Turn information into knowledge of your own.**

A local-first knowledge workspace for macOS.<br />
Your notes stay plain Markdown files in your own folder. An AI assistant handles the busywork, so you can do the thinking.

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

## Why another notes app?

We have never saved so much: read-later queues, screenshots, PDFs, clippings, links forwarded in chats. Yet very little of it is something we have actually digested and could explain in our own words.

Storage isn't the problem. Today's note apps are very good at keeping things, and Obsidian has taken that further than anyone: a local folder plus a thousand plugins, and you can build any system you like.

But building and maintaining a system is a job in itself — choosing plugins, writing templates, designing folder hierarchies, tagging every note. Many of us spend more time tending the system than thinking. And what we collect still sits there, untouched.

**Melo makes a different bet: let the tool carry the busywork, and keep the thinking for you.**

## Design philosophy

**1. Knowledge is made, not stored.**
Melo is built around CODE — Collect, Organize, Distill, Express. It is not a checklist to finish in order but a loop you can enter anywhere, and every feature exists to move a piece of material one step further. Organize for the work ahead, not for a perfect taxonomy.

**2. Your files, your folder.**
Every note is an ordinary `.md` file in a place you choose. No proprietary format, no account, no cloud lock-in. Melo is just one way of looking at that folder; open it in another app and not a word is missing.

**3. Ready on day one beats endlessly configurable.**
Web clipping, PDF reading, full-text search, Smart Folders, and wikilinks are there from the first launch — no plugin hunting. We would rather get the defaults right for you than hand you a thousand switches.

**4. What you write looks like what you get.**
A true WYSIWYG editor: no wall of `#` and `**`, no split-pane preview. Clean Markdown still lives underneath, but it shouldn't stand between you and your words.

**5. AI does the chores; you do the thinking.**
The draining part is rarely the thinking — it's the upkeep. Where does this attachment go? What should it be called? Which tags apply? Melo's assistant takes that on. It proposes first, acts only when you agree, and every change can be undone. Distilling and expressing — working things out and putting them in your own words — stay yours.

**6. Bring the best AI instead of building another.**
Melo doesn't train its own model or write its own agent. It brings the strongest agents — Claude Code and Codex — into your notes, with your own account or API key. Melo takes care of what agents don't: your files, the context, conversation history, and undo.

## Melo and Obsidian

If you enjoy building and tuning your own system, Obsidian is a great choice. Melo is for people who want a workspace that feels right out of the box, so their time goes into the material rather than the tool.

|             | Obsidian                                               | Melo                                                                 |
| ----------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| Approach    | A toolbox: you build the system                        | A workspace designed around the CODE loop                            |
| Editing     | Markdown source / live preview                         | True WYSIWYG                                                         |
| Collecting  | Official Web Clipper browser extension                 | Paste a URL into `⌘K`; the article and its images are saved locally  |
| Organizing  | Folders, tags, and Bases views you design and maintain | Smart Folders, plus an assistant that files, names, and tags for you |
| AI          | Community plugins                                      | Built-in Claude Code / Codex; proposes before acting, undoable       |
| Extending   | A vast plugin ecosystem                                | A small set of carefully built features                              |
| Source code | Proprietary (free for personal use)                    | Open source, MIT                                                     |
| Your data   | A local folder of Markdown                             | A local folder of Markdown                                           |

Both just read and write plain Markdown, so **you don't have to choose**: the same folder can be opened in Obsidian and in Melo.

## Features along the CODE loop

<!-- TODO(screenshots): one image per part, e.g. docs/assets/collect.png -->

**Collect.** Paste a URL into the `⌘K` palette and the article is saved as Markdown with its images, readable offline. Paste or drag in screenshots and images. PDFs, images, audio, and video live in the same workspace as your notes. Drop attachments on the assistant and they land in your Inbox, ready to be organized.

**Organize.** `⌘K` searches titles and full text, with filters such as `#tag`, `kind:pdf`, and `path:inbox` and a live preview. Smart Folders organize the whole workspace by rules, so one file can appear in many views without copies. Tags sit above the text and are edited in place. `[[Wikilinks]]` come with backlinks, unlinked mentions, and a local graph.

**Distill.** WYSIWYG Markdown with highlights, task lists, tables, syntax-highlighted code blocks, and LaTeX math rendered with KaTeX. Slash commands, block dragging, and find & replace are always at hand.

**Express.** Export any note as Markdown, a single self-contained HTML file, or PDF, or share a selected passage as an image card.

## Meet the assistant

<!-- TODO(screenshots): docs/assets/assistant.png — conversation window next to a note -->

- **Ask about what you're reading.** The assistant follows the active document, and selected text can be sent straight from the editor.
- **Organize through conversation.** Before anything is moved or renamed, it discusses destinations and names with you. Changes can be undone, after checking for newer edits.
- **Tags and Smart Folders on request**, using the same rules as the rest of the app.
- **Your AI, your choice.** Claude Code or Codex, signed in with your account or connected to DeepSeek, Zhipu, Kimi, Anthropic, OpenAI, or a custom endpoint. Keys are kept in macOS secure storage.
- **Quiet when you're busy.** Close the window and it becomes a floating fish that shows whether it's working, waiting for you, or has a new reply.

## Install

1. Download the latest `.dmg` from [Releases](https://github.com/melo-libs/melo/releases/latest) — `arm64` for Apple silicon, `x64` for Intel Macs.
2. Drag Melo into Applications and open it.
3. Choose a folder as your workspace — an existing notes folder works too. Your notes stay where they are.

> [!NOTE]
> Builds are signed with a self-signed certificate and are not notarized by Apple. On first launch, macOS may ask you to approve Melo in **System Settings → Privacy & Security**. After that, updates install from inside the app.

## Contributing

Bug reports, ideas, and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and conventions, and [AGENTS.md](AGENTS.md) for architecture notes. For questions and ideas, use [Discussions](https://github.com/melo-libs/melo/discussions). To report a security issue, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Melo Labs
