<p align="center">
  <img src="resources/icon.png" width="88" height="88" alt="Melo 的黄色小河豚">
</p>

<h1 align="center">Melo</h1>

<p align="center"><strong>笔记属于你，需要时有 AI 相伴。</strong></p>
<p align="center">以本地 Markdown 文件为基础，放在一起阅读、思考和写作。</p>

<p align="center">
  <a href="https://github.com/melo-libs/melo/releases/latest"><img src="https://img.shields.io/github/v/release/melo-libs/melo?color=ddad00&label=release" alt="最新版本"></a>
  <a href="https://github.com/melo-libs/melo/actions/workflows/ci.yml"><img src="https://github.com/melo-libs/melo/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/melo-libs/melo?color=586069" alt="MIT 开源协议"></a>
</p>

<p align="center">
  <a href="https://github.com/melo-libs/melo/releases/latest">下载 macOS 版本</a> ·
  <a href="https://www.melolib.com">官网</a> ·
  <a href="README.md">English</a> ·
  <a href="https://github.com/melo-libs/melo/discussions">交流讨论</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/workspace-dark.png">
  <img src="docs/images/workspace-light.png" alt="Melo 工作区：文件侧边栏、Markdown 笔记、任务清单、表格和 Mermaid 图表">
</picture>

<p align="center"><sub>使用示例笔记拍摄的真实界面，来自 main 分支。</sub></p>

Melo 把笔记保存为你所选文件夹里的普通 `.md` 文件。保存文章、建立联系，再把读到的东西写成自己的理解。你可以打开已有的笔记文件夹，也可以直接打开单个 Markdown 文件，文件仍留在原来的位置。

需要帮助时，在文章旁边打开 **Ask Melo**。连接 Claude Code 或 Codex，就能一起读文章、改草稿、整理文件。AI 是可选功能；阅读、写作和管理笔记不需要注册 Melo 账号。

## 从收藏，到写出自己的东西

Melo 围绕 **CODE：Collect、Organize、Distill、Express** 组织阅读与写作。

|                   | 你可以做什么                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------- |
| **收集 Collect**  | 剪藏网页文章，保留来源和图片。PDF、图片、音频、视频也可以放在笔记旁边。                  |
| **整理 Organize** | 用文件夹、标签、Smart Folders 和 `[[双链]]` 组织内容，通过反向链接和局部关系图找到联系。 |
| **提炼 Distill**  | 安静地阅读，搜索整个工作区，围绕当前文章或选中的段落向 Melo 提问。                       |
| **表达 Express**  | 在所见即所得的 Markdown 编辑器里写作，和 AI 一起修改草稿，导出 Markdown、HTML 或 PDF。   |

### 好好写作，也保留 Markdown

输入时即可看到标题、任务清单、引用、表格、代码高亮和 LaTeX 公式的样子。输入 `/` 插入内容块，拖动左侧手柄调整顺序，选中文字进行格式设置或添加链接。

Mermaid 图表支持源码编辑、文内缩放和平移，以及分别复制完整图片或代码。普通图片也能在正文中直接缩放、平移和展开查看。这两项功能已合入 `main`，**尚未包含在 v2.1.3 中**。

### 找到笔记，也不打断阅读

按 `⌘K` 搜索标题和全文，右侧实时预览结果。用 `#标签`、`kind:pdf`、`path:Inbox` 缩小范围；也可以直接粘贴网址来剪藏文章，或者把问题带入 Ask Melo。

![工作区搜索及右侧文章预览](docs/images/search.png)

### 连接你自己的 AI 工具

Melo 通过 ACP 连接 **Claude Code 和 Codex**。电脑上已经安装的工具可以直接使用；缺少的组件会在连接时按需下载。你可以用支持的账号登录，也可以配置与所选工具兼容的 API Key。

- 围绕当前文章、选中文字、附件和截图继续对话。
- 通过 Melo 的权限确认流程审阅文档和文件的修改操作。
- API 设置先验证再保存，错误的新 Key 不会覆盖原来可用的配置。
- Melo 保存的 API Key 使用电脑的安全存储。

