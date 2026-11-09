import { atom } from 'jotai'
import { classifyDocumentHref } from '@shared/documentLinks'
import { IpcChannels } from '@shared/types/ipc'
import i18n from '../i18n'
import { toast } from '../components/Toaster'
import { appStore } from '../store/appStore'
import { displayedMetadataAtom } from '../store/documentSession'
import { activeTabIdAtom, openFileAtom } from '../store/editor'
import { activeSmartIdAtom } from '../store/smart'
import {
  recentNotesAtom,
  revealDirectoryAtom,
  treeSelectionAtom,
  workspacePathAtom,
} from '../store/workspace'
import { isEditableKind, kindOf } from './workspace'

const pendingFragmentAtom = atom<{ path: string; fragment: string } | null>(null)
let navigationVersion = 0

/** Shared with chat links: opening a file also reveals it in the workspace. */
export function openWorkspaceFile(path: string, workspace: string): void {
  if (workspace !== appStore.get(workspacePathAtom)) return
  appStore.set(openFileAtom, path)
  appStore.set(treeSelectionAtom, path)
  appStore.set(activeSmartIdAtom, null)
  appStore.set(recentNotesAtom, path)
}

export function scrollToDocumentFragment(dom: HTMLElement, fragment: string): boolean {
  if (!fragment) {
    dom.scrollIntoView({ block: 'start' })
    return true
  }
  const explicit = Array.from(dom.querySelectorAll<HTMLElement>('[id], [data-toc-id]')).find(
    (element) => element.id === fragment || element.getAttribute('data-toc-id') === fragment,
  )
  // Markdown headings do not carry HTML ids. Resolve their readable slugs
  // separately from the TableOfContents extension's generated opaque ids.
  const seen = new Map<string, number>()
  const heading = Array.from(dom.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).find(
    (element) => {
      const slug = (element.textContent ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
        .replace(/\s/g, '-')
      const count = seen.get(slug) ?? 0
      seen.set(slug, count + 1)
      return (count ? `${slug}-${count}` : slug) === fragment
    },
  )
  const target = explicit ?? heading
  if (!target) return false
  target.scrollIntoView({ block: 'start' })
  return true
}

export function applyPendingDocumentFragment(path: string, dom: HTMLElement): void {
  const pending = appStore.get(pendingFragmentAtom)
  appStore.set(pendingFragmentAtom, null)
  if (pending?.path === path && !scrollToDocumentFragment(dom, pending.fragment))
    toast(i18n.t('editor.linkHeadingMissing'))
}

export async function openDocumentLink(href: string, dom: HTMLElement): Promise<void> {
  const version = ++navigationVersion
  appStore.set(pendingFragmentAtom, null)
  const target = classifyDocumentHref(href)
  if (target.kind === 'external') {
    window.open(target.url, '_blank', 'noopener,noreferrer')
    return
  }
  if (target.kind === 'unsupported') {
    toast(i18n.t('editor.linkUnsupported'))
    return
  }
  if (target.kind === 'fragment') {
    if (!scrollToDocumentFragment(dom, target.fragment)) toast(i18n.t('editor.linkHeadingMissing'))
    return
  }
  const workspace = appStore.get(workspacePathAtom)
  const source = appStore.get(displayedMetadataAtom)?.id ?? null
  const activeTab = appStore.get(activeTabIdAtom)
  if (source && source !== activeTab) return
  if (!workspace) {
    toast(i18n.t('editor.linkNeedsWorkspace'))
    return
  }
  try {
    const response = await window.api.invoke(IpcChannels.InvokeResolveDocumentLink, {
      href: target.href,
      fromPath: source?.startsWith('untitled-') ? null : source,
      workspaceRoot: workspace,
    })
    if (
      version !== navigationVersion ||
      workspace !== appStore.get(workspacePathAtom) ||
      activeTab !== appStore.get(activeTabIdAtom) ||
      source !== (appStore.get(displayedMetadataAtom)?.id ?? null)
    )
      return
    if (!response.success || !response.data) throw Error(response.error)
    const result = response.data
    if (result.kind === 'error') {
      toast(i18n.t(`editor.linkError.${result.reason}`))
    } else if (result.kind === 'directory') {
      appStore.set(treeSelectionAtom, result.path)
      appStore.set(activeSmartIdAtom, null)
      appStore.set(revealDirectoryAtom, { path: result.path })
    } else {
      const kind = kindOf(result.path)
      if (['other', 'zip', 'bookmark'].includes(kind)) {
        const opened = await window.api.invoke(IpcChannels.InvokeOpenPath, { path: result.path })
        if (!opened.success) throw Error(opened.error)
        return
      }
      if (result.fragment && isEditableKind(kind)) {
        if (result.path === source) {
          if (!scrollToDocumentFragment(dom, result.fragment))
            toast(i18n.t('editor.linkHeadingMissing'))
        } else {
          appStore.set(pendingFragmentAtom, { path: result.path, fragment: result.fragment })
        }
      }
      openWorkspaceFile(result.path, workspace)
    }
  } catch (error) {
    toast(
      i18n.t('editor.linkCouldNotOpen', { reason: error instanceof Error ? error.message : '' }),
    )
  }
}
