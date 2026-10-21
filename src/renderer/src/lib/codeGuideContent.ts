import { version } from '../../../../package.json'
import englishGuide from '../assets/guides/melo.en.md?raw'
import chineseGuide from '../assets/guides/melo.zh-CN.md?raw'

// This is the first-use marker, not the content revision. Updating the manual
// must not reopen it for people who have already received their own copy.
export const CODE_GUIDE_VERSION = 1
export const CODE_GUIDE_MARKER = 'melo-guide: code'

export interface CodeGuideAsset {
  filename: string
  content: string
}

const EN = { filename: 'Melo User Guide.md', body: englishGuide }
const ZH = { filename: 'Melo 使用指南.md', body: chineseGuide }
export const codeGuideAsset = (language: string): CodeGuideAsset => {
  const guide = language.toLowerCase().startsWith('zh') ? ZH : EN
  const body = guide.body.replaceAll('{{appVersion}}', version)
  return {
    filename: guide.filename,
    content: `---\n${CODE_GUIDE_MARKER}\nmelo-guide-version: ${CODE_GUIDE_VERSION}\n---\n\n${body}`,
  }
}

const guideFilenames = [
  EN.filename,
  ZH.filename,
  // Released guides belong to users. Help must still find their old copies.
  'The CODE Idea in Melo.md',
  'Melo 的 CODE 理念.md',
]
const guideStems = guideFilenames.map((name) => name.slice(0, -3).toLowerCase())

/** Recognize shipped guide names and their numbered collision variants. */
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
