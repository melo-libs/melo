import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { IpcChannels } from '@shared/types/ipc'
import type { FileNode } from '../components/sidebar/types'
import { openCodeGuide } from './codeGuide'
import { CODE_GUIDE_MARKER, codeGuideAsset } from './codeGuideContent'
import { openFileAtom } from '../store/editor'
import { activeSmartIdAtom } from '../store/smart'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  set: vi.fn(),
  language: 'zh-CN',
  version: 0,
  existingContent: '',
  createdPath: '/notes/Inbox/Melo 使用指南.md',
}))

vi.mock('../i18n', () => ({
  default: {
    get language() {
      return mocks.language
    },
  },
}))
vi.mock('../store/appStore', () => ({ appStore: { set: mocks.set } }))
vi.mock('../store/editor', () => ({ openFileAtom: Symbol('openFile') }))
vi.mock('../store/smart', () => ({ activeSmartIdAtom: Symbol('activeSmartId') }))
vi.mock('../store/workspace', () => ({ treeSelectionAtom: Symbol('treeSelection') }))

const inbox = (children: FileNode[] = []): FileNode => ({
  id: '/notes/Inbox',
  name: 'Inbox',
  kind: 'folder',
  system: 'inbox',
  children,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.language = 'zh-CN'
  mocks.version = 0
  mocks.existingContent = ''
  mocks.createdPath = '/notes/Inbox/Melo 使用指南.md'
  mocks.invoke.mockImplementation(async (channel: IpcChannels) => {
    if (channel === IpcChannels.InvokeGetCodeGuideState) {
      return { success: true, data: { version: mocks.version } }
    }
    if (channel === IpcChannels.InvokeReadFile) {
      return { success: true, data: { content: mocks.existingContent } }
    }
    if (channel === IpcChannels.InvokeCreateFile) {
      return { success: true, data: { filePath: mocks.createdPath } }
    }
    if (
      channel === IpcChannels.InvokeSaveFile ||
      channel === IpcChannels.InvokeMarkCodeGuideOpened ||
      channel === IpcChannels.InvokeDeleteFile
    ) {
      return { success: true }
    }
    throw new Error(`Unexpected IPC channel: ${channel}`)
  })
  vi.stubGlobal('window', { api: { invoke: mocks.invoke } })
})

afterEach(() => vi.unstubAllGlobals())

describe('opening the user guide', () => {
  it.each(['en', 'zh-CN'])('creates only the %s guide on first use', async (language) => {
    mocks.language = language
    const asset = codeGuideAsset(language)
    mocks.createdPath = `/notes/Inbox/${asset.filename}`
    const result = await openCodeGuide({ tree: [inbox()], firstUseOnly: true })
    expect(result).toEqual({ opened: true, created: true, filePath: mocks.createdPath })
    expect(mocks.invoke.mock.calls.map(([channel]) => channel)).toEqual([
      IpcChannels.InvokeGetCodeGuideState,
      IpcChannels.InvokeCreateFile,
      IpcChannels.InvokeSaveFile,
      IpcChannels.InvokeMarkCodeGuideOpened,
    ])
    expect(mocks.invoke).toHaveBeenCalledWith(IpcChannels.InvokeCreateFile, {
      parentPath: '/notes/Inbox',
      name: asset.filename,
    })
    expect(mocks.invoke).toHaveBeenCalledWith(IpcChannels.InvokeSaveFile, {
      filePath: mocks.createdPath,
      content: asset.content,
    })
    expect(mocks.set).toHaveBeenCalledWith(activeSmartIdAtom, null)
    expect(mocks.set).toHaveBeenCalledWith(openFileAtom, mocks.createdPath)
  })

  it('does not reopen or rewrite a guide after the released first-use version', async () => {
    mocks.version = 1
    const result = await openCodeGuide({ tree: [inbox()], firstUseOnly: true })
    expect(result).toEqual({ opened: false, created: false, reason: 'already-shown' })
    expect(mocks.invoke).toHaveBeenCalledOnce()
    expect(mocks.invoke).toHaveBeenCalledWith(IpcChannels.InvokeGetCodeGuideState, undefined)
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it.each([
    'The CODE Idea in Melo.md',
    'Melo 的 CODE 理念 2.md',
    'Melo 使用指南.md',
    'Melo User Guide 2.md',
  ])('reopens the existing %s from Help without overwriting it', async (name) => {
    mocks.existingContent = `---\n${CODE_GUIDE_MARKER}\n---\n\n# My edits\nKeep this text.`
    const file: FileNode = { id: `/notes/Reading/${name}`, name, kind: 'md' }
    const tree = [
      inbox(),
      { id: '/notes/Reading', name: 'Reading', kind: 'folder' as const, children: [file] },
    ]
    const result = await openCodeGuide({ tree, firstUseOnly: false })
    expect(result).toEqual({ opened: true, created: false, filePath: file.id })
    expect(mocks.invoke.mock.calls.map(([channel]) => channel)).toEqual([
      IpcChannels.InvokeReadFile,
      IpcChannels.InvokeMarkCodeGuideOpened,
    ])
    expect(mocks.set).toHaveBeenCalledWith(openFileAtom, file.id)
  })

  it('does not replace a user file with the same name and no guide marker', async () => {
    mocks.existingContent = '# My personal notes'
    const file: FileNode = {
      id: '/notes/Inbox/Melo 使用指南.md',
      name: 'Melo 使用指南.md',
      kind: 'md',
    }
    mocks.createdPath = '/notes/Inbox/Melo 使用指南 2.md'
    await openCodeGuide({ tree: [inbox([file])], firstUseOnly: false })
    expect(mocks.invoke).toHaveBeenCalledWith(IpcChannels.InvokeCreateFile, {
      parentPath: '/notes/Inbox',
      name: 'Melo 使用指南 2.md',
    })
    expect(mocks.invoke).toHaveBeenCalledWith(IpcChannels.InvokeSaveFile, {
      filePath: mocks.createdPath,
      content: codeGuideAsset('zh-CN').content,
    })
  })

  it('does not create a guide outside a workspace Inbox', async () => {
    expect(await openCodeGuide({ tree: [], firstUseOnly: false })).toEqual({
      opened: false,
      created: false,
      reason: 'no-inbox',
    })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
