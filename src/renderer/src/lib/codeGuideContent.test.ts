import { describe, expect, it } from 'vitest'
import {
  CODE_GUIDE_MARKER,
  CODE_GUIDE_VERSION,
  codeGuideAsset,
  hasCodeGuideMarker,
  isCodeGuideFilename,
  nextCodeGuideFilename,
} from './codeGuideContent'

describe('CODE guide content', () => {
  it('ships both languages as marked, editable Markdown capability tours', () => {
    for (const language of ['en', 'zh-CN']) {
      const asset = codeGuideAsset(language)
      expect(asset.filename.endsWith('.md')).toBe(true)
      expect(asset.content).toContain(CODE_GUIDE_MARKER)
      expect(asset.content).toContain(`melo-guide-version: ${CODE_GUIDE_VERSION}`)
      expect(hasCodeGuideMarker(asset.content)).toBe(true)
      for (const motion of ['Collect', 'Organize', 'Distill', 'Express']) {
        expect(asset.content).toContain(motion)
      }
      expect(asset.content).toContain('- [ ]')
      expect(asset.content).toContain('[[')
    }
  })

  it('does not mistake an ordinary CODE note for the Melo guide', () => {
    expect(hasCodeGuideMarker('# The CODE Method\n\nCollect and organize.')).toBe(false)
  })

  it('chooses a free filename without replacing a user file', () => {
    const existing = new Set(['Melo 的 CODE 理念.md', 'Melo 的 CODE 理念 2.md'])
    expect(nextCodeGuideFilename('Melo 的 CODE 理念.md', existing)).toBe('Melo 的 CODE 理念 3.md')
  })

  it('derives guide lookup names from the shipped assets', () => {
    expect(isCodeGuideFilename(codeGuideAsset('en').filename)).toBe(true)
    expect(isCodeGuideFilename(codeGuideAsset('zh-CN').filename)).toBe(true)
    expect(isCodeGuideFilename('The CODE Idea in Melo 2.md')).toBe(true)
    expect(isCodeGuideFilename('My CODE Notes.md')).toBe(false)
    expect(isCodeGuideFilename('Something Else Entirely 2.md')).toBe(false)
  })

  it('avoids case-only collisions on case-insensitive file systems', () => {
    const existing = new Set(['the code idea in melo.md', 'THE CODE IDEA IN MELO 2.MD'])
    expect(nextCodeGuideFilename('The CODE Idea in Melo.md', existing)).toBe(
      'The CODE Idea in Melo 3.md',
    )
  })
})
