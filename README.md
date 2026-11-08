<div align="center">

<img src="resources/icon.png" width="112" alt="Melo logo" />

# Melo

**Turn reading and reflection into knowledge of your own.**

Your second brain: notes, web clippings, PDFs, documents, and images in one place —<br />
understood, thought through, and shared with an AI by your side. Local-first, for macOS.

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

We have never saved so much: read-later queues, screenshots, PDFs, clippings, links forwarded in chats. Yet very little of it is something we have truly understood and could explain in our own words. Information keeps piling up; knowledge of our own doesn't.

Today's note apps are very good at keeping things, and Obsidian has taken that further than anyone: a local folder plus a thousand plugins, and you can build any system you like. But building and maintaining a system is a job in itself, and many of us spend more time tending the system than thinking. It also centers on Markdown, while PDFs, documents, and images stay scattered elsewhere.

**Melo exists to leave more room for thinking, and to help you turn information into knowledge that is truly yours.** To do that, we built a complete system around CODE.

## CODE: from information to knowledge

CODE is four motions — **Collect, Organize, Distill, Express**. It isn't a checklist to finish in order but a loop you can enter anywhere.

- **Collect** — a good article deserves more than a glance. Press `⌘K`, paste a link, and the text and images are saved locally. PDFs, Word files, slides, images, and video go into the same workspace.
- **Organize** — use familiar folders, gather things with Smart Folders, and search titles and full text with `⌘K`. Organize for the work ahead, not for a perfect taxonomy — and hand the chores to AI when you like.
- **Distill** — write things down in your own words so ideas settle in, or discuss what you're reading with AI: ask follow-ups, push back, look from another angle until it truly makes sense.
- **Express** — turn understanding into something that can leave the notebook. Export a finished piece, or select a passage and make a beautiful share card for friends or social media.

## Design philosophy

**1. A second brain, not just notes.**
Knowledge doesn't live only in Markdown. The papers you read, the contracts you receive, the slides you made, the whiteboard you photographed — all of it is part of what you know. Melo keeps it in one place, searched and organized together.

**2. Your files, your folder.**
Every note is an ordinary `.md` file, and everything stays in a folder you choose. No proprietary format, no account, no cloud lock-in. Open the folder in another app and not a word is missing.

**3. AI is a thinking partner, not a ghostwriter.**
AI does two things in Melo: it takes care of the upkeep — filing, naming, tagging — and it thinks things through with you until an article or a question really makes sense. But the thinking, and the knowledge it leaves behind, stay yours. That's why every change the AI makes is discussed with you first and can be undone.

**4. Good ideas deserve to be shared.**
Knowledge is complete when it's expressed. Share cards are one of the features we have polished most: select a sentence or a passage, get a beautiful image, and paste it straight into a chat or a social app.

**5. Ready on day one, and what you write is what you get.**
Clipping, PDF reading, full-text search, Smart Folders, and wikilinks are there from the first launch — no plugin hunting. The editor is true WYSIWYG: no wall of `#` and `**`, with clean Markdown quietly underneath. We would rather get the defaults right than hand you a thousand switches.

**6. Bring the best AI instead of building another.**
Melo doesn't train its own model or write its own agent. It brings the strongest agents — Claude Code and Codex — into your knowledge base, with your own account or API key. Melo takes care of what agents don't: your files, the context, conversation history, and undo.

## Melo and Obsidian

If you enjoy building and tuning your own system, Obsidian is a great choice. Melo is for people who want a second brain that feels right out of the box, so their time goes into understanding and expressing rather than into the tool.

|             | Obsidian                                               | Melo                                                                |
| ----------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| Approach    | A toolbox: you build the system                        | A second brain with the CODE loop already designed                  |
| Scope       | Centered on Markdown notes                             | Notes plus PDFs, Word, slides, images, and video, managed together  |
| Editing     | Markdown source / live preview                         | True WYSIWYG                                                        |
| Collecting  | Official Web Clipper browser extension                 | Paste a URL into `⌘K`; the article and its images are saved locally |
| Organizing  | Folders, tags, and Bases views you design and maintain | Smart Folders, plus AI that files, names, and tags for you          |
| AI          | Community plugins                                      | Built-in Claude Code / Codex that discusses what you're reading     |
| Sharing     | PDF export; web publishing via paid Obsidian Publish   | Markdown / HTML / PDF export, or a share card in one click          |
| Extending   | A vast plugin ecosystem                                | A small set of carefully built features                             |
| Source code | Proprietary (free for personal use)                    | Open source, MIT                                                    |
| Your data   | A local folder of Markdown                             | A local folder                                                      |

Both read and write plain Markdown, so **you don't have to choose**: the same folder can be opened in Obsidian and in Melo.

## Features

<!-- TODO(screenshots): one image per part, e.g. docs/assets/collect.png -->

**Collect.** Paste a URL into the `⌘K` palette and the article is saved as Markdown with its images, readable offline. Paste or drag in screenshots and images. Drop attachments on the AI and they land in your Inbox, ready to be organized.

**Organize.** `⌘K` searches titles and full text, with filters such as `#tag`, `kind:pdf`, and `path:inbox` and a live preview. Smart Folders organize the whole workspace by rules, so one file can appear in many views without copies. Tags sit above the text and are edited in place. `[[Wikilinks]]` come with backlinks, unlinked mentions, and a local graph. PDFs open for reading, images and media play inline, and Office documents show thumbnails with Quick Look on Space.

**Distill.** WYSIWYG Markdown with highlights, task lists, tables, syntax-highlighted code blocks, and LaTeX math rendered with KaTeX. Slash commands, block dragging, and find & replace are always at hand.

**Express.** Select text to make a share card, copy it, and paste it anywhere. Export any note as Markdown, a single self-contained HTML file, or PDF.

## Meet your AI partner

<!-- TODO(screenshots): docs/assets/assistant.png — conversation window next to a note -->

- **Reads with you.** The AI follows the active document, and selected text can be sent straight from the editor. Ask, discuss, and look from new angles until it clicks.
- **Organizes for you.** Before anything is moved or renamed, it discusses destinations and names with you. Changes can be undone, after checking for newer edits. Tags and Smart Folders can be handed over too, using the same rules as the rest of the app.
- **Your AI, your choice.** Claude Code or Codex, signed in with your account or connected to DeepSeek, Zhipu, Kimi, Anthropic, OpenAI, or a custom endpoint. Keys are kept in macOS secure storage.
- **Quiet when you're busy.** Close the window and it becomes a floating fish that shows whether it's working, waiting for you, or has a new reply.

## Install

1. Download the latest `.dmg` from [Releases](https://github.com/melo-libs/melo/releases/latest) — `arm64` for Apple silicon, `x64` for Intel Macs.
2. Drag Melo into Applications and open it.
3. Choose a folder as your workspace — an existing notes folder works too. Everything stays where it is.

> [!NOTE]
> Builds are signed with a self-signed certificate and are not notarized by Apple. On first launch, macOS may ask you to approve Melo in **System Settings → Privacy & Security**. After that, updates install from inside the app.

## Contributing

Bug reports, ideas, and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and conventions, and [AGENTS.md](AGENTS.md) for architecture notes. For questions and ideas, use [Discussions](https://github.com/melo-libs/melo/discussions). To report a security issue, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Melo Labs
