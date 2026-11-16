# Contributing to Melo

Thanks for helping make Melo better. This guide covers how to report problems, propose changes, and get a development build running.

## Before you start

- **Bugs** — open a [bug report](https://github.com/melo-libs/melo/issues/new?template=bug_report.yml). Include your Melo version, macOS version, and steps to reproduce.
- **Feature ideas** — open a [feature request](https://github.com/melo-libs/melo/issues/new?template=feature_request.yml), or start a thread in [Discussions](https://github.com/melo-libs/melo/discussions) if the idea is still taking shape.
- **Questions** — use [Discussions](https://github.com/melo-libs/melo/discussions) rather than issues.
- **Security issues** — do not open a public issue; follow [SECURITY.md](SECURITY.md).

For anything larger than a small fix, please open an issue first so we can agree on the approach before you invest time in code.

## Development setup

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

Development builds use a persistent `Melo Dev` profile in the system app-data directory, separate from the installed app. Select your workspace on the first development launch. Set `MELO_USER_DATA` to use a different profile for tests.

Melo is built with Electron 31, React 18, TypeScript, Tiptap, and Jotai. See [AGENTS.md](AGENTS.md) for the architecture, code style, and engineering principles, and [docs/](docs/) for subsystem notes such as the [agent integration](docs/agent-integration.md) and [macOS releases](docs/mac-release.md).

## Pull requests

1. Branch from `main` and keep each pull request focused on one change.
2. Run `pnpm run release:check` before pushing. CI runs the same checks plus Electron end-to-end suites and packaged-app startup tests on macOS arm64 and x64.
3. Add or update tests for behavior changes.
4. Describe what changed and why, and include screenshots or a short recording for UI changes.
5. Link the issue the pull request resolves (`Fixes #123`).

Publishing a release is a separate manual step handled by maintainers.

## Commit messages

Write all commit messages in English and follow [Conventional Commits](https://www.conventionalcommits.org/). commitlint checks the format.

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types**

| Type       | Use for                                             |
| ---------- | --------------------------------------------------- |
| `feat`     | New functionality                                   |
| `fix`      | Bug fixes                                           |
| `docs`     | Documentation updates                               |
| `style`    | Formatting changes with no effect on behavior       |
| `refactor` | Code changes that neither add features nor fix bugs |
| `perf`     | Performance improvements                            |
| `test`     | Added or updated tests                              |
| `chore`    | Build or tooling changes                            |
| `revert`   | Reverts of earlier commits                          |

**Scope** is the affected module, for example `editor`, `ui`, `core`, `agent`, `file-system`, `build`, or `deps`.

**Description** uses the imperative mood, starts with a lowercase letter, and has no trailing period.

```bash
feat(editor): add image drag and drop support
fix(core): resolve file saving issue in Windows
docs(readme): update installation guide
chore(deps): update dependencies
```

Use the body to explain _why_ the change was made. Keep commits atomic, and put refactors in a separate commit from behavior changes.

**Footers**

```bash
# Linked issues
fix(core): resolve file saving issue

Fixes #123

# Breaking changes
feat(api): add new authentication system

BREAKING CHANGE: `auth.login()` now returns a Promise instead of a callback
```

When a change spans several types, prefer `feat` or `fix` if either applies.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
