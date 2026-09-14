import path from 'path'
import fs from 'fs-extra'
import { indexFile } from '../indexer'
import { builtinAdapters } from './adapters'
import type { SiteAdapter } from './types'
import {
  fetchHtml,
  preprocessHtml,
  extractArticle,
  htmlToMarkdown,
  countWords,
  countImages,
  downloadImages,
  downloadFavicon,
  sanitizeFilename,
  uniquePath,
  buildFrontmatter,
  normalizeUrl,
} from './pipeline'

export type { SiteAdapter } from './types'

/* ----------------------------------------------------------------
   Adapter resolution — walk the registry, first match wins.
   ---------------------------------------------------------------- */

function resolveAdapter(url: string): SiteAdapter | null {
  const parsed = new URL(url)
  return builtinAdapters.find((a) => a.match(parsed)) ?? null
}

/* ----------------------------------------------------------------
   Public API
   ---------------------------------------------------------------- */

export interface CaptureResult {
  filePath: string
  title: string
  wordCount: number
  excerpt: string
  empty: boolean
}

export interface PreviewResult {
  title: string
  host: string
  wordCount: number
  imageCount: number
  excerpt: string
  bodyPreview: string
}

export async function previewUrl(url: string): Promise<PreviewResult> {
  const adapter = resolveAdapter(url)
  const html = await fetchHtml(url, adapter)
  const processed = preprocessHtml(html, url, adapter)
  const article = extractArticle(processed, url)
  const markdown = htmlToMarkdown(article.content)
  const parsed = new URL(url)
  const host = parsed.hostname.replace(/^www\./, '')
  const title = adapter?.cleanTitle ? adapter.cleanTitle(article.title, parsed) : article.title
  return {
    title,
    host,
    wordCount: countWords(markdown),
    imageCount: countImages(markdown),
    excerpt: article.excerpt,
    bodyPreview: markdown,
  }
}

export async function capture(
  url: string,
  destFolder: string,
  workspaceRoot: string,
  opts: { downloadImages?: boolean } = {},
): Promise<CaptureResult> {
  const adapter = resolveAdapter(url)
  const html = await fetchHtml(url, adapter)
  const processed = preprocessHtml(html, url, adapter)
  const article = extractArticle(processed, url)
  const parsed = new URL(url)
  const title = adapter?.cleanTitle ? adapter.cleanTitle(article.title, parsed) : article.title

  const rawMarkdown = htmlToMarkdown(article.content)
  const [markdown, favicon] = await Promise.all([
    // Settings can keep clips on remote URLs — smaller workspace, needs
    // the network to render.
    opts.downloadImages === false
      ? Promise.resolve(rawMarkdown)
      : downloadImages(rawMarkdown, url, workspaceRoot, adapter),
    downloadFavicon(html, url, workspaceRoot),
  ])

  const wordCount = countWords(markdown)
  // Full instant, not just the day — the file is the only durable home
  // for the capture moment (the index is a rebuildable cache, and fs
  // birthtime becomes sync time on synced folders).
  const created = new Date().toISOString()
  const frontmatter = buildFrontmatter({
    title,
    source: normalizeUrl(url),
    created,
    excerpt: article.excerpt,
    author: article.author || undefined,
    site: article.siteName || undefined,
    words: wordCount,
    favicon: favicon || undefined,
  })

  const heading = /^#\s[^#]/.test(markdown.trimStart()) ? '' : `# ${title}\n\n`
  const content = frontmatter + '\n\n' + heading + markdown + '\n'
  const filename = sanitizeFilename(title) + '.md'
  const filePath = await uniquePath(path.join(destFolder, filename))

  await fs.ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, content, 'utf-8')

  indexFile(filePath)

  return {
    filePath,
    title,
    wordCount,
    excerpt: article.excerpt,
    empty: !markdown.trim(),
  }
}
