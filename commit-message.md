# Commit message guidelines

Write all commit messages in English, including the subject, body, and footers.

## Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

## Types

- `feat`: ✨ New functionality
- `fix`: 🐛 Bug fixes
- `docs`: 📝 Documentation updates
- `style`: 💄 Formatting changes with no effect on behavior
- `refactor`: ♻️ Code changes that neither add features nor fix bugs
- `perf`: ⚡️ Performance improvements
- `test`: ✅ Added or updated tests
- `chore`: 🔧 Build or tooling changes
- `revert`: ⏪️ Reverts of earlier commits

## Scope

Use the affected project module, for example:

- `editor`
- `ui`
- `core`
- `file-system`
- `build`
- `deps`

## Description

- Use the imperative mood.
- Start with a lowercase letter.
- Do not end the subject with a period.

## Examples

```bash
# Feature
feat(editor): add image drag and drop support

# Bug fix
fix(core): resolve file saving issue in Windows

# Documentation
docs(readme): update installation guide

# Formatting
style(ui): format code according to prettier rules

# Refactoring
refactor(editor): simplify markdown parsing logic

# Performance
perf(editor): improve rendering performance for large files

# Tests
test(core): add unit tests for file operations

# Tooling
chore(deps): update dependencies

# Revert
revert: feat(editor): add image drag and drop support

# Commit with a detailed body
feat(editor): implement auto-save feature

- Add auto-save functionality that triggers every 5 minutes
- Implement file change detection
- Add user preferences for auto-save interval

Closes #123
```

## Additional conventions

### Breaking Changes

Describe breaking changes in a footer:

```bash
feat(api): add new authentication system

BREAKING CHANGE: `auth.login()` now returns a Promise instead of a callback
```

### Linked issues

Reference related issues in a footer:

```bash
fix(core): resolve file saving issue

Fixes #123
```

### Multiple change types

When a change spans multiple types, prefer `feat` or `fix` if either applies:

```bash
feat(editor): add new theme system and fix styling issues
```

## Tools

- Run `git commit` without `-m` to write a detailed message in your editor.
- Use `git commit --amend` to revise the latest commit.
- Use an interactive commit tool if one is configured for the project.
