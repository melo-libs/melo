<div align="center">

<img src="resources/icon.png" width="112" alt="Melo logo" />

# Melo

A local knowledge base for Mac. Notes, web clippings, PDFs, and documents in one folder, with an AI that reads along and helps you organize.

[Download](https://github.com/melo-libs/melo/releases/latest) · [Website](https://www.melolib.com) · [Changelog](CHANGELOG.md) · [中文](README.zh-CN.md)

</div>

<!-- TODO(screenshots): main window -->

## Features

- **It's just a folder.** Pick a folder to start, or an existing notes folder. Notes are `.md` files, images go in `.assets/`. No account, and Melo uploads nothing.
- **Clip with ⌘K.** Paste an article link into `⌘K` and the text and images are saved as one Markdown file you can read offline.
- **PDFs and documents.** Read PDFs, view images, audio, and video, and preview Word or PowerPoint files with Space. Smart Folders group files by type, tag, or date without moving them.
- **WYSIWYG.** Type `## ` for a heading or `- [ ] ` for a to-do. Tables, code blocks, math, and `[[wikilinks]]` all live in the same note.
- **AI.** Connect Claude Code or Codex with your own account, or with an API key from DeepSeek, Kimi, Zhipu, and others. It sees the document you're reading, so you can ask follow-ups and argue a point. It can also file, rename, and tag attachments from your Inbox. It asks before changing anything, and changes can be undone.
- **Share cards.** Select a passage, turn it into an image, and paste it into a chat or a social app.

<!-- TODO(screenshots): one GIF each for clipping, Smart Folders, AI chat, share cards -->

## Why we built Melo

Melo follows CODE from Tiago Forte's _Building a Second Brain_: Collect, Organize, Distill, Express. Most note apps we used stop after the first two steps. Things go in and stay there. Melo tries to cover the rest: talk a question through with AI while you read, write down what you've worked out, then share it.

## Trade-offs

**Why WYSIWYG?** We want what you see while writing to look like the finished note. The file underneath is standard Markdown, so another editor opens it with nothing missing.

**Why not build our own AI?** Claude Code and Codex are already very good agents. Melo handles what they don't: which file to read, where conversations are kept, and how to undo a change.

**How is it different from Obsidian?** Obsidian is great if you like picking plugins and building your own system. Melo ships clipping, file management, AI, and sharing in the app, so it works as soon as you open it. Both use plain Markdown, so you can point them at the same folder.

## Not there yet

- macOS only. No Windows or mobile apps.
- No cloud sync. To back up, copy the whole folder, including `.assets` and `.melo`.
- Some pages don't clip completely, and images that weren't downloaded need a connection.
- AI features need your own account or API key, billed by that service.

## Install

Download the latest DMG from [GitHub Releases](https://github.com/melo-libs/melo/releases/latest): `arm64` for Apple silicon, `x64` for Intel.

Builds aren't notarized by Apple. If macOS can't verify Melo on first launch, open System Settings → Privacy & Security and click Open Anyway. Later versions update from inside the app.

## Contributing

Melo is open source under the MIT license. Open an [issue](https://github.com/melo-libs/melo/issues) or start a thread in [Discussions](https://github.com/melo-libs/melo/discussions). For code changes, read [CONTRIBUTING.md](CONTRIBUTING.md) first, and report security issues privately as described in [SECURITY.md](SECURITY.md). If Melo is useful to you, a star or a recommendation helps.
