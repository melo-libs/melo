import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { Icon } from '../../Icon'
import { FileTypeIcon } from '../../FileTypeIcon'
import { IpcChannels } from '@shared/types/ipc'
import { activeTabAtom } from '../../../store/editor'
import { workspacePathAtom } from '../../../store/workspace'
import { clampToViewport } from './WikilinkLayer'
import { workspaceDisplayPath } from './resolve'

/* ============================================================
   LinkPicker — the note-search popover behind "[[" and the
   "Link to note" slash item. Candidates come from the index
   (md notes only); an unmatched query offers a "Create" row.
   Note-level links only.
   ============================================================ */

export interface LinkPick {
  title: string
}

interface Candidate {
  title: string
  path: string
}

type Row = { kind: 'note'; note: Candidate } | { kind: 'create' }

export const LinkPicker = ({
  x,
  y,
  onPick,
  onClose,
}: {
  x: number
  y: number
  onPick: (pick: LinkPick) => void
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  // Keep the answered query alongside the list: stale rows stay on screen
  // (no flicker) but can't be committed against a newer query.
  const [matches, setMatches] = useState<{ forQ: string; list: Candidate[] }>({
    forQ: '',
    list: [],
  })
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const activeTab = useAtomValue(activeTabAtom)
  const workspacePath = useAtomValue(workspacePathAtom)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  // Query the index per keystroke; a stale response never overwrites a
  // newer one (seq guard). Limit lives in the main process.
  const seq = useRef(0)
  useEffect(() => {
    const mySeq = ++seq.current
    window.api
      .invoke(IpcChannels.InvokeListLinkTargets, {
        query: q.trim(),
        excludePath: activeTab?.path || null,
      })
      .then((res) => {
        if (seq.current !== mySeq) return
        setMatches({ forQ: q, list: res.success && res.data ? res.data.targets.slice(0, 6) : [] })
      })
      .catch(() => {
        if (seq.current === mySeq) setMatches({ forQ: q, list: [] })
      })
  }, [q, activeTab?.path])

  const fresh = matches.forQ === q
  const exact = matches.list.some((n) => n.title.toLowerCase() === q.trim().toLowerCase())
  const showCreate = fresh && q.trim().length > 0 && !exact
  const rows: Row[] = [
    ...matches.list.map((n) => ({ kind: 'note', note: n }) as Row),
    ...(showCreate ? [{ kind: 'create' } as Row] : []),
  ]

  useEffect(() => setActive(0), [q])
  // Rows can shrink when a response lands — keep the highlight in range.
  useEffect(() => {
    setActive((a) => Math.max(0, Math.min(a, rows.length - 1)))
  }, [rows.length])

  const choose = (row: Row | undefined) => {
    // Note rows answer an older query — wait for the fresh list (ms-scale)
    // rather than committing a stale pick. The create row always uses `q`.
    if (!row || (row.kind === 'note' && !fresh)) return
    if (row.kind === 'create') onPick({ title: q.trim() })
    else onPick({ title: row.note.title })
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(rows[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const W = 320
  const pos = clampToViewport(x, y, W, 360)

  return (
    <div className="lp" ref={rootRef} style={{ left: pos.x, top: pos.y, width: W }}>
      <div className="lp-input">
        <span className="lp-brackets">⟦⟧</span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder={t('links.linkToNote')}
          spellCheck={false}
        />
        <kbd>esc</kbd>
      </div>
      <div className="lp-list">
        {rows.length === 0 && <div className="lp-empty">{t('links.typeToCreate')}</div>}
        {rows.map((row, i) =>
          row.kind === 'note' ? (
            <div
              className={'lp-row' + (i === active ? ' active' : '')}
              key={row.note.path}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(row)
              }}
            >
              <span className="lp-ft">
                <FileTypeIcon kind="md" size={18} />
              </span>
              <span className="lp-row-body">
                <span className="lp-row-title">{row.note.title}</span>
                <span className="lp-row-path">
                  {workspaceDisplayPath(row.note.path, workspacePath)}
                </span>
              </span>
            </div>
          ) : (
            <div
              className={'lp-row lp-create' + (i === active ? ' active' : '')}
              key="__create"
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(row)
              }}
            >
              <span className="lp-ft create">
                <Icon name="plus" size={15} />
              </span>
              <span className="lp-row-body">
                <span className="lp-row-title">{t('links.createNote', { name: q.trim() })}</span>
                <span className="lp-row-path">{t('links.newNoteInWorkspace')}</span>
              </span>
            </div>
          ),
        )}
      </div>
      <div className="lp-foot">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>↵</kbd> link
        </span>
      </div>
    </div>
  )
}
