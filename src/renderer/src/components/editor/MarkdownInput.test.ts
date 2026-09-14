import { describe, expect, it } from 'vitest'
import { normalizePastedMarkdown, shouldUseRichClipboardHtml } from './MarkdownInput'

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
