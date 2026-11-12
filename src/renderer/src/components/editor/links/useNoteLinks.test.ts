import { createElement } from 'react'
import { parseHTML } from 'linkedom'
import { expect, it, vi } from 'vitest'
import { IpcChannels } from '@shared/types/ipc'
import { useNoteLinks, type NoteLinks } from './useNoteLinks'

it('hides previous references immediately and ignores responses from a note that was left', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  const pending = new Map<string, (response: { success: boolean; data: NoteLinks }) => void>()
  const invoke = vi.fn(
    (_channel: string, { path }: { path: string }) =>
      new Promise((resolve) => {
        pending.set(path, resolve)
      }),
  )
  window.api = { invoke, on: vi.fn(() => () => {}) } as unknown as typeof window.api
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  function Reader({ path }: { path: string | null }) {
    const { links } = useNoteLinks(path)
    return createElement('span', null, links.selfTitle)
  }
  const root = createRoot(window.document.getElementById('root')!)
  const update = (path: string | null) =>
    flushSync(() => root.render(createElement(Reader, { path })))
  const complete = (path: string) =>
    pending.get(path)!({
      success: true,
      data: {
        selfTitle: path,
        backlinks: [],
        backlinksTotal: 0,
        mentions: [],
      },
    })
  const title = () => window.document.querySelector('span')!.textContent
  try {
    update('first.md')
    expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeGetNoteLinks, { path: 'first.md' })
    complete('first.md')
    await vi.waitFor(() => expect(title()).toBe('first.md'))
    update('second.md')
    expect(title()).toBe('')
    update('third.md')
    complete('second.md')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(title()).toBe('')
    complete('third.md')
    await vi.waitFor(() => expect(title()).toBe('third.md'))
    update(null)
    expect(title()).toBe('')
    expect(invoke).toHaveBeenCalledTimes(3)
  } finally {
    flushSync(() => root.unmount())
    vi.unstubAllGlobals()
  }
})

it('ignores a response superseded by a refresh of the same note', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  const pending: ((response: { success: boolean; data: NoteLinks }) => void)[] = []
  const invoke = vi.fn(() => new Promise((resolve) => pending.push(resolve)))
  window.api = { invoke, on: vi.fn(() => () => {}) } as unknown as typeof window.api
  const { createRoot } = await import('react-dom/client')
  const { flushSync } = await import('react-dom')
  let refresh!: () => void
  function Reader() {
    const state = useNoteLinks('Target.md')
    refresh = state.refresh
    return createElement('span', null, state.links.selfTitle)
  }
  const root = createRoot(window.document.getElementById('root')!)
  const complete = (title: string) => ({
    success: true,
    data: { selfTitle: title, backlinksTotal: 0, backlinks: [], mentions: [] },
  })
  const title = () => window.document.querySelector('span')!.textContent
  try {
    flushSync(() => root.render(createElement(Reader)))
    flushSync(() => refresh())
    expect(invoke).toHaveBeenCalledTimes(2)
    pending[1](complete('Updated'))
    await vi.waitFor(() => expect(title()).toBe('Updated'))
    pending[0](complete('Stale'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(title()).toBe('Updated')
  } finally {
    flushSync(() => root.unmount())
    vi.unstubAllGlobals()
  }
})
