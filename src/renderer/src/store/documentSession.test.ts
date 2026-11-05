import { afterEach, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { IpcChannels } from '@shared/types/ipc'
import { appStore } from './appStore'
import { openFileAtom, tabsAtom } from './editor'
import {
  activateSession,
  attachEditor,
  closeSession,
  handleAgentDocument,
  noteEdited,
  registerReloadApplier,
  setDisplayedSession,
  promoteUntitled,
  displayedMetadataAtom,
  updateSessionTags,
  getSessionTagEditor,
  flushAll,
} from './documentSession'

vi.mock('../i18n', () => ({ default: { t: (s: string) => s } }))
vi.mock('../components/Toaster', () => ({ toast: vi.fn() }))
afterEach(async () => {
  await closeSession('/notes/note.md', { discard: true })
  attachEditor(null)
  setDisplayedSession(null)
  registerReloadApplier(null)
  vi.unstubAllGlobals()
})

it('reads unsaved edits, rejects a stale agent edit, and preserves undo history on an accepted edit', async () => {
  let body = '# Disk'
  let disk = body
  const invoke = vi.fn(async (channel: IpcChannels, args: { content?: string }) => {
    if (channel === IpcChannels.InvokeReadFile)
      return { success: true, data: { content: disk, canonicalPath: '/notes/note.md', mtime: 10 } }
    if (channel === IpcChannels.InvokeGetFileStats) return { success: true, data: { mtime: 10 } }
    if (channel === IpcChannels.InvokeSaveFile) {
      disk = args.content!
      return { success: true, data: { mtime: 10 } }
    }
    throw new Error('Unexpected IPC')
  })
  vi.stubGlobal('window', { api: { invoke, channels: IpcChannels } })
  await activateSession('/notes/note.md')
  attachEditor({ getMarkdown: () => body } as unknown as Editor)
  setDisplayedSession('/notes/note.md')
  body = '# User draft'
  noteEdited()
  const snapshot = await handleAgentDocument({ id: 'read', action: 'read', path: '/notes/note.md' })
  expect(snapshot.snapshot!.content).toBe('# User draft')
  body += '\nNew typing'
  noteEdited()
  await expect(
    handleAgentDocument({
      id: 'edit',
      action: 'edit',
      path: '/notes/note.md',
      content: '# Overwrite',
      expectedRevision: snapshot.snapshot!.revision,
    }),
  ).rejects.toThrow('changed')
  const next = await handleAgentDocument({ id: 'read2', action: 'read', path: '/notes/note.md' })
  const apply = vi.fn((content: string) => {
    body = content
  })
  registerReloadApplier(apply)
  await handleAgentDocument({
    id: 'edit2',
    action: 'edit',
    path: '/notes/note.md',
    content: body + '\nAgent addition',
    expectedRevision: next.snapshot!.revision,
  })
  expect(apply).toHaveBeenCalledWith('# User draft\nNew typing\nAgent addition', true)
  expect(disk).toBe(body)
})

it('rejects an external disk change even when its mtime is unchanged', async () => {
  let disk = '# Original'
  vi.stubGlobal('window', {
    api: {
      channels: IpcChannels,
      invoke: vi.fn(async () => ({
        success: true,
        data: { content: disk, canonicalPath: '/notes/note.md', mtime: 10 },
      })),
    },
  })
  await activateSession('/notes/note.md')
  const snapshot = await handleAgentDocument({ id: 'read', action: 'read', path: '/notes/note.md' })
  disk = '# External replacement'
  await expect(
    handleAgentDocument({
      id: 'edit',
      action: 'edit',
      path: '/notes/note.md',
      expectedRevision: snapshot.snapshot!.revision,
      content: '# Agent',
    }),
  ).rejects.toThrow('changed')
})

it('finds the existing session for an alias instead of creating another writer', async () => {
  vi.stubGlobal('window', {
    api: {
      channels: IpcChannels,
      invoke: vi.fn(async () => ({
        success: true,
        data: { content: '# Disk', canonicalPath: '/notes/note.md', mtime: 10 },
      })),
    },
  })
  await activateSession('/notes/alias.md')
  let content = '# Unsaved alias'
  attachEditor({ getMarkdown: () => content } as unknown as Editor)
  setDisplayedSession('/notes/alias.md')
  noteEdited()
  const snapshot = await handleAgentDocument({ id: 'read', action: 'read', path: '/notes/note.md' })
  expect(snapshot.snapshot!.content).toBe(content)
  content = '# New typing'
  noteEdited()
  await expect(
    handleAgentDocument({
      id: 'edit',
      action: 'edit',
      path: '/notes/note.md',
      expectedRevision: snapshot.snapshot!.revision,
      content: '# Lost draft',
    }),
  ).rejects.toThrow('changed')
  await closeSession('/notes/alias.md', { discard: true })
})

it('keeps viewer tabs on an aborted move and removes them only after success', async () => {
  appStore.set(openFileAtom, '/notes/photo.jpg')
  await handleAgentDocument({
    id: 'prepare',
    action: 'prepare-file-operation',
    path: '/notes/photo.jpg',
  })
  await handleAgentDocument({
    id: 'abort',
    action: 'abort-file-operation',
    path: '/notes/photo.jpg',
  })
  expect(appStore.get(tabsAtom).some((tab) => tab.id === '/notes/photo.jpg')).toBe(true)
  await handleAgentDocument({
    id: 'prepare2',
    action: 'prepare-file-operation',
    path: '/notes/photo.jpg',
  })
  await handleAgentDocument({
    id: 'finish',
    action: 'finish-file-operation',
    path: '/notes/photo.jpg',
  })
  expect(appStore.get(tabsAtom).some((tab) => tab.id === '/notes/photo.jpg')).toBe(false)
})

it('keeps canonical ownership after Save As through an alias', async () => {
  let body = '# Saved draft'
  vi.stubGlobal('window', {
    api: {
      channels: IpcChannels,
      invoke: vi.fn(async () => ({
        success: true,
        data: { canonicalPath: '/notes/note.md', mtime: 10 },
      })),
    },
  })
  await activateSession('untitled-agent')
  attachEditor({ getMarkdown: () => body } as unknown as Editor)
  setDisplayedSession('untitled-agent')
  await promoteUntitled('untitled-agent', '/notes/alias.md')
  body += '\nUnpublished changes'
  noteEdited()
  const snapshot = await handleAgentDocument({ id: 'read', action: 'read', path: '/notes/note.md' })
  expect(snapshot.snapshot!.content).toBe(body)
  await closeSession('/notes/alias.md', { discard: true })
})

it.each([false, true])('persists tag-only edits and undo, keeping dirty body=%s', async (dirty) => {
  let disk = '---\ntitle: Keep\ntags: [old]\n---\n# Body'
  let body = '# Body'
  vi.stubGlobal('window', {
    api: {
      channels: IpcChannels,
      invoke: async (channel: IpcChannels, args: { content?: string }) => {
        if (channel === IpcChannels.InvokeReadFile)
          return {
            success: true,
            data: { content: disk, canonicalPath: '/notes/note.md', mtime: 10 },
          }
        if (channel === IpcChannels.InvokeSaveFile) {
          disk = args.content!
          return { success: true, data: { mtime: 11 } }
        }
        throw new Error('Unexpected IPC')
      },
    },
  })
  await activateSession('/notes/note.md')
  attachEditor({ getMarkdown: () => body } as unknown as Editor)
  setDisplayedSession('/notes/note.md')
  registerReloadApplier((next) => {
    body = next
  })
  if (dirty) {
    body += '\nUnsent edits'
    noteEdited()
  }
  const before = (await handleAgentDocument({ id: 'read', action: 'read', path: '/notes/note.md' }))
    .snapshot!
  const content = before.content.replace('[old]', '[new]')
  const edited = (
    await handleAgentDocument({
      id: 'tags',
      action: 'edit-tags',
      path: '/notes/note.md',
      content,
      expectedRevision: before.revision,
    })
  ).snapshot!
  expect(disk).toBe(content)
  expect(appStore.get(displayedMetadataAtom)?.frontmatter).toContain('[new]')
  expect(body).toBe(dirty ? '# Body\nUnsent edits' : '# Body')
  await handleAgentDocument({
    id: 'undo',
    action: 'edit-tags',
    path: '/notes/note.md',
    content: before.content,
    expectedRevision: edited.revision,
  })
  expect(disk).toBe(before.content)
  expect(appStore.get(displayedMetadataAtom)?.frontmatter).toContain('[old]')
})

it.each([false, true])(
  'edits BOM metadata manually, keeps unsaved body and rejects stale tags (large=%s)',
  async (large) => {
    let body = '# Body' + (large ? '\n' + 'x'.repeat(1024 * 1024) : '')
    let disk = '\uFEFF---\ntags: [old]\nauthor: Keep\n---\n' + body
    vi.stubGlobal('window', {
      api: {
        channels: IpcChannels,
        invoke: async (channel: IpcChannels, args: { content?: string }) => {
          if (channel === IpcChannels.InvokeReadFile)
            return {
              success: true,
              data: { content: disk, canonicalPath: '/notes/note.md', mtime: 10 },
            }
          if (channel === IpcChannels.InvokeSaveFile) {
            disk = args.content!
            return { success: true, data: { mtime: 11 } }
          }
          throw new Error('Unexpected IPC')
        },
      },
    })
    const loaded = await activateSession('/notes/note.md')
    expect(loaded?.body).toBe(body)
    attachEditor({ getMarkdown: () => body } as unknown as Editor)
    setDisplayedSession('/notes/note.md')
    const before = appStore.get(displayedMetadataAtom)!
    body += '\nUser draft'
    noteEdited()
    if (large)
      await expect(
        handleAgentDocument({ id: 'bounded', action: 'read', path: '/notes/note.md' }),
      ).rejects.toThrow('1 MB')
    await updateSessionTags('/notes/note.md', before.frontmatter, ['Travel', '产品 设计'])
    expect(disk).toBe('\uFEFF---\ntags: ["travel","产品 设计"]\nauthor: Keep\n---\n' + body)
    expect(appStore.get(displayedMetadataAtom)?.frontmatter).toContain('产品 设计')
    await expect(
      updateSessionTags('/notes/note.md', before.frontmatter, ['stale']),
    ).rejects.toThrow('DOCUMENT_TAGS_CONFLICT')
    expect(disk).not.toContain('stale')
    setDisplayedSession(null)
    expect(appStore.get(displayedMetadataAtom)).toBeNull()
  },
)

it.each(['---\ntags: [old]\n---\nBody', '\nBody'])(
  'rolls back failed tag metadata without changing body or later autosave: %s',
  async (original) => {
    let disk = original,
      body = original.startsWith('---') ? 'Body' : original
    let fail = true
    vi.stubGlobal('window', {
      api: {
        channels: IpcChannels,
        invoke: async (channel: IpcChannels, args: { content?: string }) => {
          if (channel === IpcChannels.InvokeReadFile)
            return {
              success: true,
              data: { content: disk, canonicalPath: '/notes/note.md', mtime: 10 },
            }
          if (channel === IpcChannels.InvokeSaveFile) {
            if (fail) return { success: false, error: 'Read only' }
            disk = args.content!
            return { success: true, data: { mtime: 11 } }
          }
          throw new Error('Unexpected IPC')
        },
      },
    })
    await activateSession('/notes/note.md')
    attachEditor({ getMarkdown: () => body } as unknown as Editor)
    setDisplayedSession('/notes/note.md')
    registerReloadApplier((next) => {
      body = next
    })
    body += '\nUser draft'
    noteEdited()
    const before = (await handleAgentDocument({ id: 'r', action: 'read', path: '/notes/note.md' }))
      .snapshot!
    const request = {
      id: 'e',
      action: 'edit-tags' as const,
      path: '/notes/note.md',
      expectedRevision: before.revision,
      content: original.startsWith('---')
        ? before.content.replace('[old]', '[new]')
        : '---\ntags: [new]\n---\n' + before.content,
    }
    await expect(handleAgentDocument(request)).rejects.toThrow('Could not save')
    expect(
      (await handleAgentDocument({ id: 'r2', action: 'read', path: '/notes/note.md' })).snapshot,
    ).toEqual(before)
    expect(disk).toBe(original)
    expect(body).toContain('User draft')
    fail = false
    await handleAgentDocument({ ...request, id: 'retry' })
    expect(disk).toBe(request.content)
    const nextFrontmatter = await updateSessionTags(
      '/notes/note.md',
      appStore.get(displayedMetadataAtom)!.frontmatter,
      ['first'],
    )
    expect(nextFrontmatter).toBe(appStore.get(displayedMetadataAtom)!.frontmatter)
    await updateSessionTags('/notes/note.md', nextFrontmatter, ['first', 'second'])
    expect(disk).toContain('["first","second"]')
    expect(disk.endsWith(body)).toBe(true)
  },
)

it.each(['close', 'flushAll'])('waits for accepted tag edits before %s', async (action) => {
  let disk = '\nBody'
  let holdRead = false
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.stubGlobal('window', {
    api: {
      channels: IpcChannels,
      invoke: async (channel: IpcChannels, args: { content?: string }) => {
        if (channel === IpcChannels.InvokeReadFile) {
          if (holdRead) await blocked
          return {
            success: true,
            data: { content: disk, canonicalPath: '/notes/note.md', mtime: 10 },
          }
        }
        if (channel === IpcChannels.InvokeSaveFile) {
          disk = args.content!
          return { success: true, data: { mtime: 11 } }
        }
        throw new Error('Unexpected IPC')
      },
    },
  })
  await activateSession('/notes/note.md')
  attachEditor({ getMarkdown: () => '\nBody' } as unknown as Editor)
  setDisplayedSession('/notes/note.md')
  const tags = getSessionTagEditor('/notes/note.md', { frontmatter: '', tags: [] })
  holdRead = true
  tags.setTags(['a'])
  tags.setTags(['a', 'b'])
  expect(getSessionTagEditor('/notes/note.md', { frontmatter: '', tags: [] })).toBe(tags)
  let finished = false
  const closing = (action === 'close' ? closeSession('/notes/note.md') : flushAll()).then(
    (result) => {
      finished = true
      return result
    },
  )
  await Promise.resolve()
  expect(finished).toBe(false)
  release()
  expect(await closing).toEqual(action === 'close' ? true : [])
  expect(disk).toBe('---\ntags: ["a","b"]\n---\n\nBody')
})

it('allows body saves and closing after a failed tag edit has rolled back', async () => {
  let body = 'Body'
  let disk = body
  let fail = true
  vi.stubGlobal('window', {
    api: {
      channels: IpcChannels,
      invoke: async (channel: IpcChannels, args: { content?: string }) => {
        if (channel === IpcChannels.InvokeReadFile)
          return {
            success: true,
            data: { content: disk, canonicalPath: '/notes/note.md', mtime: 10 },
          }
        if (channel === IpcChannels.InvokeSaveFile) {
          if (fail) return { success: false, error: 'Disk full' }
          disk = args.content!
          return { success: true, data: { mtime: 11 } }
        }
        throw new Error('Unexpected IPC')
      },
    },
  })
  await activateSession('/notes/note.md')
  attachEditor({ getMarkdown: () => body } as unknown as Editor)
  setDisplayedSession('/notes/note.md')
  const tags = getSessionTagEditor('/notes/note.md', { frontmatter: '', tags: [] })
  tags.setTags(['failed'])
  expect(await tags.settled()).toBe(false)
  expect(disk).toBe('Body')
  fail = false
  body += '\nContinue writing'
  noteEdited()
  expect(await flushAll()).toEqual([])
  expect(disk).toBe(body)
  expect(await closeSession('/notes/note.md')).toBe(true)
})
