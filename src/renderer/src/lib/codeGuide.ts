import { IpcChannels } from '@shared/types/ipc'
import i18n from '../i18n'
import { appStore } from '../store/appStore'
import { openFileAtom } from '../store/editor'
import { activeSmartIdAtom } from '../store/smart'
import { treeSelectionAtom } from '../store/workspace'
import type { FileNode } from '../components/sidebar/types'
import {
  CODE_GUIDE_VERSION,
  codeGuideAsset,
  hasCodeGuideMarker,
  isCodeGuideFilename,
  nextCodeGuideFilename,
} from './codeGuideContent'

export interface OpenCodeGuideResult {
  opened: boolean
  created: boolean
  filePath?: string
  reason?: 'already-shown' | 'no-inbox' | 'state-unavailable' | 'write-failed'
}

const walkGuideCandidates = (nodes: FileNode[], out: FileNode[] = []): FileNode[] => {
  for (const node of nodes) {
    if (node.kind === 'md' && isCodeGuideFilename(node.name)) out.push(node)
    if (node.children) walkGuideCandidates(node.children, out)
  }
  return out
}

const findExistingGuide = async (tree: FileNode[]): Promise<string | null> => {
  for (const node of walkGuideCandidates(tree)) {
    const read = await window.api.invoke(IpcChannels.InvokeReadFile, { filePath: node.id })
    if (read.success && read.data && hasCodeGuideMarker(read.data.content)) return node.id
  }
  return null
}

const markOpened = async (): Promise<void> => {
  await window.api.invoke(IpcChannels.InvokeMarkCodeGuideOpened, {
    version: CODE_GUIDE_VERSION,
  })
}

const activateGuide = async (filePath: string): Promise<void> => {
  appStore.set(activeSmartIdAtom, null)
  appStore.set(treeSelectionAtom, filePath)
  appStore.set(openFileAtom, filePath)
  await markOpened()
}

/** Open Melo's editable CODE guide in the current workspace.
 *
 * The automatic path is global and versioned: exactly one workspace gets
 * the first-use copy. Help calls with `firstUseOnly: false`, so the current
 * workspace gets a copy on demand. Existing marked guides are never
 * overwritten — the user owns the file after creation. */
export async function openCodeGuide({
  tree,
  firstUseOnly,
}: {
  tree: FileNode[]
  firstUseOnly: boolean
}): Promise<OpenCodeGuideResult> {
  if (firstUseOnly) {
    const state = await window.api.invoke(IpcChannels.InvokeGetCodeGuideState, undefined)
    if (!state.success || !state.data) {
      return { opened: false, created: false, reason: 'state-unavailable' }
    }
    if (state.data.version >= CODE_GUIDE_VERSION) {
      return { opened: false, created: false, reason: 'already-shown' }
    }
  }

  const inbox = tree.find((node) => node.system === 'inbox' && node.kind === 'folder')
  if (!inbox) return { opened: false, created: false, reason: 'no-inbox' }

  const existing = await findExistingGuide(tree)
  if (existing) {
    await activateGuide(existing)
    return { opened: true, created: false, filePath: existing }
  }

  const asset = codeGuideAsset(i18n.language)
  const names = new Set((inbox.children ?? []).map((node) => node.name))
  const name = nextCodeGuideFilename(asset.filename, names)
  const created = await window.api.invoke(IpcChannels.InvokeCreateFile, {
    parentPath: inbox.id,
    name,
  })
  if (!created.success || !created.data) {
    return { opened: false, created: false, reason: 'write-failed' }
  }

  const filePath = created.data.filePath
  const saved = await window.api.invoke(IpcChannels.InvokeSaveFile, {
    filePath,
    content: asset.content,
  })
  if (!saved.success) {
    void window.api.invoke(IpcChannels.InvokeDeleteFile, { path: filePath })
    return { opened: false, created: false, reason: 'write-failed' }
  }

  await activateGuide(filePath)
  return { opened: true, created: true, filePath }
}
