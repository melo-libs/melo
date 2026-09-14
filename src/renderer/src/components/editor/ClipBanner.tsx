import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { safeExternalUrl } from '../../lib/url'
import { formatFrontmatterDate } from '../../lib/format'
import { Icon } from '../Icon'

export interface ClipSource {
  url: string
  host: string
  site?: string
  author?: string
  favicon?: string
  created?: string
}

export function parseClipSource(frontmatter: string): ClipSource | null {
  if (!frontmatter) return null

  const fields: Record<string, string> = {}
  for (const line of frontmatter.split('\n')) {
    const m = line.match(/^(\w+):\s*"?([^"]*)"?\s*$/)
    if (m) fields[m[1]] = m[2]
  }
  if (!fields.source) return null

  let host: string
  try {
    host = new URL(fields.source).hostname.replace(/^www\./, '')
  } catch {
    host = fields.source
  }

  return {
    url: fields.source,
    host,
    site: fields.site || undefined,
    author: fields.author || undefined,
    favicon: fields.favicon || undefined,
    created: fields.created || undefined,
  }
}

function readingTime(markdown: string): string | null {
  const cjk = markdown.match(/[぀-ゟ㐀-䶿一-鿿豈-﫿]/g)?.length ?? 0
  const latin =
    markdown.replace(/[぀-ゟ㐀-䶿一-鿿豈-﫿]/g, ' ').match(/[A-Za-z0-9][A-Za-z0-9''_-]*/g)?.length ??
    0
  const words = cjk + latin
  if (words === 0) return null
  const mins = Math.max(1, Math.ceil(words / 200))
  return i18n.t('clip.minRead', { count: mins })
}

interface ClipBannerProps {
  source: ClipSource
  markdown: string
}

export const ClipBanner = ({ source, markdown }: ClipBannerProps) => {
  const { t } = useTranslation()
  const siteName = source.site || source.host
  const reading = readingTime(markdown)

  return (
    <div className="ed-clip">
      <span className="ed-clip-fav">
        {source.favicon ? (
          <img src={`app://${source.favicon}`} alt="" width={15} height={15} />
        ) : (
          <Icon name="paperclip" size={15} />
        )}
      </span>
      <span className="ed-clip-site">{siteName}</span>
      {source.author && (
        <>
          <span className="ed-clip-dot">&middot;</span>
          <span className="ed-clip-meta">{source.author}</span>
        </>
      )}
      {reading && (
        <>
          <span className="ed-clip-dot">&middot;</span>
          <span className="ed-clip-meta">{reading}</span>
        </>
      )}
      <span className="ed-clip-spacer" />
      {source.created && (
        <span className="ed-clip-when">
          {t('clip.clipped', { date: formatFrontmatterDate(source.created, i18n.language) })}
        </span>
      )}
      {source.created && <span className="ed-clip-dot">&middot;</span>}
      <a
        className="ed-clip-orig"
        href={source.url}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => {
          e.preventDefault()
          const url = safeExternalUrl(source.url)
          if (url) window.open(url, '_blank')
        }}
      >
        {t('clip.viewOriginal')}
        <span className="ed-clip-arrow">&#8599;</span>
      </a>
    </div>
  )
}
