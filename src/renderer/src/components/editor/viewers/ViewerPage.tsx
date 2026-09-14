import { useEffect, useMemo, useState } from 'react'
import { formatSize } from '../../../lib/format'
import { Trans, useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { IpcChannels } from '@shared/types/ipc'
import { workspacePathAtom } from '../../../store/workspace'
import { FileTypeIcon, fileTypeLabel, type FileKind } from '../../FileTypeIcon'
import { PdfViewer } from './PdfViewer'
import './viewers.scss'

/* ============================================================
   ViewerPage — the editor column's view for non-editable files.
   md/txt stay in the Tiptap editor; everything else lands here:
   media through the app:// protocol, small text files as a
   read-only preview, the rest as a file card with OS actions.
   No documentSession is ever created for these tabs.
   ============================================================ */

export interface ViewerPageProps {
  path: string
  kind: FileKind
  name: string
}

/** Text files above this size skip the inline preview entirely — the read
    would ship the whole file over IPC just to throw most of it away. */
const TEXT_FILE_MAX_BYTES = 2_000_000
/** What the inline preview actually renders. */
const TEXT_PREVIEW_CHARS = 200_000

const TEXT_KINDS: FileKind[] = ['code', 'data', 'html']

export const ViewerPage = ({ path, kind, name }: ViewerPageProps) => {
  const { t, i18n } = useTranslation()
  const workspacePath = useAtomValue(workspacePathAtom)
  const [stat, setStat] = useState<{ size: number; mtime: number } | null>(null)
  const [text, setText] = useState<{ content: string; truncated: boolean } | null>(null)

  const isText = TEXT_KINDS.includes(kind)

  // app:// serves workspace files with mime types and traversal guarding —
  // the same channel the editor already uses for inline images.
  const appUrl = useMemo(() => {
    if (!workspacePath || !path.startsWith(workspacePath + '/')) return null
    const rel = path.slice(workspacePath.length + 1)
    return 'app://' + encodeURI(rel).replace(/#/g, '%23').replace(/\?/g, '%3F')
  }, [path, workspacePath])

  useEffect(() => {
    let alive = true
    setStat(null)
    setText(null)
    window.api.invoke(IpcChannels.InvokeGetFileStats, { filePath: path }).then((res) => {
      if (!alive || !res.success || !res.data) return
      setStat({ size: res.data.size, mtime: res.data.mtime })
      if (isText && res.data.size <= TEXT_FILE_MAX_BYTES) {
        window.api.invoke(IpcChannels.InvokeReadFile, { filePath: path }).then((r) => {
          if (!alive || !r.success || !r.data) return
          setText({
            content: r.data.content.slice(0, TEXT_PREVIEW_CHARS),
            truncated: r.data.content.length > TEXT_PREVIEW_CHARS,
          })
        })
      }
    })
    return () => {
      alive = false
    }
  }, [path, isText])

  const openDefault = () => void window.api.invoke(IpcChannels.InvokeOpenPath, { path })
  const reveal = () => void window.api.invoke(IpcChannels.InvokeRevealInFinder, { path })

  const textTooLarge = isText && stat !== null && stat.size > TEXT_FILE_MAX_BYTES

  const card = kind === 'zip' || kind === 'other' || kind === 'bookmark' || textTooLarge

  // Space — macOS Quick Look, matching Finder's reflex for "just show me".
  useEffect(() => {
    if (!card) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ') return
      // Space must still activate a focused control or type into a field.
      const t = e.target
      if (
        t instanceof HTMLElement &&
        (t.closest('button, a, input, textarea, select') || t.isContentEditable)
      )
        return
      e.preventDefault()
      void window.api.invoke(IpcChannels.InvokeQuickPreview, { filePath: path })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, path])

  if (card) {
    return (
      <div className="viewer-page">
        <div className="viewer-card">
          <FileTypeIcon kind={kind} size={44} />
          <div className="viewer-card-name">{name}</div>
          <div className="viewer-card-meta">
            {/* An unrecognized type is exactly when the extension IS the
                identity — "PPTX" informs, "File" doesn't. */}
            {kind === 'other' && name.includes('.')
              ? name.slice(name.lastIndexOf('.') + 1).toUpperCase()
              : fileTypeLabel(kind)}
            {stat && (
              <>
                {' · '}
                {formatSize(stat.size)}
                {' · ' + t('viewer.modified') + ' '}
                {new Date(stat.mtime).toLocaleDateString(i18n.language, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </>
            )}
          </div>
          {textTooLarge && <div className="viewer-card-note">{t('viewer.tooLargeInline')}</div>}
          <div className="viewer-card-actions">
            <button className="viewer-btn primary" onClick={openDefault}>
              {t('viewer.openInDefaultApp')}
            </button>
            <button className="viewer-btn" onClick={reveal}>
              {t('viewer.showInFinder')}
            </button>
          </div>
          <div className="viewer-card-hint">
            <Trans i18nKey="viewer.quickLook" components={{ kbd: <kbd /> }} />
          </div>
        </div>
      </div>
    )
  }

  if (isText) {
    return (
      <div className="viewer-page">
        {text?.truncated && (
          <div className="viewer-notice">
            <Trans
              i18nKey="viewer.truncatedNotice"
              components={{ btn: <button onClick={openDefault} /> }}
            />
          </div>
        )}
        <div className="viewer-text-wrap">
          <pre className="viewer-text">{text?.content ?? ''}</pre>
        </div>
      </div>
    )
  }

  if (kind === 'pdf') {
    return <PdfViewer path={path} name={name} />
  }

  if (kind === 'audio') {
    return (
      <div className="viewer-page">
        <div className="viewer-card">
          <FileTypeIcon kind={kind} size={44} />
          <div className="viewer-card-name">{name}</div>
          {appUrl && <audio className="viewer-audio" controls src={appUrl} />}
        </div>
      </div>
    )
  }

  // image / video
  return (
    <div className="viewer-page">
      <div className="viewer-media">
        {appUrl &&
          (kind === 'video' ? <video controls src={appUrl} /> : <img src={appUrl} alt={name} />)}
      </div>
    </div>
  )
}
