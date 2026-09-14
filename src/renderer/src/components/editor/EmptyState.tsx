import { useRef, useState, useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { IpcChannels } from '@shared/types/ipc'
import { stripMarkdownExtension } from '@shared/fileKinds'
import { Icon } from '../Icon'
import { toast } from '../Toaster'
import {
  recentNotesAtom,
  searchOpenAtom,
  workspacePathAtom,
  workspaceTreeAtom,
} from '../../store/workspace'
import { openFileAtom } from '../../store/editor'
import { loadTree } from '../../lib/workspace'

interface RecentItem {
  id: string
  title: string
  folder: string
}

function CaptureField({ onCapture, busy }: { onCapture: (text: string) => void; busy: boolean }) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const ready = value.trim().length > 0 && !busy
  const commit = () => {
    if (ready) {
      onCapture(value.trim())
      setValue('')
    }
  }
  return (
    <div className="es-capture big">
      <input
        className="es-capture-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        placeholder={t('es.placeholder')}
        spellCheck={false}
        autoFocus
      />
      <div className="es-capture-cap" data-ready={ready}>
        <span>
          <Trans i18nKey="es.landsInInbox" components={{ b: <b /> }} />
        </span>
        <kbd className="es-capture-ret">↵</kbd>
      </div>
    </div>
  )
}

function RecentRow({ item, onOpen }: { item: RecentItem; onOpen: (id: string) => void }) {
  // One line per note. The folder shows only when it's the exception —
  // most recents live in Inbox, and five gray "Inbox" captions said
  // nothing while doubling the list's height.
  const folder = item.folder === 'Inbox' ? '' : item.folder
  return (
    <button
      className="es-recent"
      onClick={() => onOpen(item.id)}
      title={item.folder ? item.folder + ' / ' + item.title : item.title}
    >
      <span className="es-recent-ic">
        <Icon name="fileMd" size={15} />
      </span>
      <span className="es-recent-title">{item.title}</span>
      {folder && <span className="es-recent-folder">{folder}</span>}
    </button>
  )
}

export const EmptyState = () => {
  const { t } = useTranslation()
  const recentPaths = useAtomValue(recentNotesAtom)
  const wsPath = useAtomValue(workspacePathAtom)
  const tree = useAtomValue(workspaceTreeAtom)
  const openFile = useSetAtom(openFileAtom)
  const pushRecent = useSetAtom(recentNotesAtom)
  const setTree = useSetAtom(workspaceTreeAtom)
  const setSearchOpen = useSetAtom(searchOpenAtom)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const inboxPath = useMemo(() => {
    const find = (nodes: typeof tree): string | null => {
      for (const n of nodes) {
        if (n.system === 'inbox') return n.id
        if (n.children) {
          const found = find(n.children)
          if (found) return found
        }
      }
      return null
    }
    return find(tree)
  }, [tree])

  const recents = useMemo<RecentItem[]>(() => {
    return recentPaths.slice(0, 5).map((p) => {
      const basename = p.split('/').pop() ?? p
      const title = stripMarkdownExtension(basename)
      let folder = ''
      if (wsPath && p.startsWith(wsPath)) {
        const rel = p.slice(wsPath.length + 1)
        const parts = rel.split('/')
        folder = parts.length > 1 ? parts.slice(0, -1).join(' / ') : ''
      }
      return { id: p, title, folder }
    })
  }, [recentPaths, wsPath])

  const onCapture = async (text: string) => {
    if (busyRef.current) return
    const parentPath = inboxPath ?? wsPath
    if (!parentPath) return
    busyRef.current = true
    setBusy(true)
    try {
      const safeName =
        text
          .replace(/[/\\:*?"<>|]/g, '')
          .trim()
          .slice(0, 60) || t('es.untitled')
      let name = `${safeName}.md`
      let created = await window.api.invoke(IpcChannels.InvokeCreateFile, {
        parentPath,
        name,
      })
      if (!created.success) {
        // Deduplicate: try with a numeric suffix
        for (let i = 1; i <= 20 && !created.success; i++) {
          name = `${safeName} ${i}.md`
          created = await window.api.invoke(IpcChannels.InvokeCreateFile, {
            parentPath,
            name,
          })
        }
        if (!created.success) {
          toast(t('es.couldNotCreate'))
          return
        }
      }
      const filePath = created.data!.filePath
      await window.api.invoke(IpcChannels.InvokeSaveFile, {
        filePath,
        content: `${text}\n`,
      })
      if (wsPath) {
        const next = await loadTree(wsPath)
        setTree(next)
      }
      pushRecent(filePath)
      openFile(filePath)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const onOpen = (filePath: string) => {
    pushRecent(filePath)
    openFile(filePath)
  }

  return (
    <div className="es es-quiet">
      <div className="es-inner">
        <CaptureField onCapture={onCapture} busy={busy} />

        <div className="es-links">
          <button
            className="es-link"
            onClick={() => window.dispatchEvent(new CustomEvent('melo:new-note'))}
          >
            <Icon name="pencil" size={13} /> {t('es.newNote')}
          </button>
          <span className="es-link-sep">·</span>
          <button
            className="es-link"
            onClick={() => window.dispatchEvent(new CustomEvent('melo:new-folder'))}
          >
            <Icon name="folder" size={13} /> {t('es.newFolder')}
          </button>
        </div>

        {recents.length > 0 && (
          <div className="es-list es-list-quiet">
            <div className="es-list-label">{t('es.recentlyOpened')}</div>
            {recents.map((item) => (
              <RecentRow key={item.id} item={item} onOpen={onOpen} />
            ))}
          </div>
        )}

        <div className="es-foot">
          <kbd className="es-kbd">⌘K</kbd>{' '}
          <span
            className="es-foot-link"
            role="button"
            tabIndex={0}
            onClick={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSearchOpen(true)
            }}
          >
            {t('es.toSearch')}
          </span>
        </div>
      </div>
    </div>
  )
}
