export const CODE_GUIDE_VERSION = 1
export const CODE_GUIDE_MARKER = 'melo-guide: code'

export interface CodeGuideAsset {
  filename: string
  content: string
}

const EN: CodeGuideAsset = {
  filename: 'The CODE Idea in Melo.md',
  content: `---
${CODE_GUIDE_MARKER}
melo-guide-version: ${CODE_GUIDE_VERSION}
---

# The CODE Idea in Melo

Melo keeps reading, thinking and writing close to the files you already own. **CODE** names four motions that help those files become useful work.

> CODE is not a checklist to finish in order. Collect, Organize, Distill and Express form a loop you can enter anywhere.

## Collect

Capture before the thought disappears.

- Press ⌘K and paste an article URL to save a clean Markdown clipping.
- Paste screenshots or drag files directly into the workspace.
- [ ] Add one thing you want to return to later.

## Organize

Give useful things enough context to find them again.

- Keep undecided material in **Inbox**.
- Use folders, tags, [[links between notes]] and Smart Folders when they help.
- Organize for the work ahead, not for a perfect taxonomy.

## Distill

Return to what matters and remove the noise.

- Highlight the lines worth keeping.
- Rewrite long material in your own words.
- Let headings and short summaries reveal the structure.

## Express

Turn what you have learned into something that can leave the notebook.

- Develop a note into a draft, outline or brief.
- Export it as Markdown, HTML or PDF, or share it as an image.

---

This guide is an ordinary Markdown file. Edit it, move it or delete it whenever you like — Melo will not overwrite your changes.
`,
}

const ZH: CodeGuideAsset = {
  filename: 'Melo 的 CODE 理念.md',
  content: `---
${CODE_GUIDE_MARKER}
melo-guide-version: ${CODE_GUIDE_VERSION}
---

# Melo 的 CODE 理念

Melo 让阅读、思考和写作都留在你已有的文件旁边。**CODE** 是四个简单的动作，让收进来的内容慢慢变成可以使用的成果。

> CODE 不是一张必须依次完成的清单。收集、整理、提炼、表达构成一个循环，你可以从任何地方开始。

## Collect · 收集

先接住信息，不让想法溜走。

- 按 ⌘K 粘贴文章链接，将正文剪藏为干净的 Markdown。
- 直接粘贴截图，或把其他文件拖进工作区。
- [ ] 放进一件你之后还想回来的内容。

## Organize · 整理

补上必要的上下文，让有用的内容以后还能找到。

- 暂时不知道放哪里的内容，可以先留在 **Inbox**。
- 在需要时使用文件夹、标签、[[笔记链接]]和智能文件夹。
- 为接下来要做的事整理，而不是追求完美分类。

## Distill · 提炼

回到真正重要的部分，逐渐拿掉噪音。

- 高亮值得保留的句子。
- 用自己的话重写长内容。
- 用标题和短摘要呈现结构。

## Express · 表达

把理解变成可以离开笔记本的成果。

- 将笔记继续写成草稿、提纲或简报。
- 导出为 Markdown、HTML 或 PDF，也可以分享为图片。

---

这篇指南本身就是普通的 Markdown 文件。你可以随意修改、移动或删除；Melo 不会覆盖你的改动。
`,
}

export const codeGuideAsset = (language: string): CodeGuideAsset =>
  language.toLowerCase().startsWith('zh') ? ZH : EN

const guideFilenames = [EN.filename, ZH.filename]
const guideStems = guideFilenames.map((name) => name.slice(0, -3).toLowerCase())

/** Recognize only shipped guide names and the numbered collision variants.
 *  The stems derive from the assets so changing a preset filename cannot
 *  silently desynchronize Help's lookup logic. */
export const isCodeGuideFilename = (name: string): boolean => {
  const lower = name.toLowerCase()
  if (!lower.endsWith('.md')) return false
  const stem = lower.slice(0, -3)
  return guideStems.some((guideStem) => {
    if (stem === guideStem) return true
    if (!stem.startsWith(guideStem)) return false
    const suffix = stem.slice(guideStem.length)
    return /^ \d+$/.test(suffix)
  })
}

export const hasCodeGuideMarker = (content: string): boolean =>
  /^melo-guide:\s*code\s*$/m.test(content)

export const nextCodeGuideFilename = (preferred: string, existingNames: Set<string>): string => {
  const normalized = new Set([...existingNames].map((name) => name.toLowerCase()))
  if (!normalized.has(preferred.toLowerCase())) return preferred
  const dot = preferred.toLowerCase().endsWith('.md') ? preferred.length - 3 : preferred.length
  const stem = preferred.slice(0, dot)
  const ext = preferred.slice(dot)
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${stem} ${suffix}${ext}`
    if (!normalized.has(candidate.toLowerCase())) return candidate
  }
  return `${stem} ${Date.now()}${ext}`
}
