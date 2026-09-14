import { useEffect, useState } from 'react'
import { formatFrontmatterDate, formatSize } from '../../lib/format'
import { useTranslation } from 'react-i18next'
import * as Dialog from '@radix-ui/react-dialog'
import { useAtomValue } from 'jotai'
import { IpcChannels } from '@shared/types/ipc'
import { Icon } from '../Icon'
import { FILE_TYPES, fileTypeLabel } from '../FileTypeIcon'
import { Favicon } from '../Favicon'
import { workspacePathAtom } from '../../store/workspace'
import { workspaceDisplayPath } from '../editor/links/resolve'
import type { FileNode } from './types'

export interface PropertiesCardProps {
  node: FileNode | null
  onClose: () => void
}

const DATE_FMT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }

/** "Jul 16, 2026, 10:14" — app date language, no seconds. */
const fmtDateTime = (ts: number, lang: string) => {
  const d = new Date(ts)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${d.toLocaleDateString(lang, DATE_FMT)}, ${hm}`
}

/** File properties modal (Radix Dialog). */
export const PropertiesCard = ({ node, onClose }: PropertiesCardProps) => {
  const { t, i18n } = useTranslation()
  const wsPath = useAtomValue(workspacePathAtom)
  // Markdown files get live word count / tags from the index; every
  // indexed file gets its creation time (smart-Created chain).
  const [indexMeta, setIndexMeta] = useState<{ words: number; tags: string[] } | null>(null)
  const [createdAt, setCreatedAt] = useState<number | null>(null)
  const nodeId = node?.id
  const isMd = node?.kind === 'md'
  const isFolder = node?.kind === 'folder'
  useEffect(() => {
    setIndexMeta(null)
    setCreatedAt(null)
    if (!nodeId || isFolder) return
    let alive = true
    const fetch = () => {
      window.api.invoke(IpcChannels.InvokeGetFileMeta, { path: nodeId }).then((res) => {
        if (!alive || !res.success || !res.data?.meta) return
        setCreatedAt(res.data.meta.createdAt)
        // words/tags only make sense for markdown — for other kinds the
        // presence of indexMeta would fabricate a bogus count row.
        if (isMd) setIndexMeta(res.data.meta)
      })
    }
    fetch()
    // Refresh while open — the boot scan may index this file after us.
    const off = window.api.on(IpcChannels.OnWorkspaceChanged, fetch)
    return () => {
      alive = false
      off()
    }
  }, [nodeId, isMd, isFolder])

  if (!node) return null
  const meta = FILE_TYPES[node.kind] ?? FILE_TYPES.md
  const countLabel =
    node.kind === 'audio' || node.kind === 'video'
      ? t('props.duration')
      : node.kind === 'pdf'
        ? t('props.pages')
        : node.kind === 'image'
          ? t('props.dimensions')
          : t('props.words')
  const words = indexMeta?.words ?? node.count
  // Values don't repeat their label ("Words: 5,404 words") — units stay
  // only where they ARE the value (min).
  const countValue =
    node.kind === 'audio' || node.kind === 'video'
      ? t('props.minutes', { count: node.count ?? 0 })
      : node.kind === 'pdf'
        ? `${node.count}`
        : node.kind === 'image'
          ? `${node.count}`
          : `${words?.toLocaleString()}`
  const location = workspaceDisplayPath(node.id, wsPath)
  const displayName =
    meta.ext && node.name.toLowerCase().endsWith(meta.ext)
      ? node.name.slice(0, -meta.ext.length)
      : node.name

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="prop-scrim" />
        <Dialog.Content
          className="prop-card"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="prop-head">
            <div className="prop-head-info">
              {/* The ext badge below owns the ".md" — repeating it in the
                  title is noise. */}
              <Dialog.Title className="prop-name">{displayName}</Dialog.Title>
              <div className="prop-kind">
                {fileTypeLabel(node.kind)}
                {meta.ext && <code className="prop-ext">{meta.ext}</code>}
              </div>
            </div>
            <Dialog.Close className="prop-close" aria-label={t('props.close')}>
              <Icon name="x" size={14} />
            </Dialog.Close>
          </div>

          <div className="prop-rows">
            {node.source?.url && (
              <>
                <div className="prop-row">
                  <span className="prop-k">{t('props.source')}</span>
                  <span className="prop-v prop-link">
                    <Favicon host={node.source.host} size={12} tone="color" />
                    <span className="prop-url">{node.source.url}</span>
                  </span>
                </div>
                {node.source.capturedAt && (
                  <div className="prop-row">
                    <span className="prop-k">{t('props.captured')}</span>
                    <span className="prop-v">
                      {formatFrontmatterDate(node.source.capturedAt, i18n.language)}
                    </span>
                  </div>
                )}
              </>
            )}
            {(node.count != null || indexMeta != null) && (
              <div className="prop-row">
                <span className="prop-k">{countLabel}</span>
                <span className="prop-v">{countValue}</span>
              </div>
            )}
            {(indexMeta?.tags ?? node.tags ?? []).length > 0 && (
              <div className="prop-row">
                <span className="prop-k">{t('props.tags')}</span>
                <span className="prop-v prop-tags">
                  {(indexMeta?.tags ?? node.tags ?? []).map((t) => (
                    <span key={t} className="prop-tag">
                      #{t}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {node.kind !== 'folder' && node.size != null && (
              <div className="prop-row">
                <span className="prop-k">{t('props.size')}</span>
                <span className="prop-v">{formatSize(node.size)}</span>
              </div>
            )}
            {location && (
              <div className="prop-row">
                <span className="prop-k">{t('props.location')}</span>
                <span className="prop-v">{location}</span>
              </div>
            )}
            {/* Clips already state their birth as "Captured" — a Created
                row would repeat the same date in different words. Created
                shows the date only: with date-only frontmatter the clock
                would be a timezone artifact, not information. */}
            {createdAt != null && !node.source?.capturedAt && (
              <div className="prop-row">
                <span className="prop-k">{t('props.created')}</span>
                <span className="prop-v">
                  {new Date(createdAt).toLocaleDateString(i18n.language, DATE_FMT)}
                </span>
              </div>
            )}
            {node.mtime != null && (
              <div className="prop-row">
                <span className="prop-k">{t('props.modified')}</span>
                <span className="prop-v">{fmtDateTime(node.mtime, i18n.language)}</span>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
