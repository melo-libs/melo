import { protocol, session } from 'electron'
import path from 'path'
import fs from 'fs-extra'
import mime from 'mime-types'
import { preferences } from './preferences'

const LAST_DIRECTORY_KEY = 'lastDirectory'

/** Chromium auto-attaches the renderer's own origin as Referer when the
 *  editor loads a remote image — hotlink protection (WeChat's CDN and
 *  friends) reads that as third-party embedding and serves a placeholder,
 *  while the same URL opened directly (no Referer) works. Strip only the
 *  app's own origins, so a Referer set deliberately (capture adapters
 *  fetching referer-gated images) passes through untouched. */
const APP_ORIGIN_RE = /^(app:|file:|https?:\/\/localhost(:\d+)?\/)/i

export function stripAppReferer() {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      if (details.resourceType === 'image') {
        for (const key of Object.keys(details.requestHeaders)) {
          if (key.toLowerCase() === 'referer' && APP_ORIGIN_RE.test(details.requestHeaders[key])) {
            delete details.requestHeaders[key]
          }
        }
      }
      callback({ requestHeaders: details.requestHeaders })
    },
  )
}

export function registerProtocols() {
  // Register app:// protocol
  protocol.registerFileProtocol('app', async (request, callback) => {
    try {
      const rootDir = preferences.get(LAST_DIRECTORY_KEY) as string | null
      if (!rootDir) {
        throw new Error('No workspace directory set')
      }

      // Remove 'app://' from the URL and decode. The scheme isn't registered
      // as standard, so a viewer fragment like `#toolbar=0` arrives as part
      // of the raw string — strip it BEFORE decoding, which also keeps `%23`
      // (a literal '#' in a filename) intact. decodeURIComponent (not
      // decodeURI) so reserved-character escapes like %23/%3F round-trip.
      const relativePath = decodeURIComponent(
        request.url.slice('app://'.length).replace(/#.*$/, ''),
      )
      // Resolve the absolute path relative to workspace root
      const filePath = path.join(rootDir, relativePath)

      // Containment check: separator-suffixed so a sibling directory that
      // shares the workspace's name as a prefix ("/ws" vs "/ws-secret")
      // can't slip through, and path.join has already collapsed any "..".
      if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
        throw new Error('Access denied: Path outside workspace')
      }

      // Check if file exists
      if (!(await fs.pathExists(filePath))) {
        throw new Error('File not found')
      }

      // Get MIME type
      const mimeType = mime.lookup(filePath) || 'application/octet-stream'

      callback({
        path: filePath,
        headers: {
          'Content-Type': mimeType,
        },
      })
    } catch (error) {
      console.error('Protocol handler error:', error)
      callback({ error: -2 }) // Net error for file not found
    }
  })
}
