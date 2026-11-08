<div align="center">

<img src="resources/icon.png" width="112" alt="Melo logo" />

# Melo

**把信息，变成你自己的知识。**

一款本地优先的 macOS 知识工作台。<br />
笔记就是你文件夹里的 Markdown 文件，AI 助手替你打理杂务，思考留给你自己。

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

## 为什么还要再做一个笔记应用？

我们收藏的东西从来没有这么多过：稍后读、截图、PDF、剪藏、聊天记录里转发的链接。真正被我们消化、用自己的话说得出来的，却少得可怜。

问题不在于存储。今天的笔记工具都很擅长"存"，Obsidian 更是把这件事做到了极致：一个本地文件夹，加上一千个插件，你可以搭出任何你想要的系统。

但搭系统和维护系统，本身就是一份工作：挑插件、写模板、设计目录结构、给每篇笔记打标签……很多人花在"整理笔记的系统"上的时间，比花在思考上的还多。最后，收进来的东西还是躺在那里。

**Melo 押的是另一种方式：杂务交给工具，思考留给你。**

## 设计哲学

**1. 知识是做出来的，不是存出来的。**
Melo 围绕 CODE 设计：收集（Collect）、整理（Organize）、提炼（Distill）、表达（Express）。这不是一张要按顺序完成的清单，而是一个可以从任何地方进入的循环。每一个功能，都是为了让一份材料往下一步走。我们为接下来要做的事整理，而不是追求一个完美的分类法。

**2. 你的文件，你的文件夹。**
每篇笔记都是一个普通的 `.md` 文件，放在你选的地方。没有私有格式，没有账号，没有云端锁定。Melo 只是看待这个文件夹的一种方式，换个应用打开，内容一个字都不会少。

**3. 开箱即用，胜过无限可配。**
网页剪藏、PDF 阅读、全文搜索、智能文件夹、双向链接，第一天就在，不需要去插件市场里挑。我们宁可替你把默认做对，也不把一千个开关交给你。

**4. 写的样子，就是成品的样子。**
真正的所见即所得：没有满屏的 `#` 和 `**`，没有左右分栏的预览。Markdown 依然干干净净地在底层，但它不该挡在你和文字之间。

**5. AI 干杂活，人做思考。**
最耗人的往往不是思考，而是打理：这个附件放哪？叫什么名字？该打什么标签？Melo 的助手接手这些事。它先提方案，你点头它才动手，每一处改动都能撤销。但提炼和表达，也就是用自己的话把东西想明白、写出来，始终是你的。

**6. 用最好的 AI，而不是再造一个。**
Melo 不训练自己的模型，也不自己写一套 agent。它把 Claude Code、Codex 这些最强的 agent 请进你的笔记里，可以用你自己的账号，也可以用 API。Melo 负责的是 agent 做不好的部分：你的文件、上下文、对话历史和撤销。

## Melo 和 Obsidian

如果你享受亲手搭建、不断调校自己的系统，Obsidian 是很好的选择。Melo 是为另一类人准备的：想要一个开箱就顺手的工作台，把时间花在内容上，而不是工具上。

|          | Obsidian                                 | Melo                                                   |
| -------- | ---------------------------------------- | ------------------------------------------------------ |
| 思路     | 工具箱：你来搭系统                       | 工作台：围绕 CODE 流程设计好了                         |
| 编辑     | Markdown 源码 / 实时预览                 | 真正的所见即所得                                       |
| 收集     | 官方浏览器扩展 Web Clipper               | 在 `⌘K` 里粘贴网址即可剪藏，图片一并存到本地           |
| 整理     | 文件夹、标签、Bases 视图，自己设计和维护 | 智能文件夹，加上 AI 助手帮你归档、命名、打标签         |
| AI       | 第三方插件                               | 原生集成 Claude Code / Codex，先商量再动手，改动可撤销 |
| 扩展方式 | 庞大的插件生态                           | 少而精的内置功能                                       |
| 源代码   | 闭源（个人使用免费）                     | MIT 开源                                               |
| 你的数据 | 本地 Markdown 文件夹                     | 本地 Markdown 文件夹                                   |

两者都只是读写普通的 Markdown 文件，所以**你不必二选一**：同一个文件夹可以同时用 Obsidian 和 Melo 打开。

## 围绕 CODE 的功能

<!-- TODO(screenshots): 下面每一节配一张图，例如 docs/assets/collect.png -->

**收集**：把网址粘贴进 `⌘K` 面板，正文连同图片一起存成 Markdown，离线也能读。截图和图片可以直接粘贴、拖入。PDF、图片、音视频都能和笔记放在同一个工作区。附件也可以直接拖给助手，它们会先进收件箱，等着被整理。

**整理**：`⌘K` 同时搜标题和全文，支持 `#标签`、`kind:pdf`、`path:inbox` 等过滤条件，并带实时预览。智能文件夹按规则组织整个工作区，同一个文件可以出现在多个视图里而不必复制。标签就显示在正文上方，可以直接修改。`[[双向链接]]` 带反向链接、未链接提及和局部关系图。

**提炼**：所见即所得的 Markdown，支持高亮、任务列表、表格、带语法高亮的代码块，以及 KaTeX 渲染的 LaTeX 公式。斜杠命令、块拖拽、查找替换都在手边。

**表达**：任意笔记都能导出为 Markdown、单文件 HTML 或 PDF，选中的段落也可以分享成图片卡片。

## 认识你的助手

<!-- TODO(screenshots): docs/assets/assistant.png，对话窗口与笔记并排 -->

- **问你正在读的东西。** 助手跟着当前文档走，选中的文字可以直接发给它。
- **用对话整理工作区。** 移动、重命名之前，先和你商量去向和名字。改动可以撤销，撤销前会检查有没有更新的编辑。
- **按你的话整理标签和智能文件夹**，规则和应用其他地方完全一致。
- **用你自己的 AI。** 支持 Claude Code 和 Codex，可以用账号登录，也可以接 DeepSeek、智谱、Kimi、Anthropic、OpenAI 或自定义接口。密钥保存在 macOS 的安全存储里。
- **安静地待在一边。** 关掉窗口，它会变成一条悬浮的小鱼，告诉你它在忙、在等你，还是有了新回复。

## 安装

1. 从 [Releases](https://github.com/melo-libs/melo/releases/latest) 下载最新的 `.dmg`：Apple 芯片选 `arm64`，Intel 芯片选 `x64`。
2. 把 Melo 拖进"应用程序"并打开。
3. 选择一个文件夹作为工作区，已有的笔记文件夹也可以。笔记会留在原来的位置。

> [!NOTE]
> 安装包使用自签名证书，未经 Apple 公证。首次打开时，macOS 可能会要求你在 **系统设置 → 隐私与安全性** 中允许 Melo 运行。之后的更新可以直接在应用内安装。

## 参与贡献

欢迎提交 Bug、建议和 Pull Request。开发环境和约定请看 [CONTRIBUTING.md](CONTRIBUTING.md)，架构说明请看 [AGENTS.md](AGENTS.md)。提问和讨论想法请到[讨论区](https://github.com/melo-libs/melo/discussions)。如需报告安全问题，请参阅 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE) © 2026 Melo Labs
