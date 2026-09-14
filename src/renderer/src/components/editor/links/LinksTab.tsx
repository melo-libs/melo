import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { Icon } from '../../Icon'
import { FileTypeIcon } from '../../FileTypeIcon'
import { activeTabAtom, openFileAtom } from '../../../store/editor'
import { useNoteLinks, type NoteLinks } from './useNoteLinks'

/* ============================================================
   LinksTab — right-column "Links" tab: local graph + outgoing
   links + backlinks list. Port of design DualLinks, fed by
   InvokeGetNoteLinks. Missing outgoing targets create on click
   via the shared wikilink layer conventions (WikilinkLayer owns
   editor clicks; here we dispatch through the same cache-free
   flow: open when resolved, otherwise it's a dead target row).
   ============================================================ */

interface GraphNode {
  id: string // absolute path, or 'target:<name>' for missing targets
  title: string
  x: number
  y: number
  self?: boolean
  missing?: boolean
}

/** Deterministic radial layout in the 224×190 viewBox the design used:
 *  self at center, neighbors on an ellipse, angle from a stable hash. */
function layoutGraph(
  links: NoteLinks,
  selfPath: string,
  selfTitle: string,
): { nodes: GraphNode[]; edges: [string, string][] } {
  const nodes = new Map<string, GraphNode>()
  nodes.set(selfPath, { id: selfPath, title: selfTitle, x: 112, y: 96, self: true })

  const neighbors: { id: string; title: string; missing?: boolean }[] = []
  const seen = new Set<string>()
  for (const b of links.backlinks) {
    if (!seen.has(b.path)) {
      seen.add(b.path)
      neighbors.push({ id: b.path, title: b.title })
    }
  }
  for (const o of links.outgoing) {
    const id = o.path ?? `target:${o.target.toLowerCase()}`
    if (seen.has(id) || id === selfPath) continue
    seen.add(id)
    neighbors.push({ id, title: o.title ?? o.target, missing: !o.path })
  }

  const n = neighbors.length
  neighbors.forEach((nb, i) => {
    const angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2
    nodes.set(nb.id, {
      ...nb,
      x: Math.round(112 + Math.cos(angle) * 78),
      y: Math.round(96 + Math.sin(angle) * 58),
    })
  })

  const edges: [string, string][] = []
  for (const [a, b] of links.edges) {
    if (nodes.has(a) && nodes.has(b)) edges.push([a, b])
  }
  // Missing outgoing targets have no path, so the main process couldn't
  // emit their edges — connect them to self here.
  for (const nb of neighbors) if (nb.missing) edges.push([selfPath, nb.id])

  return { nodes: [...nodes.values()], edges }
}

const LocalGraph = ({
  links,
  selfPath,
  selfTitle,
  onOpen,
}: {
  links: NoteLinks
  selfPath: string
  selfTitle: string
  onOpen: (path: string) => void
}) => {
  const [hot, setHot] = useState<string | null>(null)
  const { nodes, edges } = useMemo(
    () => layoutGraph(links, selfPath, selfTitle),
    [links, selfPath, selfTitle],
  )
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const isOn = (id: string) =>
    hot == null ||
    hot === id ||
    edges.some(([a, b]) => (a === hot && b === id) || (b === hot && a === id))
  const edgeOn = (a: string, b: string) => hot == null || a === hot || b === hot

  return (
    <div className="lg">
      <svg viewBox="0 0 224 190" className="lg-svg">
        {edges.map(([a, b], i) => {
          const na = nodeById.get(a)!
          const nb = nodeById.get(b)!
          return (
            <line
              key={i}
              x1={na.x}
              y1={na.y}
              x2={nb.x}
              y2={nb.y}
              className={'lg-edge' + (edgeOn(a, b) ? ' on' : '')}
            />
          )
        })}
        {nodes.map((n) => {
          const r = n.self ? 7 : 4.5
          const on = isOn(n.id)
          return (
            <g
              key={n.id}
              className={
                'lg-node' +
                (n.self ? ' self' : '') +
                (n.missing ? ' missing' : '') +
                (on ? ' on' : ' off')
              }
              onMouseEnter={() => setHot(n.id)}
              onMouseLeave={() => setHot(null)}
              onClick={() => !n.self && !n.missing && onOpen(n.id)}
            >
              <circle cx={n.x} cy={n.y} r={r + 9} className="lg-hit" />
              <circle cx={n.x} cy={n.y} r={r} className="lg-dot" />
              <text x={n.x} y={n.y + (n.self ? 19 : 15)} className="lg-label">
                {n.title.length > 16 ? n.title.slice(0, 15) + '…' : n.title}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

const LinkRow = ({
  title,
  missing,
  onClick,
}: {
  title: string
  missing?: boolean
  onClick?: () => void
}) => (
  <button className="lt-row" onClick={onClick}>
    <span className={'lt-ft' + (missing ? ' missing' : '')}>
      {missing ? <Icon name="plus" size={13} /> : <FileTypeIcon kind="md" size={16} />}
    </span>
    <span className="lt-row-text">
      <span className={'lt-row-title' + (missing ? ' missing' : '')}>{title}</span>
      {missing && <span className="lt-row-sub muted">not created</span>}
    </span>
    <span className="lt-row-go">
      <Icon name="arrowRight" size={12} />
    </span>
  </button>
)

export const LinksTab = () => {
  const { t } = useTranslation()
  const { links, notePath } = useNoteLinks()
  const activeTab = useAtomValue(activeTabAtom)
  const openFile = useSetAtom(openFileAtom)
  const backlinkCount = links.backlinks.reduce((n, g) => n + g.refs.length, 0)

  if (!notePath) return <div className="lt-hint">{t('links.openNoteToSee')}</div>

  const selfTitle = links.selfTitle || activeTab?.title || ''
  // A missing target row navigates nowhere from the rail; creating it is
  // an editor action (click the link in the text, or the peek card).
  return (
    <div className="lt">
      <div className="lt-graphwrap">
        <div className="ol-section-title" style={{ margin: '2px 6px 8px' }}>
          {t('links.localGraph')}
        </div>
        <LocalGraph links={links} selfPath={notePath} selfTitle={selfTitle} onOpen={openFile} />
      </div>

      <div className="lt-sec">
        <div className="lt-sec-head">
          <Icon name="arrowRight" size={13} />
          <span>{t('links.outgoingLinks')}</span>
          <span className="lt-sec-n">{links.outgoing.length}</span>
        </div>
        {links.outgoing.map((o) => (
          <LinkRow
            title={o.title ?? o.target}
            missing={!o.path}
            onClick={o.path ? () => openFile(o.path!) : undefined}
            key={o.target}
          />
        ))}
        {links.outgoing.length === 0 && <div className="lt-hint">{t('links.noOutgoing')}</div>}
      </div>

      <div className="lt-sec">
        <div className="lt-sec-head">
          <Icon name="backlink" size={13} />
          <span>{t('links.backlinks')}</span>
          <span className="lt-sec-n">{backlinkCount}</span>
        </div>
        {links.backlinks.map((b) => (
          <LinkRow title={b.title} onClick={() => openFile(b.path)} key={b.path} />
        ))}
        {links.backlinks.length === 0 && <div className="lt-hint">{t('links.noBacklinks')}</div>}
        {links.backlinks.length > 0 && <div className="lt-hint">{t('links.fullContext')}</div>}
      </div>
    </div>
  )
}
