import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { IpcChannels, type IpcChannelDefinitions } from '@shared/types/ipc'
import { activeTabAtom } from '../../../store/editor'

export type NoteLinks = NonNullable<
  IpcChannelDefinitions[IpcChannels.InvokeGetNoteLinks]['response']['data']
>

const EMPTY: NoteLinks = {
  selfTitle: '',
  backlinks: [],
  mentions: [],
  outgoing: [],
  edges: [],
}

/** Backlinks / outgoing / mentions / graph edges for the active note.
 *  Refreshes when the tab changes and on workspace changes (the watcher
 *  fires after saves too, so fresh links appear as you write). */
export function useNoteLinks(): { links: NoteLinks; notePath: string | null; refresh: () => void } {
  const activeTab = useAtomValue(activeTabAtom)
  const notePath = activeTab?.path || null
  const [links, setLinks] = useState<NoteLinks>(EMPTY)
  const [bump, setBump] = useState(0)
  const refresh = useCallback(() => setBump((n) => n + 1), [])

  // Switching notes must not show (or act on) the previous note's data
  // while the new request is in flight — reset synchronously on change.
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    if (lastPath.current !== notePath) {
      lastPath.current = notePath
      setLinks(EMPTY)
    }
    if (!notePath) return
    let alive = true
    window.api
      .invoke(IpcChannels.InvokeGetNoteLinks, { path: notePath })
      .then((res) => {
        if (alive) setLinks(res.success && res.data ? res.data : EMPTY)
      })
      .catch(() => {
        if (alive) setLinks(EMPTY)
      })
    return () => {
      alive = false
    }
  }, [notePath, bump])

  useEffect(() => {
    return window.api.on(IpcChannels.OnWorkspaceChanged, refresh)
  }, [refresh])

  return { links, notePath, refresh }
}
