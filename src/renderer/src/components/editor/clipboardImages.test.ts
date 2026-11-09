import { describe, expect, it } from 'vitest'
import { parseHTML } from 'linkedom'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { getSchema } from '@tiptap/core'
import { editorExtensions } from './tiptapExtensions'
import { clipboardWorkspaceKey } from '@shared/clipboard'
import { restoreClipboardImageSources } from './clipboardImages'

const workspace = '/notes'
const html = `<p data-pm-slice="1 1 []"><img src="data:image/png;base64,AQID" data-melo-image-src=".assets/image.png" data-melo-image-workspace="${clipboardWorkspaceKey(workspace)}"></p>`
const document = parseHTML('<html><body></body></html>').document as unknown as Document

describe('clipboard image provenance', () => {
  it('keeps schema HTML parsing independent of workspace provenance', () => {
    const source = document.createElement('div')
    source.innerHTML = html
    const doc = PMDOMParser.fromSchema(getSchema(editorExtensions)).parse(source)
    expect(doc.firstChild!.firstChild!.attrs.src).toBe('data:image/png;base64,AQID')
  })

  it('restores same-workspace sources only at the clipboard boundary', () => {
    const restored = restoreClipboardImageSources(html, workspace, document)
    expect(restored).toContain('src=".assets/image.png"')
    expect(restored).toContain('data-pm-slice="1 1 []"')
    expect(restoreClipboardImageSources(html, '/other-notes', document)).toBe(html)
    expect(restoreClipboardImageSources(html, '', document)).toBe(html)
  })

  it.each(['../secret.png', '/private/secret.png', 'file:///private/image.png', '..\\secret.png'])(
    'does not restore unsafe provenance: %s',
    (src) => {
      const unsafe = html.replace('.assets/image.png', src)
      expect(restoreClipboardImageSources(unsafe, workspace, document)).toBe(unsafe)
    },
  )

  it('preserves the table fragment and native slice marker', () => {
    const row = `<tr data-pm-slice="1 1 []"><td>${html}</td></tr>`
    const restored = restoreClipboardImageSources(row, workspace, document)
    expect(restored).toContain('<tr data-pm-slice="1 1 []">')
    expect(restored).toContain('<td>')
    expect(restored).toContain('src=".assets/image.png"')
  })
})
