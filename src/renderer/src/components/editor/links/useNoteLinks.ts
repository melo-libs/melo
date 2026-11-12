import { useCallback, useEffect, useState } from 'react'
import { IpcChannels, type IpcChannelDefinitions } from '@shared/types/ipc'

export type NoteLinks = NonNullable<
  IpcChannelDefinitions[IpcChannels.InvokeGetNoteLinks]['response']['data']
>

const EMPTY: NoteLinks = {
  selfTitle: '',
  backlinks: [],
  backlinksTotal: 0,
  mentions: [],
}

/** Linked references and unlinked mentions for the active note.
 *  Refreshes when the tab changes and on workspace changes (the watcher
 *  fires after saves too, so fresh links appear as you write). */
export function useNoteLinks(notePath: string | null): {
  links: NoteLinks
  notePath: string | null
  refresh: () => void
} {
  const [result, setResult] = useState<{ path: string; links: NoteLinks } | null>(null)
  const [bump, setBump] = useState(0)
  const refresh = useCallback(() => setBump((n) => n + 1), [])

  useEffect(() => {
    if (!notePath) return
    let alive = true
    window.api
      .invoke(IpcChannels.InvokeGetNoteLinks, { path: notePath })
      .then((res) => {
        if (alive) setResult({ path: notePath, links: res.success && res.data ? res.data : EMPTY })
      })
      .catch(() => {
        if (alive) setResult({ path: notePath, links: EMPTY })
      })
    return () => {
      alive = false
    }
  }, [notePath, bump])

  useEffect(() => {
    return window.api.on(IpcChannels.OnWorkspaceChanged, refresh)
  }, [refresh])

  // Keep the previous note's count and links out of the new document while loading.
  return {
    links: result?.path === notePath ? result.links : EMPTY,
    notePath,
    refresh,
  }
}
