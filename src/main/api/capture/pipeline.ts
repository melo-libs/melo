import path from 'path'
import fs from 'fs-extra'
import { net } from 'electron'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { generateJSON, type AnyExtension } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { Image } from '@tiptap/extension-image'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Highlight } from '@tiptap/extension-highlight'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { v4 as uuidv4 } from 'uuid'
import mime from 'mime-types'
import { ParagraphMarkdown } from '../../../shared/serializers/paragraphMarkdown'
import type { SiteAdapter } from './types'

/* ----------------------------------------------------------------
   Shared pipeline utilities used by both capture() and previewUrl().
   ---------------------------------------------------------------- */

/* ---- Tiptap HTML → Markdown serializer (runs in main process) ---- */

// linkedom's DOMParser doesn't handle text/html; patch it so Tiptap's
// generateJSON can work in Node.js by routing through parseHTML instead.
// Note: Tiptap's elementFromString already wraps input in <body>, so we
// must NOT add another <body> here — just supply the outer document shell.
class NodeDOMParser {
  parseFromString(str: string, type: DOMParserSupportedType) {
    if (type === 'text/html') {
      return parseHTML('<!DOCTYPE html><html><head></head>' + str + '</html>').document
    }
    const { DOMParser } = parseHTML('<!DOCTYPE html><html><body></body></html>')
    return new DOMParser().parseFromString(str, type)
  }
}

// Polyfill window.DOMParser for the main process so generateJSON works.
// Kept minimal to avoid fooling isomorphic browser-detection in other libs.
const { document: stubDocument } = parseHTML('<!DOCTYPE html><html><body></body></html>')
;(globalThis as Record<string, unknown>).window = { DOMParser: NodeDOMParser }
;(globalThis as Record<string, unknown>).document = stubDocument

