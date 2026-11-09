import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { Slice } from '@tiptap/pm/model'
import { editorExtensions } from './tiptapExtensions'
import {
  chooseClipboardPaste,
  normalizePastedMarkdown,
  shouldUseRichClipboardHtml,
} from './clipboardPasteRules'

const schema = getSchema(editorExtensions)
const manager = new MarkdownManager({ extensions: editorExtensions })
const slice = (markdown: string) =>
  new Slice(schema.nodeFromJSON(manager.parse(markdown)).content, 0, 0)
const input = { html: '', text: '', hasImageFiles: false, plain: false, inCode: false }

describe('clipboard format decision', () => {
  it('preserves native slices, including literal punctuation and local images', () => {
    expect(
      chooseClipboardPaste(
        {
          ...input,
          html: '<p data-pm-slice="1 1 []"># literal</p>',
          text: '# literal',
          hasImageFiles: true,
        },
        slice('# literal'),
      ),
    ).toBe('native')
  })

  it('imports embedded images before native slice restoration or bitmap alternatives', () => {
    const content = slice('Before ![Image](data:image/png;base64,AQID) after')
    expect(chooseClipboardPaste(input, content)).toBe('embedded-images')
    expect(
      chooseClipboardPaste(
        { ...input, html: '<p data-pm-slice="1 1 []">Image</p>', hasImageFiles: true },
        content,
      ),
    ).toBe('embedded-images')
  })

  it('uses files only when there is no usable rich selection', () => {
    expect(
      chooseClipboardPaste(
        { ...input, hasImageFiles: true, text: 'alt fallback' },
        slice('alt fallback'),
      ),
    ).toBe('files')
    expect(
      chooseClipboardPaste({ ...input, html: '<p><br></p>', hasImageFiles: true }, slice('')),
    ).toBe('files')
    expect(
      chooseClipboardPaste(
        { ...input, html: '<img src="https://example.com/a.png">', hasImageFiles: true },
        slice('![Image](https://example.com/a.png)'),
      ),
    ).toBe('files')
  })

  it('prefers complete text/table HTML over a bitmap preview', () => {
    expect(
      chooseClipboardPaste(
        { ...input, html: '<p>Before<img>After</p>', hasImageFiles: true },
        slice('Before ![Image](https://example.com/a.png) after'),
      ),
    ).toBe('native')
    expect(
      chooseClipboardPaste(
        {
          ...input,
          html: '<table><tr><td>One</td></tr></table>',
          text: 'One',
          hasImageFiles: true,
        },
        slice('| One |\n| --- |'),
      ),
    ).toBe('native')
  })

  it('keeps rich HTML literal even when its text resembles Markdown', () => {
    expect(
      chooseClipboardPaste(
        { ...input, html: '<p># literal heading</p>', text: '# literal heading' },
        slice('# literal heading'),
      ),
    ).toBe('native')
    expect(
      chooseClipboardPaste(
        { ...input, html: '<pre><code># code</code></pre>', text: '# code' },
        slice('# code'),
      ),
    ).toBe('native')
  })

  it('falls back to text when HTML only contains empty paragraphs or line breaks', () => {
    for (const html of ['<p></p>', '<p><br></p>', '<p> </p>']) {
      expect(
        chooseClipboardPaste({ ...input, html, text: 'Actual clipboard text' }, slice('')),
      ).toBe('markdown')
    }
  })

  it('keeps standalone HTML images without requiring a text flavor or bitmap', () => {
    expect(
      chooseClipboardPaste(
        { ...input, html: '<img src="https://example.com/image.svg">' },
        slice('![](https://example.com/image.svg)'),
      ),
    ).toBe('native')
  })

  it('parses text and terminal wrappers only when no full HTML representation exists', () => {
    expect(chooseClipboardPaste({ ...input, text: '# Markdown' }, slice(''))).toBe('markdown')
    expect(
      chooseClipboardPaste(
        {
          ...input,
          html: '<div>## Notes</div><div>- <a href="https://example.com">https://example.com</a></div>',
          text: '## Notes\n- https://example.com',
        },
        slice(''),
      ),
    ).toBe('markdown')
  })

  it('leaves plain paste, code blocks and empty clipboards to ProseMirror', () => {
    expect(
      chooseClipboardPaste(
        { ...input, text: '# literal', plain: true, hasImageFiles: true },
        slice(''),
      ),
    ).toBe('native')
    expect(
      chooseClipboardPaste(
        { ...input, text: '# literal', inCode: true, hasImageFiles: true },
        slice(''),
      ),
    ).toBe('native')
    expect(chooseClipboardPaste(input, slice(''))).toBe('native')
  })
})

describe('terminal Markdown paste', () => {
  it('prefers Markdown source when terminal HTML only enriches its URLs', () => {
    const text = '## Notes\n\n- Read https://example.com'
    const html =
      '<div>## Notes</div><div>- Read <a href="https://example.com">https://example.com</a></div>'

    expect(shouldUseRichClipboardHtml(html, text)).toBe(false)
  })

  it('keeps genuinely rendered rich text on the HTML paste path', () => {
    expect(shouldUseRichClipboardHtml('<p>Read <strong>this</strong></p>', 'Read this')).toBe(true)
    expect(
      shouldUseRichClipboardHtml('<h2>Notes</h2><ul><li>Read this</li></ul>', 'Notes\nRead this'),
    ).toBe(true)
  })

  it('keeps structured rich HTML even when its text resembles Markdown', () => {
    const html = '<h2>Notes</h2><ul><li>- a literal dash</li></ul>'
    expect(shouldUseRichClipboardHtml(html, 'Notes\n- a literal dash')).toBe(true)
  })

  it('converts terminal-style em-dash dividers to Markdown', () => {
    expect(normalizePastedMarkdown('正文\n\n  ———\n\n结论')).toBe('正文\n\n  ---\n\n结论')
  })

  it('does not reinterpret terminal tables, diagrams or prose', () => {
    const input =
      '使用场景  能力评价\n━━━━━━━━  ━━━━━━\n普通会议  中等\n────────  ──────\n录音文件\n  ↓\nSenseVoice 逐段识别\n这是一段——普通文字'
    expect(normalizePastedMarkdown(input)).toBe(input)
  })

  it('does not rewrite dividers inside fenced or indented code', () => {
    const input = [
      '```text',
      '———',
      '```',
      '',
      '~~~',
      '———',
      '~~~',
      '',
      '    ———',
      '\t———',
      '',
      '———',
    ].join('\n')
    const expected = input.replace(/———$/, '---')

    expect(normalizePastedMarkdown(input)).toBe(expected)
  })
})
