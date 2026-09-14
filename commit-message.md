# Commit Message 规范指南

## 格式

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

## Type 类型

- `feat`: ✨ 新功能
- `fix`: 🐛 修复 bug
- `docs`: 📝 文档更新
- `style`: 💄 代码格式（不影响代码运行的变动）
- `refactor`: ♻️ 重构（既不是新增功能，也不是修改 bug 的代码变动）
- `perf`: ⚡️ 性能优化
- `test`: ✅ 增加测试
- `chore`: 🔧 构建过程或辅助工具的变动
- `revert`: ⏪️ 回滚到上一个版本

## Scope 范围

根据项目模块定义，例如：
- `editor`
- `ui`
- `core`
- `file-system`
- `build`
- `deps`

## Description 描述

- 使用祈使句（命令式）
- 第一个字母小写
- 句尾不加句号

## 示例

```bash
# 新功能
feat(editor): add image drag and drop support

# Bug 修复
fix(core): resolve file saving issue in Windows

# 文档更新
docs(readme): update installation guide

# 代码格式
style(ui): format code according to prettier rules

# 代码重构
refactor(editor): simplify markdown parsing logic

# 性能优化
perf(editor): improve rendering performance for large files

# 测试相关
test(core): add unit tests for file operations

# 构建相关
chore(deps): update dependencies

# 回滚提交
revert: feat(editor): add image drag and drop support

# 包含详细说明的提交
feat(editor): implement auto-save feature

- Add auto-save functionality that triggers every 5 minutes
- Implement file change detection
- Add user preferences for auto-save interval

Closes #123
```

## 特殊说明

### Breaking Changes

当有破坏性更新时，在 footer 中说明：

```bash
feat(api): add new authentication system

BREAKING CHANGE: `auth.login()` now returns a Promise instead of a callback
```

### 关联 Issue

在 footer 中关联 issue：

```bash
fix(core): resolve file saving issue

Fixes #123
```

### 多个类型

如果一个提交同时包含多个类型的修改，优先使用 `feat` 或 `fix`：

```bash
feat(editor): add new theme system and fix styling issues
```

## 实用工具

- 使用 `git commit` 命令（不带 -m）打开编辑器，可以编写更详细的提交信息
- 使用 `git commit --amend` 修改最后一次提交
- 使用 `npm run commit` 启动交互式提交（如果配置了 commitizen）
