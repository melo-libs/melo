import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHTML } from 'linkedom'
import { IpcChannels } from '@shared/types/ipc'
import { appStore } from '../store/appStore'
import { activeTabIdAtom, tabsAtom } from '../store/editor'
import { displayedMetadataAtom } from '../store/documentSession'
import { activeSmartIdAtom } from '../store/smart'
import { revealDirectoryAtom, treeSelectionAtom, workspacePathAtom } from '../store/workspace'
import { toast } from '../components/Toaster'
import {
  applyPendingDocumentFragment,
  openDocumentLink,
  scrollToDocumentFragment,
} from './documentLinks'

vi.mock('../i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../components/Toaster', () => ({ toast: vi.fn() }))
const invoke = vi.fn()
const open = vi.fn()
const root = '/workspace'
const source = '/workspace/notes/source.md'

function content(html = '<p>Source</p>'): HTMLElement {
  const { document } = parseHTML(`<main>${html}</main>`)
  const dom = document.querySelector('main')! as unknown as HTMLElement
  for (const element of [dom, ...dom.querySelectorAll<HTMLElement>('*')])
    element.scrollIntoView = vi.fn()
  return dom
}

beforeEach(() => {
  vi.clearAllMocks()
  appStore.set(workspacePathAtom, root)
  appStore.set(displayedMetadataAtom, { id: source, frontmatter: '' })
  appStore.set(tabsAtom, [])
  appStore.set(activeTabIdAtom, source)
  appStore.set(treeSelectionAtom, null)
  appStore.set(revealDirectoryAtom, null)
  appStore.set(activeSmartIdAtom, 'pdfs')
  vi.stubGlobal('window', { api: { invoke }, open })
})
afterEach(() => vi.unstubAllGlobals())

describe('opening document links', () => {
  it.each(['next.md', 'image.png', 'document.pdf'])(
    'opens supported %s in Melo and updates tree selection',
    async (name) => {
      const path = root + '/' + name
      invoke.mockResolvedValue({ success: true, data: { kind: 'file', path, fragment: '' } })
      await openDocumentLink('../' + name, content())
      expect(invoke).toHaveBeenCalledOnce()
      expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeResolveDocumentLink, {
        href: '../' + name,
        fromPath: source,
        workspaceRoot: root,
      })
      expect(appStore.get(activeTabIdAtom)).toBe(path)
      expect(appStore.get(treeSelectionAtom)).toBe(path)
      expect(appStore.get(activeSmartIdAtom)).toBeNull()
      expect(open).not.toHaveBeenCalled()
    },
  )
  it('requests directory reveal without opening an editor tab', async () => {
    invoke.mockResolvedValue({
      success: true,
      data: { kind: 'directory', path: root + '/folder', fragment: '' },
    })
    await openDocumentLink('/folder', content())
    expect(appStore.get(revealDirectoryAtom)).toEqual({ path: root + '/folder' })
    expect(appStore.get(treeSelectionAtom)).toBe(root + '/folder')
    expect(appStore.get(tabsAtom)).toEqual([])
  })
  it('uses the existing safe system opener only for unsupported file types', async () => {
    invoke
      .mockResolvedValueOnce({
        success: true,
        data: { kind: 'file', path: root + '/deck.key', fragment: '' },
      })
      .mockResolvedValueOnce({ success: true })
    await openDocumentLink('/deck.key', content())
    expect(invoke).toHaveBeenLastCalledWith(IpcChannels.InvokeOpenPath, {
      path: root + '/deck.key',
    })
    expect(appStore.get(tabsAtom)).toEqual([])
  })
  it.each(['outside', 'missing', 'invalid'] as const)(
    'shows %s feedback without navigation',
    async (reason) => {
      invoke.mockResolvedValue({ success: true, data: { kind: 'error', reason } })
      await openDocumentLink('./missing.md', content())
      expect(toast).toHaveBeenCalledWith('editor.linkError.' + reason)
      expect(appStore.get(tabsAtom)).toEqual([])
    },
  )
  it('does not complete stored hrefs as websites or open unsupported schemes', async () => {
    invoke.mockResolvedValue({ success: true, data: { kind: 'error', reason: 'missing' } })
    await openDocumentLink('other.md', content())
    await openDocumentLink('obsidian://note', content())
    expect(open).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledOnce()
    expect(toast).toHaveBeenLastCalledWith('editor.linkUnsupported')
    await openDocumentLink('mailto:test@example.com', content())
    expect(open).toHaveBeenCalledWith('mailto:test@example.com', '_blank', 'noopener,noreferrer')
  })
  it.each(['workspace', 'source', 'active tab before load', 'newer navigation'])(
    'ignores late results after %s changes',
    async (change) => {
      let finish!: (response: unknown) => void
      invoke.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        }),
      )
      const pending = openDocumentLink('./next.md', content())
      if (change === 'workspace') appStore.set(workspacePathAtom, '/other')
      if (change === 'active tab before load')
        appStore.set(activeTabIdAtom, '/workspace/loading.md')
      if (change === 'source')
        appStore.set(displayedMetadataAtom, { id: '/workspace/other.md', frontmatter: '' })
      if (change === 'newer navigation') await openDocumentLink('https://example.com', content())
      finish({ success: true, data: { kind: 'file', path: root + '/next.md', fragment: '' } })
      await pending
      expect(appStore.get(tabsAtom)).toEqual([])
    },
  )
  it('resolves untitled links from the workspace root', async () => {
    appStore.set(displayedMetadataAtom, { id: 'untitled-1', frontmatter: '' })
    appStore.set(activeTabIdAtom, 'untitled-1')
    invoke.mockResolvedValue({ success: true, data: { kind: 'error', reason: 'missing' } })
    await openDocumentLink('next.md', content())
    expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeResolveDocumentLink, {
      href: 'next.md',
      fromPath: null,
      workspaceRoot: root,
    })
  })
})

describe('document fragments', () => {
  it('uses explicit ids, Unicode heading slugs and duplicate heading suffixes', () => {
    const dom = content('<h1 id="exact">First</h1><h2>你好 World</h2><h2>你好 World</h2>')
    expect(scrollToDocumentFragment(dom, 'exact')).toBe(true)
    expect(dom.querySelector('h1')!.scrollIntoView).toHaveBeenCalledOnce()
    expect(scrollToDocumentFragment(dom, '你好-world-1')).toBe(true)
    expect(dom.querySelectorAll('h2')[1].scrollIntoView).toHaveBeenCalledOnce()
    expect(scrollToDocumentFragment(dom, 'missing')).toBe(false)
  })
  it('handles fragment-only links locally and reports missing headings', async () => {
    const dom = content('<h1>A heading</h1>')
    await openDocumentLink('#a-heading', dom)
    expect(dom.querySelector('h1')!.scrollIntoView).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    await openDocumentLink('#missing', dom)
    expect(toast).toHaveBeenCalledWith('editor.linkHeadingMissing')
  })
  it('applies cross-note fragments after the target editor content has loaded', async () => {
    const path = root + '/next.md'
    invoke.mockResolvedValue({ success: true, data: { kind: 'file', path, fragment: 'target' } })
    await openDocumentLink('../next.md#target', content())
    const dom = content('<h1>Target</h1>')
    expect(dom.querySelector('h1')!.scrollIntoView).not.toHaveBeenCalled()
    applyPendingDocumentFragment(path, dom)
    expect(dom.querySelector('h1')!.scrollIntoView).toHaveBeenCalledOnce()
    applyPendingDocumentFragment(path, dom)
    expect(dom.querySelector('h1')!.scrollIntoView).toHaveBeenCalledOnce()
  })
})
