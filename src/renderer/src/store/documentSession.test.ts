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
