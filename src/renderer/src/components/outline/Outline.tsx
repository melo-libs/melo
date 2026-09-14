import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { tocAtom } from '../../store/toc'
import { activeTabAtom } from '../../store/editor'
import { workspacePathAtom } from '../../store/workspace'
import { LinksTab } from '../editor/links/LinksTab'
import { cn } from '../../lib/cn'
import './outline.scss'

interface FileMeta {
  path: string
  updated: string
  words: number
  reading: string
  tags: string[]
}

export const Outline = () => {
  const { t, i18n } = useTranslation()
  const [tab, setTab] = useState<'outline' | 'info' | 'links'>('outline')
  const toc = useAtomValue(tocAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const wsPath = useAtomValue(workspacePathAtom)
  const [meta, setMeta] = useState<FileMeta | null>(null)

  useEffect(() => {
    const fp = activeTab?.path
    if (!fp) {
      setMeta(null)
      return
    }
    const relPath = wsPath && fp.startsWith(wsPath) ? fp.slice(wsPath.length + 1) : fp

    let alive = true
    Promise.all([
      window.api.invoke(window.api.channels.InvokeGetFileStats, { filePath: fp }),
      window.api.invoke(window.api.channels.InvokeGetFileMeta, { path: fp }),
    ]).then(([statsRes, metaRes]) => {
      if (!alive) return
      const words = metaRes.data?.meta?.words ?? Math.round((statsRes.data?.size ?? 0) / 5)
      const d = statsRes.data ? new Date(statsRes.data.mtime) : new Date()
      setMeta({
        path: relPath,
        updated: d.toLocaleDateString(i18n.language, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        words,
        reading: t('outline.minutes', { count: Math.max(1, Math.ceil(words / 200)) }),
        tags: metaRes.data?.meta?.tags ?? [],
      })
    })
    return () => {
      alive = false
    }
  }, [activeTab?.path, wsPath, i18n.language])

  const scrollTo = (id: string) => {
    const el = document.querySelector(`[data-toc-id="${id}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <aside className="outline">
      <div className="ol-tabs">
        <button
          className="ol-tab"
          data-active={tab === 'outline'}
          onClick={() => setTab('outline')}
        >
          {t('outline.outline')}
        </button>
        <button className="ol-tab" data-active={tab === 'info'} onClick={() => setTab('info')}>
          {t('outline.info')}
        </button>
        <button className="ol-tab" data-active={tab === 'links'} onClick={() => setTab('links')}>
          {t('outline.links')}
        </button>
      </div>

      <div className="ol-body">
        {tab === 'links' ? (
          <LinksTab />
        ) : tab === 'outline' ? (
          <>
            <div className="ol-section-title">{t('outline.onThisPage')}</div>
            {toc.length === 0 && <div className="ol-empty">{t('outline.noHeadings')}</div>}
            {toc.map((item) => (
              <div
                key={item.id}
                className="ol-item"
                data-level={item.level}
                data-active={item.active}
                onClick={() => scrollTo(item.id)}
              >
                <span className="ol-label">{item.text || t('outline.untitled')}</span>
              </div>
            ))}
          </>
        ) : meta ? (
          <>
            <div className="ol-section-title">{t('outline.file')}</div>
            <div className="ol-meta">
              <div className="ol-meta-row block">
                <dt>{t('outline.path')}</dt>
                <dd className="path">{meta.path}</dd>
              </div>
              <div className="ol-meta-row">
                <dt>{t('outline.updated')}</dt>
                <dd>{meta.updated}</dd>
              </div>
              <div className="ol-meta-row">
                <dt>{t('outline.words')}</dt>
                <dd>{meta.words}</dd>
              </div>
              <div className="ol-meta-row">
                <dt>{t('outline.reading')}</dt>
                <dd>{meta.reading}</dd>
              </div>
              <div className="ol-meta-row">
                <dt>{t('outline.format')}</dt>
                <dd>Markdown</dd>
              </div>
            </div>

            {meta.tags.length > 0 && (
              <>
                <div className={cn('ol-section-title', 'ol-tags-title')}>{t('outline.tags')}</div>
                <div className="ol-tags">
                  {meta.tags.map((t) => (
                    <span key={t} className="ol-tag">
                      #{t}
                    </span>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="ol-empty">{t('outline.noFileOpen')}</div>
        )}
      </div>
    </aside>
  )
}
