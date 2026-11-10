# Contributing to Melo

Thanks for helping make Melo a better place to read, think, and write. Issues, documentation improvements, design feedback, and code contributions are welcome. English and Simplified Chinese are both welcome in issues and discussions.

## Start a conversation

- [Report a bug](https://github.com/melo-libs/melo/issues/new?template=bug_report.yml) with the version, reproduction steps, and what you expected.
- [Suggest a feature](https://github.com/melo-libs/melo/issues/new?template=feature_request.yml) by describing the task you are trying to complete.
- Use [Discussions](https://github.com/melo-libs/melo/discussions) for questions and ideas that do not yet need an issue.

Before working on a large change, open or comment on an issue so we can agree on the scope. An open issue is not necessarily scheduled for implementation.

## Run the app

Use Node.js 24 and the pnpm version pinned in `package.json`:

```sh
git clone https://github.com/melo-libs/melo.git
cd melo
corepack enable
pnpm install
pnpm run dev
```

The development app uses a separate **Melo Dev** profile. For checks that modify documents, credentials, or settings, use a disposable workspace and an isolated `MELO_USER_DATA` directory.

## Make a focused change

- Read [AGENTS.md](AGENTS.md) for architecture and coding conventions.
- Keep saved documents portable Markdown. View state, such as image zoom, should not alter their contents.
- Use shared UI components, design tokens, and the existing typed IPC boundaries.
- Include English and Simplified Chinese strings when adding interface copy.
- Explain why a behavior changed. Include screenshots for visible UI changes.

Use Conventional Commits, for example `fix(editor): preserve table alignment on paste`.

## Check your work

```sh
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

Choose checks relevant to the change. For documentation, check formatting, links, and the rendered result. For UI, inspect the actual app. For changes across renderer, IPC, and filesystem boundaries, use the appropriate existing isolated E2E script; do not add a CI job for every feature.

`pnpm run release:check` runs the full CI verification. See [the macOS release guide](docs/mac-release.md) for packaging and publishing; signing credentials must not be committed.

## Refresh the README screenshots

```sh
pnpm run build
node scripts/capture-readme.mjs
```

The capture script opens an isolated instance with example notes, uses separate AI configuration directories, and writes screenshots to `docs/images/`. It does not use a personal workspace or send AI requests. Successful runs remove their temporary profile; failed runs retain diagnostics in the temporary directory printed by the script.

The English and [Chinese README](README.zh-CN.md) describe the same functionality. Update both when changing installation instructions or user-facing features. Keep the distinction between `main` and published releases accurate.
