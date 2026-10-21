import { describe, expect, it } from 'vitest'
import { version } from '../../../../package.json'
import { MarkdownManager } from '@tiptap/markdown'
import type { JSONContent } from '@tiptap/core'
import { editorExtensions } from '../components/editor/tiptapExtensions'
import { splitFrontmatter } from './frontmatter'
import { parseQuery } from '../components/search/searchEngine'
import {
  CODE_GUIDE_MARKER,
  CODE_GUIDE_VERSION,
  codeGuideAsset,
  hasCodeGuideMarker,
  isCodeGuideFilename,
  nextCodeGuideFilename,
} from './codeGuideContent'

const manager = new MarkdownManager({ extensions: editorExtensions })
const allNodes = (node: JSONContent): JSONContent[] => [
  node,
  ...(node.content ?? []).flatMap(allNodes),
]

describe('user guide content', () => {
  it('ships both languages as marked, versioned Markdown manuals', () => {
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
      expect(asset.content).toContain(`Melo ${version}`)
      expect(asset.content).not.toMatch(/\{\{.*?\}\}/)
    }
  })

  it('uses the selected language for the document and its filename', () => {
    expect(codeGuideAsset('en').filename).toBe('Melo User Guide.md')
    expect(codeGuideAsset('zh-CN').filename).toBe('Melo 使用指南.md')
    expect(codeGuideAsset('zh-TW')).toEqual(codeGuideAsset('zh-CN'))
    expect(codeGuideAsset('fr')).toEqual(codeGuideAsset('en'))
  })

  it('keeps draft-saving shortcuts out of the quick-start checklist', () => {
    for (const language of ['en', 'zh-CN']) {
      const content = codeGuideAsset(language).content
      const firstSection = content.split('\n## ')[1]
      expect(firstSection).toBeDefined()
      expect(firstSection).not.toContain('⌘N')
      expect(content).toContain('⌘N')
      expect(content).toContain('⌘S')
    }
  })

  it.each(['en', 'zh-CN'])(
    'parses %s examples with the real editor schema and round-trips them',
    (language) => {
      const { frontmatter, body } = splitFrontmatter(codeGuideAsset(language).content)
      expect(hasCodeGuideMarker(frontmatter)).toBe(true)
      expect(body.startsWith('# ')).toBe(true)
      expect(body).not.toContain(CODE_GUIDE_MARKER)
      expect(body).not.toContain('melo-guide-version:')
      const doc = manager.parse(body)
      const nodes = allNodes(doc)
      for (const type of ['heading', 'taskList', 'table', 'codeBlock', 'blockMath', 'inlineMath']) {
        expect(
          nodes.some((node) => node.type === type),
          type,
        ).toBe(true)
      }
      expect(
        nodes.filter((node) => node.type === 'heading' && node.attrs?.level === 1),
      ).toHaveLength(1)
      // Examples must not introduce unresolved links to fictional notes.
      expect(nodes.filter((node) => node.type === 'wikilink')).toHaveLength(0)
      const second = allNodes(manager.parse(manager.serialize(doc)))
      for (const type of ['table', 'blockMath', 'inlineMath', 'codeBlock']) {
        expect(second.filter((node) => node.type === type)).toEqual(
          nodes.filter((node) => node.type === type),
        )
      }
    },
  )

  it('retains the released first-use marker so content changes do not reopen the guide', () => {
    expect(CODE_GUIDE_VERSION).toBe(1)
  })

  it('demonstrates filters accepted by the search parser', () => {
    for (const language of ['en', 'zh-CN']) {
      const content = codeGuideAsset(language).content
      for (const query of ['#melo', 'kind:pdf', 'path:Inbox']) {
        expect(content).toContain(`\`${query}\``)
      }
    }
    expect(parseQuery('#melo').ops.tag).toEqual(['melo'])
    expect(parseQuery('kind:pdf').ops.kind).toBe('pdf')
    expect(parseQuery('path:Inbox').ops.path).toBe('inbox')
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
    expect(isCodeGuideFilename('Melo 的 CODE 理念.md')).toBe(true)
    expect(isCodeGuideFilename('Melo 的 CODE 理念 2.md')).toBe(true)
    expect(isCodeGuideFilename('Melo 使用指南 2.md')).toBe(true)
    expect(isCodeGuideFilename('MELO USER GUIDE 3.MD')).toBe(true)
    expect(isCodeGuideFilename('Melo User Guide draft.md')).toBe(false)
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
