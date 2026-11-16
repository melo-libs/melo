<div align="center">

<img src="resources/icon.png" width="112" alt="Melo logo" />

# Melo

Mac 上的本地知识库：笔记、剪藏、PDF 和文档都放在一个文件夹里，旁边有个能陪你读、帮你整理的 AI

[下载](https://github.com/melo-libs/melo/releases/latest) · [官网](https://www.melolib.com) · [更新日志](CHANGELOG.md) · [English](README.md)

</div>

<!-- TODO(screenshots): 主界面大图 -->

## 特点

- **就是一个文件夹**：选一个文件夹开始，已有的笔记文件夹也行。笔记是里面的 `.md` 文件，图片放在 `.assets/`，不用注册账号，Melo 不上传任何东西
- **⌘K 剪藏**：在 `⌘K` 里粘贴文章链接，正文和图片存成一篇 Markdown，断网也能读
- **PDF 和文档**：PDF 直接读，图片和音视频直接看，Word、PPT 有缩略图，按空格快速预览。智能文件夹按类型、标签、日期把它们聚到一起，文件不用挪
- **所见即所得**：输入 `## ` 就是标题，`- [ ] ` 就是待办，表格、代码块、公式和 `[[双链]]` 都能写在同一篇笔记里
- **AI**：接 Claude Code 或 Codex，用你自己的账号，或者 DeepSeek、Kimi、智谱等服务的 API Key。它看得到你正在读的文档，可以追问、讨论；也能把收件箱里的附件归档、改名、打标签，动手前会先问你，改了能撤销
- **分享卡片**：选中一段话生成图片，复制后贴到微信或其他社交平台

<!-- TODO(screenshots): 剪藏、智能文件夹、AI 对话、分享卡片各一张 GIF -->

## 为什么做 Melo

Melo 的思路来自 Tiago Forte 在《打造第二大脑》里讲的 CODE：收集、整理、提炼、表达。我们用过的笔记工具，大多只管前两步，东西收进来之后就停在那儿了。Melo 想把后两步接上：读的时候能和 AI 把问题聊清楚，想明白的东西写下来，再分享出去。

## 几个取舍

**为什么是所见即所得？** 我们希望写的时候看到的就是写完的样子。文件本身还是标准 Markdown，换个编辑器打开，内容不会少。

**为什么不自己做 AI？** Claude Code 和 Codex 已经很强了，没必要再做一个。Melo 管的是它们不管的部分：该读哪个文件、对话记录存在哪、改错了怎么撤销。

**和 Obsidian 有什么不同？** Obsidian 很好，适合愿意自己挑插件、搭系统的人。Melo 把剪藏、文件管理、AI 和分享都做进了应用里，打开就能用。两者存的都是普通 Markdown，可以打开同一个文件夹一起用。

## 现在还做不到的

- 只有 macOS 版，没有 Windows 和手机端
- 没有云同步，备份就是复制整个文件夹，记得带上 `.assets` 和 `.melo`
- 有些网页剪藏不完整，没下载下来的图片要联网才能看
- AI 功能需要你自己的账号或 API Key，费用由对应的服务收取

## 安装

从 [GitHub Releases](https://github.com/melo-libs/melo/releases/latest) 下载最新的 DMG，Apple 芯片选 `arm64`，Intel 芯片选 `x64`。

安装包没有经过 Apple 公证，第一次打开如果提示无法验证，去「系统设置 → 隐私与安全性」点「仍要打开」。之后的版本可以在应用里直接更新。

## 参与

Melo 以 MIT 协议开源。有问题或想法可以提 [issue](https://github.com/melo-libs/melo/issues) 或者到 [讨论区](https://github.com/melo-libs/melo/discussions) 聊，想改代码先看 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。觉得好用的话，给个 Star，或者推荐给身边爱记笔记的朋友。
