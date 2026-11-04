import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '../Icon'
import { folderPrefixes } from './organizationFolders'

export function NewFolderBadge() {
  const { t } = useTranslation()
  return <span className="agent-folder-new">{t('agent.organization.new')}</span>
}

export function OrganizationFolderPath({ path, locations }: { path: string; locations: string[] }) {
  const { t } = useTranslation()
  const container = useRef<HTMLSpanElement>(null)
  const measure = useRef<HTMLSpanElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  const prefixes = folderPrefixes(path)
  const firstNew = prefixes.findIndex((folder) => !locations.includes(folder))
  const crumbs = prefixes.map((folder, index) => (
    <span className="agent-folder-crumb" key={folder}>
      {index > 0 && <Icon name="chev" size={12} />}
      <span className={index === prefixes.length - 1 ? 'is-destination' : undefined}>
        {folder.split('/').pop()}
      </span>
      {index === firstNew && <NewFolderBadge />}
    </span>
  ))
  useEffect(() => {
    const resize = () => setCollapsed(measure.current!.scrollWidth > container.current!.clientWidth)
    const observer = new ResizeObserver(resize)
    observer.observe(container.current!)
    observer.observe(measure.current!)
    resize()
    return () => observer.disconnect()
  }, [path, locations])
  return (
    <span className="agent-folder-path" ref={container} data-collapsed={collapsed || undefined}>
      <span className="agent-folder-measure" ref={measure} aria-hidden="true">
        {crumbs.length ? crumbs : t('agent.organization.root')}
      </span>
      <span className="agent-folder-visible" aria-hidden="true">
        {collapsed && prefixes.length > 2 ? (
          <>
            <span>{path.split('/')[0]}</span>
            <Icon name="chev" size={12} />
            <span className="agent-folder-ellipsis">…</span>
            <Icon name="chev" size={12} />
            <span className="is-destination">{path.split('/').pop()}</span>
            {firstNew >= 0 && <NewFolderBadge />}
          </>
        ) : crumbs.length ? (
          crumbs
        ) : (
          t('agent.organization.root')
        )}
      </span>
    </span>
  )
}
