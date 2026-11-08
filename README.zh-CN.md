<div align="center">

<img src="resources/icon.png" width="112" alt="Melo logo" />

# Melo

**把读到的、想到的，变成真正属于你自己的知识。**

[**下载 macOS 版**](https://github.com/melo-libs/melo/releases/latest) · [官网](https://www.melolib.com) · [更新日志](CHANGELOG.md)

[English](README.md) | 简体中文

[![最新版本](https://img.shields.io/github/v/release/melo-libs/melo?label=release&color=f5b301)](https://github.com/melo-libs/melo/releases/latest)
[![下载量](https://img.shields.io/github/downloads/melo-libs/melo/total?color=f5b301)](https://github.com/melo-libs/melo/releases)
[![License: MIT](https://img.shields.io/github/license/melo-libs/melo?color=blue)](LICENSE)

</div>

<!-- TODO(screenshots): 主界面大图或短 GIF -->

你大概也有这样的经历：看到一篇好文章，先存起来，打算以后再读；论文、PDF、截图越攒越多，散落在下载文件夹、聊天记录和各种 App 里。东西存了不少，真正读懂、想明白、能用自己的话讲出来的，却没有几样。

Melo 想帮你把这件事做完：从看到一篇好东西开始，到把它变成你自己的理解，再到分享给别人。它是你的第二大脑，而思考，留给你自己。

## 看到好文章，先留下来

在 Melo 里按 `⌘K`，粘贴文章链接，正文和图片就会保存到你的电脑上，变成一篇干净的笔记。以后断网也能读，原网页没了也不怕。

<!-- TODO(screenshots): 剪藏 -->

## 所有资料，都在一个地方

不只是笔记。论文 PDF、合同 Word、方案 PPT、图片和视频，都可以放进同一个工作区，用你熟悉的文件夹来管理。

想找东西时，按 `⌘K` 搜一下，标题和正文都能搜到。想把散在各处的资料聚到一起，比如"所有 PDF"或者"带 AI 标签的笔记"，建一个智能文件夹就行，文件不用挪动，也不用复制。

<!-- TODO(screenshots): 文件管理与智能文件夹 -->

## 读不懂的地方，和 AI 聊透

读到一半有疑问，选中那段文字，直接问 Melo。它知道你正在读什么，可以陪你追问、讨论、换个角度解释，直到你真正弄明白。

想明白的东西，随手写下来。Melo 的编辑器所见即所得，标题、列表、表格、代码、公式都能直接写，不用记任何格式符号。

整理的杂活也可以交给它：这个附件该放哪、叫什么名字、打什么标签。它会先和你商量，你同意了才动手，改错了也能撤销。

<!-- TODO(screenshots): AI 对话窗口与笔记并排 -->

## 好想法，分享出去

读到一句打动你的话，或者写出了一段满意的想法，选中它，Melo 会生成一张精美的分享卡片。复制之后，直接粘贴到微信、朋友圈或任何社交应用。

当然，也可以把整篇笔记导出成 Markdown、HTML 或 PDF。

<!-- TODO(screenshots): 分享卡片 -->

---

从收集，到整理，到想明白，再到表达，我们把这个过程叫作 **CODE**（Collect、Organize、Distill、Express）。Melo 的每一个功能，都是为了帮你把一份资料往下推一步，让它最终变成你自己的知识。

## 我们的几个坚持

- **你的文件永远是你的。** 笔记就是你电脑上普通的 Markdown 文件，没有账号，不上传云端。哪天不用 Melo 了，文件原样还在，用任何编辑器都能打开。
- **AI 是陪你思考的伙伴，不是替你思考。** 它帮你读懂、帮你打理，但想法和结论属于你。
- **打开就能用。** 剪藏、搜索、PDF 阅读、分享卡片都是内置的，不需要折腾插件和设置。

## 常见问题

**和 Obsidian 有什么不同？**
Obsidian 是一个很强大的工具箱，适合喜欢自己动手搭系统的人：选插件、写模板、设计目录结构。Melo 走的是另一条路，从收集到分享的整个流程都已经设计好，打开就能用，你可以把时间花在内容上。另外，Melo 是开源的，除了笔记还能管理 PDF、Office 文档这些资料。两者存的都是普通 Markdown 文件，你也可以同时使用。

**要花钱吗？**
Melo 本身免费，并且以 MIT 协议开源。AI 功能需要你自己的 Claude 或 ChatGPT 账号，也可以填 DeepSeek、智谱、Kimi 等服务的 API Key，费用由对应的服务收取。

**我的数据存在哪里？**
就在你选的那个文件夹里，Melo 不会把它上传到任何地方。AI 只有在你提问或交给它任务时，才会读取相关内容。Melo 本身不提供云同步，备份时连同文件夹一起复制即可。

**支持 Windows 吗？**
目前只发布了 macOS 版，Apple 芯片和 Intel 芯片都支持。

## 安装

从 [Releases](https://github.com/melo-libs/melo/releases/latest) 下载最新的 `.dmg`（Apple 芯片选 `arm64`，Intel 芯片选 `x64`），拖进"应用程序"后打开，选一个文件夹作为你的工作区就可以开始了。已有的笔记文件夹也可以直接用。

> [!NOTE]
> 安装包没有经过 Apple 公证。第一次打开时，如果 macOS 提示无法验证，请到 **系统设置 → 隐私与安全性** 中点"仍要打开"。之后的更新可以在应用内直接安装。

## 参与贡献

欢迎反馈问题、提出建议，也欢迎提交代码。开发说明请看 [CONTRIBUTING.md](CONTRIBUTING.md)，想法和问题可以到[讨论区](https://github.com/melo-libs/melo/discussions)聊。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

[MIT](LICENSE) © 2026 Melo Labs
