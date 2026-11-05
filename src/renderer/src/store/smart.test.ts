import { afterEach, expect, it, vi } from 'vitest'
import { createStore } from 'jotai'
import { IpcChannels } from '@shared/types/ipc'
import { workspacePathAtom } from './workspace'
import {
  activeSmartIdAtom,
  smartBuilderAtom,
  smartFoldersAtom,
  smartRevisionAtom,
  smartSaveErrorAtom,
  persistSmartViewsAtom,
  loadSmartWorkspaceAtom,
} from './smart'
afterEach(() => vi.unstubAllGlobals())
it('leaves a refreshed active folder open and closes it when undo removes its definition', async () => {
  const store = createStore()
  store.set(workspacePathAtom, '/notes')
  const view = { id: 'agent-created', name: 'Agent folder', glyph: 'folder', rules: [] }
  let views = [view]
  vi.stubGlobal('window', {
    api: {
      invoke: async (channel: IpcChannels) =>
        channel === IpcChannels.InvokeGetSmartViews
          ? { success: true, data: { views, revision: 'revision' } }
          : { success: true, data: { counts: {}, tags: [], folders: [], sources: [] } },
    },
  })
  await store.set(loadSmartWorkspaceAtom)
  store.set(activeSmartIdAtom, view.id)
  await store.set(loadSmartWorkspaceAtom)
  expect(store.get(activeSmartIdAtom)).toBe(view.id)
  views = []
  await store.set(loadSmartWorkspaceAtom)
  expect(store.get(activeSmartIdAtom)).toBeNull()
  expect(store.get(smartFoldersAtom)).toEqual([])
})

it('pins a builder draft to its opening revision and keeps it after an Agent conflict', async () => {
  const store = createStore()
  store.set(workspacePathAtom, '/notes')
  vi.stubGlobal('window', { api: { invoke: async () => ({ success: false }) } })
  await store.set(loadSmartWorkspaceAtom)
  const original = { id: 'work', name: 'Work', glyph: 'folder', rules: [] }
  store.set(smartFoldersAtom, [original])
  store.set(smartRevisionAtom, 'r1')
  store.set(smartBuilderAtom, { ...original, editId: 'work' })
  store.set(smartFoldersAtom, [{ ...original, name: 'New agent name' }])
  store.set(smartRevisionAtom, 'r2')
  const invoke = vi.fn(async () => ({ success: false, error: 'SMART_VIEWS_CONFLICT' }))
  vi.stubGlobal('window', { api: { invoke } })
  const draft = store.get(smartBuilderAtom)!
  expect(
    await store.set(persistSmartViewsAtom, { views: [original], revision: draft.revision }),
  ).toBe(false)
  expect(invoke).toHaveBeenCalledWith(IpcChannels.InvokeSaveSmartViews, {
    workspaceRoot: '/notes',
    views: [original],
    expectedRevision: 'r1',
  })
  expect(store.get(smartFoldersAtom)[0].name).toBe('New agent name')
  expect(store.get(smartBuilderAtom)).toBe(draft)
  expect(store.get(smartSaveErrorAtom)).toBe('SMART_VIEWS_CONFLICT')
})

it('refreshes externally changed configuration after a conflict while preserving the draft', async () => {
  const store = createStore()
  store.set(workspacePathAtom, '/notes')
  let revision = 'r1'
  vi.stubGlobal('window', {
    api: {
      invoke: async (channel: IpcChannels) => {
        if (channel === IpcChannels.InvokeGetSmartViews)
          return {
            success: true,
            data: { views: [{ id: 'x', name: revision, glyph: 'folder', rules: [] }], revision },
          }
        if (channel === IpcChannels.InvokeSaveSmartViews)
          return { success: false, error: 'SMART_VIEWS_CONFLICT' }
        return { success: true, data: { counts: {}, tags: [], folders: [], sources: [] } }
      },
    },
  })
  await store.set(loadSmartWorkspaceAtom)
  store.set(smartBuilderAtom, { editId: 'x', name: 'Draft', glyph: 'folder', rules: [] })
  revision = 'r2'
  await store.set(persistSmartViewsAtom, { views: store.get(smartFoldersAtom), revision: 'r1' })
  expect(store.get(smartRevisionAtom)).toBe('r2')
  expect(store.get(smartBuilderAtom)).toMatchObject({ name: 'Draft', revision: 'r1' })
  store.set(smartBuilderAtom, null)
  store.set(smartBuilderAtom, { editId: 'x', name: 'r2', glyph: 'folder', rules: [] })
  expect(store.get(smartBuilderAtom)?.revision).toBe('r2')
})

it('ignores an older configuration response after a newer load completes', async () => {
  const store = createStore()
  store.set(workspacePathAtom, '/notes')
  type Snapshot = { success: boolean; data: { views: []; revision: string } }
  const replies: ((snapshot: Snapshot) => void)[] = []
  vi.stubGlobal('window', {
    api: {
      invoke: (channel: IpcChannels) =>
        channel === IpcChannels.InvokeGetSmartViews
          ? new Promise<Snapshot>((resolve) => replies.push(resolve))
          : Promise.resolve({
              success: true,
              data: { counts: {}, tags: [], folders: [], sources: [] },
            }),
    },
  })
  const first = store.set(loadSmartWorkspaceAtom)
  const second = store.set(loadSmartWorkspaceAtom)
  replies[1]({ success: true, data: { views: [], revision: 'new' } })
  await second
  replies[0]({ success: true, data: { views: [], revision: 'old' } })
  await first
  expect(store.get(smartRevisionAtom)).toBe('new')
})
