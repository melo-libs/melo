import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { wordCountAtom } from '../../store/editor'
import { fileTypeLabel, type FileKind } from '../FileTypeIcon'
import { formatSize } from '../../lib/format'

export interface BottomBarProps {
  filePath: string | null
  /** Set when a viewer tab is active — the bar shows type · size instead
   *  of word count. */
  viewerKind?: FileKind | null
}

export const BottomBar = ({ filePath, viewerKind }: BottomBarProps) => {
  const { t, i18n } = useTranslation()
  const words = useAtomValue(wordCountAtom)
  const [stats, setStats] = useState<{ mtime: number; size: number } | null>(null)
  const [createdAt, setCreatedAt] = useState<number | null>(null)

  useEffect(() => {
    setStats(null)
    setCreatedAt(null)
    if (!filePath || filePath.startsWith('untitled-')) return
    let alive = true
    window.api.invoke(window.api.channels.InvokeGetFileStats, { filePath }).then((res) => {
      if (alive && res.success && res.data) setStats({ mtime: res.data.mtime, size: res.data.size })
    })
    // Creation time (frontmatter created → birthtime → mtime, the smart
    // Created chain). The top bar owns "last modified"; this bar owns the
    // document's birth date — orthogonal facts, no second modified clock.
    window.api.invoke(window.api.channels.InvokeGetFileMeta, { path: filePath }).then((res) => {
      if (alive && res.success && res.data?.meta) setCreatedAt(res.data.meta.createdAt)
    })
    return () => {
      alive = false
    }
  }, [filePath])

  const reading = Math.max(1, Math.ceil(words / 200))
  const created = createdAt
    ? new Date(createdAt).toLocaleDateString(i18n.language, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  return (
    <div className="ed-bottombar">
      {viewerKind ? (
        <span>
          <b>{fileTypeLabel(viewerKind)}</b>
        </span>
      ) : (
        <>
          <span>{t('bottomBar.words', { count: words })}</span>
          <span className="sep">·</span>
          <span>{t('bottomBar.minRead', { count: reading })}</span>
          <span className="sep">·</span>
          <span>{t('bottomBar.format')}</span>
        </>
      )}
      {viewerKind && stats && (
        <>
          <span className="sep">·</span>
          <span>{formatSize(stats.size)}</span>
        </>
      )}
      {created && (
        <>
          <span className="sep">·</span>
          <span>{t('bottomBar.created', { date: created })}</span>
        </>
      )}
    </div>
  )
}
