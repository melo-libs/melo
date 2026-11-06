import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import './Favicon.scss'

export interface FaviconProps {
  path?: string
  size?: number
}

/** Reuse the captured local asset without fetching the source website again. */
export const Favicon = ({ path, size = 16 }: FaviconProps) => {
  const [failedPath, setFailedPath] = useState<string>()
  useEffect(() => setFailedPath(undefined), [path])

  return (
    <span className="favicon" style={{ width: size, height: size }}>
      {path && path !== failedPath ? (
        <img
          src={`app://${encodeURIComponent(path)}`}
          alt=""
          width={size}
          height={size}
          onError={() => setFailedPath(path)}
        />
      ) : (
        <Icon name="paperclip" size={size} />
      )}
    </span>
  )
}