// Extensions that mirror the editor's schema — only the ones that affect
// parseHTML / renderMarkdown. UI-only extensions (Placeholder, the slash menu,
// DragHandle, Wikilink, Math, etc.) are omitted.
const serializerExtensions: AnyExtension[] = [
  StarterKit.configure({ codeBlock: false, paragraph: false }),
  CodeBlockLowlight.configure({}),
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
  Image.configure({ inline: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  // Single-color highlight, no TextStyle/Color — mirrors the editor schema:
  // colors have no Markdown form and were dropped at serialize time anyway.
  Highlight,
  ParagraphMarkdown,
]

const markdownManager = new MarkdownManager({ extensions: serializerExtensions })

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

/* ---- fetch ---- */

export async function fetchHtml(url: string, adapter: SiteAdapter | null): Promise<string> {
  const parsed = new URL(url)
  const extra = adapter?.fetchHeaders?.(parsed) ?? {}
  const resp = await net.fetch(url, {
    headers: { ...DEFAULT_HEADERS, ...extra },
  })
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${resp.statusText}`)
  return resp.text()
}

/* ---- HTML preprocessing ---- */

/** Generic lazy-image promotion (data-src → src). Handles self-closing tags. */
function promoteLazyImages(html: string): string {
  return html.replace(/<img\b([^>]*?)\/?>/gi, (_tag, attrs: string) => {
    const dataSrc = /data-src\s*=\s*"([^"]+)"/i.exec(attrs)
    if (!dataSrc) return _tag
    const src = /(?<![\w-])src\s*=\s*"([^"]*)"/i.exec(attrs)
    if (src && !/^data:|^$/.test(src[1])) return _tag
    const clean = attrs.replace(/\/\s*$/, '').trim()
    const fixed = src
      ? clean.replace(/(?<![\w-])src\s*=\s*"[^"]*"/i, `src="${dataSrc[1]}"`)
      : clean + ` src="${dataSrc[1]}"`
    return `<img ${fixed}>`
  })
}

export function preprocessHtml(html: string, url: string, adapter: SiteAdapter | null): string {
  const parsed = new URL(url)
  let out = html
  if (adapter?.preprocessHtml) out = adapter.preprocessHtml(out, parsed)
  out = promoteLazyImages(out)
  return out
}

/* ---- extraction ---- */

export interface Article {
  title: string
  content: string
  excerpt: string
  author: string
  siteName: string
}

export function extractArticle(html: string, url: string): Article {
  const { document } = parseHTML(html)

  try {
    Object.defineProperty(document, 'baseURI', { value: url, configurable: true })
  } catch {
    /* linkedom may not always support this */
  }

  const reader = new Readability(document as unknown as Document, { charThreshold: 100 })
  const article = reader.parse()

  if (!article || !article.content) {
    const fallbackTitle =
      document.querySelector('title')?.textContent?.trim() || new URL(url).hostname
    return { title: fallbackTitle, content: '', excerpt: '', author: '', siteName: '' }
  }

  return {
    title: article.title || new URL(url).hostname,
    content: article.content,
    excerpt: (article.excerpt || '').slice(0, 200),
    author: (article.byline || '').trim(),
    siteName: (article.siteName || '').trim(),
  }
}

/* ---- markdown conversion ---- */

export function htmlToMarkdown(html: string): string {
  if (!html) return ''
  const json = generateJSON(html, serializerExtensions)
  const md = markdownManager.serialize(json)
  // MarkdownManager's encodeHtmlEntities re-encodes & to &amp;
  return md.replace(/&amp;/g, '&').trim()
}

/* ---- word / image counts ---- */

export function countWords(text: string): number {
  const cjk = text.match(/[぀-ゟ㐀-䶿一-鿿豈-﫿]/g)?.length ?? 0
  const latin =
    text.replace(/[぀-ゟ㐀-䶿一-鿿豈-﫿]/g, ' ').match(/[A-Za-z0-9][A-Za-z0-9''_-]*/g)?.length ?? 0
  return cjk + latin
}

const IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g

export function countImages(markdown: string): number {
  return [...markdown.matchAll(IMG_RE)].filter((m) => !m[2].startsWith('data:')).length
}

/* ---- image download ---- */

const MAX_IMAGE_BYTES = 30 * 1024 * 1024

/** Magic-byte check for the common formats — used when Content-Type is
 *  missing or lies (octet-stream CDNs). */
export function sniffImageExt(buf: Buffer): string | null {
  if (buf.length < 12) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif'
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'webp'
  return null
}

/** Fetch one remote image (no Referer unless the caller sets one) into
 *  .assets/YYYY/MM/uuid.ext; returns the workspace-relative path. Null on
 *  failure, oversize (streamed with a hard cap — a hostile response must
 *  not balloon main-process memory), or non-image bodies (a 200 login /
 *  anti-bot page must not silently replace a working remote URL). */
export async function downloadImageToAssets(
  imgUrl: string,
  workspaceRoot: string,
  headers: Record<string, string> = {},
): Promise<string | null> {
  try {
    const resp = await net.fetch(imgUrl, { headers })
    if (!resp.ok || !resp.body) return null
    const declared = Number(resp.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null

    const reader = resp.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_IMAGE_BYTES) {
        void reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const buf = Buffer.concat(chunks)
    if (buf.length < 100) return null

    const contentType = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const sniffed = sniffImageExt(buf)
    if (!contentType.startsWith('image/') && !sniffed) return null
    const ext =
      (contentType.startsWith('image/') && mime.extension(contentType)) || sniffed || 'png'

    const now = new Date()
    const imageDir = path.join(
      workspaceRoot,
      '.assets',
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
    )
    await fs.ensureDir(imageDir)
    const localPath = path.join(imageDir, `${uuidv4()}.${ext}`)
    await fs.writeFile(localPath, buf)
    return path.relative(workspaceRoot, localPath).split(path.sep).join('/')
  } catch {
    return null
  }
}

export async function downloadImages(
  markdown: string,
  sourceUrl: string,
  workspaceRoot: string,
  adapter: SiteAdapter | null,
): Promise<string> {
  const matches = [...markdown.matchAll(IMG_RE)]
  if (matches.length === 0) return markdown

  let result = markdown
  const pageUrl = new URL(sourceUrl)
  const extraHeaders = adapter?.imageHeaders?.(pageUrl) ?? {}

  for (const match of matches) {
    const [full, alt, imgSrc] = match
    let imgUrl: string
    try {
      imgUrl = new URL(imgSrc, pageUrl).href
    } catch {
      continue
    }
    if (imgUrl.startsWith('data:')) continue

    const relPath = await downloadImageToAssets(imgUrl, workspaceRoot, extraHeaders)
    // Keep the original URL on failure.
    if (relPath) result = result.replace(full, `![${alt}](${relPath})`)
  }

  return result
}

/* ---- favicon ---- */

function extractFaviconUrl(html: string, pageUrl: string): string {
  const iconRe = /<link\b[^>]*rel\s*=\s*["'](?:shortcut\s+)?icon["'][^>]*>/gi
  const best = { url: '', size: 0 }

  for (const match of html.matchAll(iconRe)) {
    const tag = match[0]
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue
    const sizeMatch = /sizes\s*=\s*"(\d+)/i.exec(tag)
    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 16
    if (size >= best.size) {
      best.url = href
      best.size = size
    }
  }

  if (best.url) {
    try {
      return new URL(best.url, pageUrl).href
    } catch {
      /* fall through */
    }
  }

  const origin = new URL(pageUrl).origin
  return `${origin}/favicon.ico`
}

export async function downloadFavicon(
  html: string,
  sourceUrl: string,
  workspaceRoot: string,
): Promise<string> {
  const host = new URL(sourceUrl).hostname.replace(/^www\./, '')
  const dir = path.join(workspaceRoot, '.assets', 'favicons')

  // Reuse existing favicon for this host (exact stem match to avoid
  // example.com matching example.com.au)
  if (await fs.pathExists(dir)) {
    const existing = (await fs.readdir(dir)).find((f) => path.basename(f, path.extname(f)) === host)
    if (existing) return `.assets/favicons/${existing}`
  }

  const faviconUrl = extractFaviconUrl(html, sourceUrl)

  try {
    const resp = await net.fetch(faviconUrl, { headers: DEFAULT_HEADERS })
    if (!resp.ok) return ''

    const contentType = resp.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) return ''

    const buf = Buffer.from(await resp.arrayBuffer())
    if (buf.length < 50) return ''

    const ext = mime.extension(contentType.split(';')[0].trim()) || 'png'
    await fs.ensureDir(dir)
    const filename = `${host}.${ext}`
    await fs.writeFile(path.join(dir, filename), buf)
    return `.assets/favicons/${filename}`
  } catch {
    return ''
  }
}

/* ---- filesystem helpers ---- */

export function sanitizeFilename(title: string): string {
  return (
    title
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'Untitled'
  )
}

export async function uniquePath(filePath: string): Promise<string> {
  if (!(await fs.pathExists(filePath))) return filePath
  const dir = path.dirname(filePath)
  const ext = path.extname(filePath)
  const base = path.basename(filePath, ext)
  let n = 1
  let candidate: string
  do {
    candidate = path.join(dir, `${base} ${n}${ext}`)
    n++
  } while (await fs.pathExists(candidate))
  return candidate
}

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'utm_id',
  'utm_cid',
  'fbclid',
  'gclid',
  'gad_source',
  'dclid',
  'msclkid',
  'twclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
  'from',
  'isappinstalled',
  'scene',
  'nsukey',
  'sub_channel',
  'chksm',
  'wechat_redirect',
])

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    const cleaned = new URLSearchParams()
    u.searchParams.forEach((v, k) => {
      if (!TRACKING_PARAMS.has(k.toLowerCase())) cleaned.append(k, v)
    })
    u.search = cleaned.size ? '?' + cleaned.toString() : ''
    let out = u.href
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1)
    return out
  } catch {
    return raw.trim()
  }
}

export function buildFrontmatter(meta: {
  title: string
  source: string
  created: string
  excerpt: string
  author?: string
  site?: string
  words?: number
  favicon?: string
}): string {
  const lines = ['---']
  lines.push(`title: "${meta.title.replace(/"/g, '\\"')}"`)
  lines.push(`source: "${meta.source.replace(/"/g, '\\"')}"`)

  lines.push(`created: ${meta.created}`)
  if (meta.excerpt) {
    lines.push(`excerpt: "${meta.excerpt.replace(/"/g, '\\"')}"`)
  }
  if (meta.author) {
    lines.push(`author: "${meta.author.replace(/"/g, '\\"')}"`)
  }
  if (meta.site) {
    lines.push(`site: "${meta.site.replace(/"/g, '\\"')}"`)
  }
  if (meta.words && meta.words > 0) {
    lines.push(`words: ${meta.words}`)
  }
  if (meta.favicon) {
    lines.push(`favicon: "${meta.favicon}"`)
  }
  lines.push('---')
  return lines.join('\n')
}
