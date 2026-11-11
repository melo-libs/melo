import { useEffect, useState } from 'react'
import { Icon, type IconName } from './Icon'
import './Favicon.scss'

export interface FaviconProps {
  path?: string
  url?: string
  size?: number
  fallback?: IconName
}

/** Saved clips reuse their local asset; unsaved previews can use the site's icon URL. */
export const Favicon = ({ path, url, size = 16, fallback = 'paperclip' }: FaviconProps) => {
  const src = path ? `app://${encodeURIComponent(path)}` : url
  const [failedSrc, setFailedSrc] = useState<string>()
  useEffect(() => setFailedSrc(undefined), [src])

  return (
    <span className="favicon" style={{ width: size, height: size }}>
      {src && src !== failedSrc ? (
        <img
          src={src}
          referrerPolicy="no-referrer"
          alt=""
          width={size}
          height={size}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <Icon name={fallback} size={size} />
      )}
    </span>
  )
}
