<div align="center">

<img src="resources/icon.png" width="112" alt="Melo logo" />

# Melo

**把读到的、想到的，变成真正属于你自己的知识。**

你的第二大脑：笔记、网页剪藏、PDF、文档和图片都放在一处，<br />
和 AI 一起把它们读懂、想透，再分享出去。本地优先，适用于 macOS。

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

我们收藏的东西从来没有这么多过：稍后读、截图、PDF、剪藏、聊天里转发的链接。真正被我们读懂、想明白、能用自己的话讲出来的，却少得可怜。信息越来越多，属于自己的知识并没有跟着变多。

今天的笔记工具都很擅长"存"。Obsidian 更是把这件事做到了极致：一个本地文件夹，加上一千个插件，你可以搭出任何你想要的系统。但搭系统、维护系统本身就是一份工作，很多人花在"整理笔记的系统"上的时间，比花在思考上的还多。而且它管的主要是 Markdown，PDF、文档、图片依然散落在各处。

**Melo 想做的，是把更多时间留给思考，帮你把信息真正转化成个人的知识。** 为此，我们围绕 CODE 构建了一整套体系。

## CODE：从信息到知识

CODE 是四个动作：**收集（Collect）、整理（Organize）、提炼（Distill）、表达（Express）**。它不是一张必须依次完成的清单，而是一个可以从任何地方进入的循环。

- **收集**：好文章不该止于惊鸿一瞥。按 `⌘K` 粘贴链接，正文和图片一起存到本地。PDF、Word、PPT、图片、视频，也都放进同一个工作区。
- **整理**：用熟悉的文件夹管理，用智能文件夹按条件聚合，用 `⌘K` 搜标题和正文。为接下来要做的事整理，而不是追求一个完美的分类法。也可以把整理的杂活交给 AI。
- **提炼**：自己动手写，把想法沉淀下来；也可以和 AI 围绕正在读的内容深入探讨，追问、辩论、换个角度，直到真正理解。
- **表达**：把理解变成可以离开笔记本的成果。写成文章导出，或者选中一段文字，生成一张精美的分享卡片，发给朋友、发到社交媒体。

## 设计哲学

**1. 第二大脑，不止笔记。**
知识不只存在于 Markdown 里。读过的论文、收到的合同、做过的 PPT、拍下的白板，都是你知识的一部分。Melo 把它们放在一处管理，统一搜索，统一组织。

**2. 你的文件，你的文件夹。**
每篇笔记都是一个普通的 `.md` 文件，所有资料都留在你选定的文件夹里。没有私有格式，没有账号，没有云端锁定。换个应用打开，内容一个字都不会少。

**3. AI 是思考的伙伴，而不是代笔。**
AI 在 Melo 里做两件事：替你打理杂务，比如归档、命名、打标签；陪你深入探讨，帮你把一篇文章、一个问题真正想明白。但思考的过程和沉淀下来的知识，始终是你的。所以 AI 的每一处改动都先和你商量，可以撤销。

**4. 好想法值得被分享。**
知识在被表达时才真正完成。分享卡片是我们花了很多心思打磨的功能：选中一句话、一段观点，就能生成一张好看的图片，复制后直接粘贴到聊天或社交应用里。

**5. 开箱即用，所见即所得。**
剪藏、PDF 阅读、全文搜索、智能文件夹、双向链接，第一天就在，不需要去插件市场里挑。编辑器是真正的所见即所得，没有满屏的 `#` 和 `**`，Markdown 安静地待在底层。我们宁可替你把默认做对，也不把一千个开关交给你。

**6. 用最好的 AI，而不是再造一个。**
Melo 不训练自己的模型，也不自己写一套 agent。它把 Claude Code、Codex 这些最强的 agent 请进你的知识库，可以用你自己的账号，也可以用 API。Melo 负责 agent 不擅长的部分：你的文件、上下文、对话历史和撤销。

## Melo 和 Obsidian

如果你享受亲手搭建、不断调校自己的系统，Obsidian 是很好的选择。Melo 是为另一类人准备的：想要一个开箱就顺手的第二大脑，把时间花在理解和表达上，而不是工具上。