笔记保存在本地。使用 AI 时，相关上下文会发送给你连接的服务；本地存储并不意味着 AI 请求离线运行。

<details>
<summary>查看首次连接 AI 的界面</summary>

![首次使用时的 Claude Code 和 Codex 连接引导](docs/images/ai-setup.png)

具体协议要求与服务信息见 [API 连接说明](docs/agent-api-providers.md)。

</details>

### 文件始终由你掌握

- 笔记是普通 Markdown 文件，图片通过相对路径保存在 `.assets/` 中。
- 在其他编辑器里做的修改会实时同步显示。
- `.melo/` 中的搜索索引可以重建，笔记正文不保存在索引里。
- 支持英文、简体中文，以及浅色、深色和跟随系统的主题。
- 暂无内置云同步和自动备份。备份时请保留整个工作区，包括 `.assets/` 和 `.melo/`。

## 下载与开始使用

目前发布的安装包支持 **macOS**。

| 你的 Mac                     | 在 [最新 Release](https://github.com/melo-libs/melo/releases/latest) 中选择 |
| ---------------------------- | --------------------------------------------------------------------------- |
| Apple silicon：M1 及后续芯片 | 文件名以 `-arm64.dmg` 结尾的安装包                                          |
| Intel                        | 文件名以 `-x64.dmg` 结尾的安装包                                            |

1. 打开 DMG，把 Melo 拖入 Applications。
2. 选择一个工作区文件夹，或打开单个 Markdown 文件。
3. 开始写作；想让 AI 帮忙时，再点小河豚连接工具。

macOS 发布版本采用固定的自签名证书，**尚未经过 Apple 公证**。首次打开时，可能需要在 **系统设置 → 隐私与安全性** 中允许 Melo 运行。2.0.2 及后续版本支持应用内更新；2.0.1 及更早版本需要先手动安装一次。

这份 README 跟随 `main` 更新。你安装的版本具体包含哪些功能，请查看 [Release notes](https://github.com/melo-libs/melo/releases)。

## 常用快捷键

| 快捷键       | 操作                               |
| ------------ | ---------------------------------- |
| `⌘K`         | 搜索、执行命令，或粘贴网址进行剪藏 |
| `⌘⇧C`        | 将编辑器选区复制为 Markdown        |
| `⌘N`         | 新建笔记                           |
| `⌘S`         | 保存草稿；保存后的笔记会自动保存   |
| `⌘F` / `⌥⌘F` | 在当前文章中查找 / 替换            |
| `/`          | 在空行插入内容块                   |
| `[[`         | 链接到其他笔记                     |
| `⌘,`         | 打开偏好设置                       |

更多示例见 [应用内用户指南](src/renderer/src/assets/guides/melo.zh-CN.md)。

## 开发与参与

Melo 使用 Electron、React、TypeScript、Tiptap / ProseMirror 和 Jotai。开发环境需要 **Node.js 24**，pnpm 版本以 `package.json` 为准。

```sh
corepack enable
pnpm install
pnpm run dev
```

```sh
pnpm run lint          # ESLint 与格式检查
pnpm run typecheck     # Main、preload 和 renderer 类型检查
pnpm test             # 单元测试
pnpm run build        # 类型检查与生产构建
```

开发环境使用独立的 **Melo Dev** 配置目录，也可以通过 `MELO_USER_DATA` 指定隔离目录。CI 检查 macOS arm64 和 x64，版本发布单独进行。

参与开发前请阅读 [贡献指南](CONTRIBUTING.md)、[架构说明](AGENTS.md) 和 [macOS 发布流程](docs/mac-release.md)。欢迎 [反馈 Bug](https://github.com/melo-libs/melo/issues/new?template=bug_report.yml)、[提出需求](https://github.com/melo-libs/melo/issues/new?template=feature_request.yml)，或在 [Discussions](https://github.com/melo-libs/melo/discussions) 交流。

## 开源协议

[MIT](LICENSE) © 2026 Melo Labs。
