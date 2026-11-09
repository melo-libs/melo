import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHTML } from 'linkedom'
import { getSchema } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { editorExtensions } from '../tiptapExtensions'
import { handleDocumentLinkClick, selectedLinkHref } from './LinkNavigation'

import { openDocumentLink } from '../../../lib/documentLinks'
vi.mock('../../../lib/documentLinks', () => ({ openDocumentLink: vi.fn() }))
const open = vi.mocked(openDocumentLink)
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
  vi.stubGlobal('window', { open })
})
afterEach(() => vi.unstubAllGlobals())

function click(options: Partial<MouseEvent> = {}, editable = true, href = 'https://example.com/') {
  const { document } = parseHTML('<main><a><strong>Link</strong></a></main>')
  const dom = document.querySelector('main')! as unknown as HTMLElement
  dom.querySelector('a')!.setAttribute('href', href)
  const event = {
    target: dom.querySelector('strong'),
    button: 0,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...options,
  }
  const handled = handleDocumentLinkClick({ dom, editable }, event as unknown as MouseEvent)
  return { handled, event }
}

describe('external link navigation', () => {
  it('keeps ordinary editable clicks available for editing', () => {
    const { handled, event } = click()
    expect(handled).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('opens nested link text on Command-click on macOS', () => {
    const { handled, event } = click({ metaKey: true })
    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith('https://example.com/', expect.anything())
  })

  it('uses Control-click on Windows and preserves macOS Control-click', () => {
    expect(click({ ctrlKey: true }).handled).toBe(false)
    expect(click({ ctrlKey: true }, false).handled).toBe(false)
    vi.stubGlobal('navigator', { platform: 'Win32' })
    expect(click({ ctrlKey: true }).handled).toBe(true)
    expect(open).toHaveBeenCalledOnce()
  })

  it('opens read-only links with an ordinary click', () => {
    expect(click({}, false).handled).toBe(true)
    expect(open).toHaveBeenCalledOnce()
  })

  it.each([
    { button: 2, metaKey: true },
    { metaKey: true, shiftKey: true },
    { metaKey: true, altKey: true },
  ])('leaves other mouse gestures alone: %o', (modifiers) => {
    expect(click(modifiers).handled).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///private/note.md',
    '../note.md',
    '#heading',
  ])('routes stored hrefs through navigation with feedback: %s', (url) => {
    const { event } = click({ metaKey: true }, true, url)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(open).toHaveBeenCalledWith(url, expect.anything())
  })

  it('does not open wikilinks through the external route', () => {
    const { document } = parseHTML(
      '<main><a class="wikilink" href="https://example.com">Note</a></main>',
    )
    const dom = document.querySelector('main')! as unknown as HTMLElement
    expect(
      handleDocumentLinkClick({ dom, editable: false }, {
        target: dom.firstChild,
        button: 0,
      } as unknown as MouseEvent),
    ).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})

describe('selected link target', () => {
  const schema = getSchema(editorExtensions)
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('Before '),
      schema.text('First', [schema.marks.link.create({ href: 'https://first.example/' })]),
      schema.text(' between '),
      schema.text('Second', [schema.marks.link.create({ href: 'https://second.example/' })]),
    ]),
  ])
  const selected = (from: number, to = from) =>
    selectedLinkHref(EditorState.create({ doc, selection: TextSelection.create(doc, from, to) }))

  it('finds the link containing a caret or partial text selection', () => {
    expect(selected(9)).toBe('https://first.example/')
    expect(selected(8, 11)).toBe('https://first.example/')
  })

  it('does not pick an arbitrary URL when the selection spans multiple links or plain text', () => {
    expect(selected(8, 26)).toBeNull()
    expect(selected(2, 11)).toBeNull()
  })

  it('does not show navigation for a plain-text caret or just outside the link', () => {
    expect(selected(2)).toBeNull()
    expect(selected(14)).toBeNull()
  })
})