|          | Obsidian                                    | Melo                                               |
| -------- | ------------------------------------------- | -------------------------------------------------- |
| 思路     | 工具箱：你来搭系统                          | 第二大脑：围绕 CODE 设计好的完整流程               |
| 管理范围 | 以 Markdown 笔记为中心                      | 笔记之外，PDF、Word、PPT、图片、视频统一管理       |
| 编辑     | Markdown 源码 / 实时预览                    | 真正的所见即所得                                   |
| 收集     | 官方浏览器扩展 Web Clipper                  | 在 `⌘K` 里粘贴网址即可剪藏，图片一并存到本地       |
| 整理     | 文件夹、标签、Bases 视图，自己设计和维护    | 智能文件夹，加上 AI 帮你归档、命名、打标签         |
| AI       | 第三方插件                                  | 原生集成 Claude Code / Codex，围绕当前内容深入探讨 |
| 分享     | 导出 PDF；网页发布需付费的 Obsidian Publish | 导出 Markdown / HTML / PDF，或一键生成分享卡片     |
| 扩展方式 | 庞大的插件生态                              | 少而精的内置功能                                   |
| 源代码   | 闭源（个人使用免费）                        | MIT 开源                                           |
| 你的数据 | 本地 Markdown 文件夹                        | 本地文件夹                                         |

两者读写的都是普通的 Markdown 文件，所以**你不必二选一**：同一个文件夹可以同时用 Obsidian 和 Melo 打开。

## 功能一览

<!-- TODO(screenshots): 每部分配一张图，例如 docs/assets/collect.png -->

**收集**：在 `⌘K` 面板粘贴网址，正文连同图片存成 Markdown，离线也能读。截图和图片可以直接粘贴、拖入。附件可以直接拖给 AI，先进收件箱，等着被整理。

**整理**：`⌘K` 同时搜标题和全文，支持 `#标签`、`kind:pdf`、`path:inbox` 等过滤条件，并带实时预览。智能文件夹按规则组织整个工作区，同一个文件可以出现在多个视图里而不必复制。标签显示在正文上方，可以直接修改。`[[双向链接]]` 带反向链接、未链接提及和局部关系图。PDF 直接阅读，图片、音视频直接查看，Office 文档带缩略图，按空格即可快速预览。

**提炼**：所见即所得的 Markdown，支持高亮、任务列表、表格、带语法高亮的代码块，以及 KaTeX 渲染的 LaTeX 公式。斜杠命令、块拖拽、查找替换都在手边。

**表达**：选中文字生成分享卡片，复制即可粘贴分享。任意笔记都能导出为 Markdown、单文件 HTML 或 PDF。

## 认识你的 AI 伙伴

<!-- TODO(screenshots): docs/assets/assistant.png，对话窗口与笔记并排 -->

- **和你一起读。** AI 跟着当前文档走，选中的文字可以直接发给它。追问、讨论、换个角度，直到你真正理解。
- **替你整理。** 移动、重命名之前，先和你商量去向和名字。改动可以撤销，撤销前会检查有没有更新的编辑。标签和智能文件夹也可以交给它，规则和应用其他地方完全一致。
- **用你自己的 AI。** 支持 Claude Code 和 Codex，可以用账号登录，也可以接 DeepSeek、智谱、Kimi、Anthropic、OpenAI 或自定义接口。密钥保存在 macOS 的安全存储里。
- **安静地待在一边。** 关掉窗口，它会变成一条悬浮的小鱼，告诉你它在忙、在等你，还是有了新回复。

## 安装

1. 从 [Releases](https://github.com/melo-libs/melo/releases/latest) 下载最新的 `.dmg`：Apple 芯片选 `arm64`，Intel 芯片选 `x64`。
2. 把 Melo 拖进"应用程序"并打开。
3. 选择一个文件夹作为工作区，已有的笔记文件夹也可以。所有文件都会留在原来的位置。

> [!NOTE]
> 安装包使用自签名证书，未经 Apple 公证。首次打开时，macOS 可能会要求你在 **系统设置 → 隐私与安全性** 中允许 Melo 运行。之后的更新可以直接在应用内安装。

## 参与贡献

欢迎提交 Bug、建议和 Pull Request。开发环境和约定请看 [CONTRIBUTING.md](CONTRIBUTING.md)，架构说明请看 [AGENTS.md](AGENTS.md)。提问和讨论想法请到[讨论区](https://github.com/melo-libs/melo/discussions)。如需报告安全问题，请参阅 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE) © 2026 Melo Labs
