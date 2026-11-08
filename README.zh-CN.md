<div align="center">

<img src="resources/icon.png" width="112" alt="Melo logo" />

# Melo

**把信息，变成你自己的知识。**

一款本地优先的 macOS 知识工作台：笔记就是纯 Markdown 文件，编辑器是真正的所见即所得，<br />
还有一位能陪你阅读、整理和编辑的 AI 助手。

[![最新版本](https://img.shields.io/github/v/release/melo-libs/melo?label=release&color=f5b301)](https://github.com/melo-libs/melo/releases/latest)
[![下载量](https://img.shields.io/github/downloads/melo-libs/melo/total?color=f5b301)](https://github.com/melo-libs/melo/releases)
[![CI](https://github.com/melo-libs/melo/actions/workflows/ci.yml/badge.svg)](https://github.com/melo-libs/melo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/melo-libs/melo?color=blue)](LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey)

[**下载 macOS 版**](https://github.com/melo-libs/melo/releases/latest) · [官网](https://www.melolib.com) · [更新日志](CHANGELOG.md) · [讨论区](https://github.com/melo-libs/melo/discussions)

[English](README.md) | 简体中文

</div>

<!-- TODO(screenshots): 主界面大图或短 GIF，例如
<p align="center"><img src="docs/assets/hero.png" width="880" alt="Melo 编辑器" /></p>
-->

## 为什么是 Melo

- **笔记就是文件。** 每篇笔记都是你选定文件夹里的一个 `.md` 文件。直接打开已有的笔记文件夹就能用，在其他应用里改过的内容也会实时同步过来。
- **无需账号，不被锁定。** 不用注册，也不存在"导不出来"的问题。搜索依赖 `.melo/` 里一个可随时重建的小索引，你的笔记从不存放在里面。
- **写起来就像在写字。** 真正的所见即所得编辑，不是左右分栏预览，底层仍是干净的 Markdown。
- **助手就在你的工作区里干活。** 问它正在读的这篇笔记，把一堆附件交给它归档，或者让它整理标签和文件夹。每一处改动都可以查看、可以撤销。

## 围绕 CODE 设计

Melo 遵循 CODE 工作流：**收集（Collect）→ 整理（Organize）→ 提炼（Distill）→ 表达（Express）**。

<!-- TODO(screenshots): 下面每一节配一张图，例如 docs/assets/collect.png -->

### 收集

- **网页剪藏**：把网址粘贴进 `⌘K` 面板，正文会被提取、转成 Markdown 并连同图片一起保存，离线也能读
- **粘贴或拖入图片**，直接插进笔记（保存在 `.assets/` 下，使用相对路径）
- **任何类型的文件**都能和笔记放在一起，内置 PDF 阅读，以及图片、视频、音频查看
- **对话即收件箱**：把附件拖给助手，它们会进入收件箱，等你整理

### 整理

- **`⌘K` 面板**：标题和全文搜索，支持过滤条件（`#标签`、`kind:pdf`、`path:inbox`），带实时预览
- **智能文件夹**：保存下来的规则视图，覆盖整个工作区（来源、类型、日期、标签……）
- **标签**显示在正文上方，可以直接编辑，并从已有标签中给出建议
- **双向链接**（`[[…]]`），带反向链接、未链接提及和局部关系图

### 提炼

- **所见即所得的 Markdown**（Tiptap/ProseMirror）：标题、列表、任务列表、引用、表格
- **代码块**：语法高亮、语言选择、行号、智能缩进
- **LaTeX 公式**：行内 `$…$` 和块级 `$$…$$`，用 KaTeX 渲染，另有引导式公式编辑器
- **斜杠命令**（`/`）、块拖拽手柄、查找替换（`⌘F` / `⌥⌘F`）

### 表达

- **导出**任意笔记为 Markdown、单文件 HTML 或 PDF
- **分享卡片**，把值得分享的段落做成卡片
- 中英文界面；浅色、深色或跟随系统

## 认识你的助手

<!-- TODO(screenshots): docs/assets/assistant.png，对话窗口与笔记并排 -->

Melo 的助手基于 **Claude Code** 或 **Codex** 运行，可以用你自己的账号，也可以接入支持的 API 服务：DeepSeek、智谱、Kimi、Anthropic、OpenAI，或自定义接口。

- **问你正在读的内容。** 切换标签页时，助手会跟着当前文档走；在编辑器里选中的文字可以直接发给它。
- **用对话来整理。** 在任何文件被移动之前，先和你商量放在哪里、叫什么名字。由它完成的改动都可以撤销，撤销前会检查是否有更新的编辑。
- **按你的要求整理标签和智能文件夹**，规则和应用其他地方完全一致。
- **不打扰你。** 关掉对话窗口后，它会变成一条悬浮的小鱼，告诉你它正在工作、在等你，还是有了新回复。
- **密钥留在你的 Mac 上。** API 凭据保存在系统的安全存储中。Claude Code 和 Codex 会在首次使用时下载，如果你已经装有兼容的版本，Melo 会直接复用。

## 安装

1. 从 [Releases](https://github.com/melo-libs/melo/releases/latest) 下载最新的 `.dmg`：Apple 芯片选 `arm64`，Intel 芯片选 `x64`。
2. 把 Melo 拖进"应用程序"并打开。
3. 选择一个文件夹作为工作区，或者直接打开单个 Markdown 文件。笔记会留在原来的位置。

> [!NOTE]
> 安装包使用自签名证书，未经 Apple 公证。首次打开时，macOS 可能会要求你在 **系统设置 → 隐私与安全性** 中允许 Melo 运行。之后的更新可以直接在应用内安装。

## 参与贡献

欢迎提交 Bug、建议和 Pull Request。开发环境和约定请看 [CONTRIBUTING.md](CONTRIBUTING.md)，架构说明请看 [AGENTS.md](AGENTS.md)。提问和讨论想法请到[讨论区](https://github.com/melo-libs/melo/discussions)。如需报告安全问题，请参阅 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE) © 2026 Melo Labs
