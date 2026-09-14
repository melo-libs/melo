import type { Editor } from '@tiptap/react'
import katex from 'katex'
import katexCss from 'katex/dist/katex.min.css?raw'
import type { Root as HastRoot, RootContent } from 'hast'
import { IpcChannels } from '@shared/types/ipc'
import i18n from '../../i18n'
import { toast } from '../Toaster'
import { getMarkdown } from '../../store/documentSession'
import { lowlight } from './CodeBlock'

/* ============================================================
   Document export — Markdown / standalone HTML / PDF.

   Markdown is the source itself with local image paths made
   absolute (no bundling — the user's call). HTML and PDF share
   one rendering: the live editor's HTML post-processed into a
   self-contained document (highlighted code, rendered math,
   base64 images) wrapped in a print-quality stylesheet that
   mirrors the editor's reading typography via system stacks.
   ============================================================ */

const CANCELLED = 'Operation cancelled'

const isRemoteOrData = (src: string) => /^(https?:|data:|file:)/i.test(src)

// ---------- Markdown ----------

const isAbsolutePath = (p: string) => p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)

export async function exportMarkdown(
  editor: Editor,
  title: string,
  workspacePath: string,
  frontmatter: string,
): Promise<void> {
  // Handles both destination forms — plain and angle-bracketed (used for
  // paths with spaces/parens). An optional "title" after the destination
  // is preserved untouched.
  const rewrite = (src: string) =>
    isRemoteOrData(src) || isAbsolutePath(src) ? src : `${workspacePath}/${src}`
  const body = getMarkdown(editor)
    .replace(
      /(!\[[^\]]*\]\(<)([^>]+)(>[^)]*\))/g,
      (_f, pre: string, src: string, post: string) => `${pre}${rewrite(src)}${post}`,
    )
    .replace(
      /(!\[[^\]]*\]\()(?!<)([^)\s]+)([^)]*\))/g,
      (_f, pre: string, src: string, post: string) => `${pre}${rewrite(src)}${post}`,
    )
  // Frontmatter never enters the editor — without this the export would
  // silently drop tags / capture source.
  const md = frontmatter ? `${frontmatter}\n${body}` : body
  const res = await window.api.invoke(IpcChannels.InvokeSaveAs, {
    content: md,
    defaultPath: `${title}.md`,
  })
  finishToast(res.success, res.error)
}

// ---------- Shared HTML rendering ----------

/** Minimal hast → HTML for lowlight's highlight trees (elements, text). */
function hastToHtml(node: HastRoot | RootContent): string {
  if (node.type === 'text') return escapeHtml(node.value)
  if (node.type === 'root') return node.children.map(hastToHtml).join('')
  if (node.type === 'element') {
    const cls = Array.isArray(node.properties?.className)
      ? ` class="${(node.properties.className as string[]).join(' ')}"`
      : ''
    return `<${node.tagName}${cls}>${node.children.map(hastToHtml).join('')}</${node.tagName}>`
  }
  return ''
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
}

/** Above this an image stays a (relative) link instead of ballooning the
 *  renderer through bytes → binary string → base64 → HTML. */
const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024

async function inlineImages(root: HTMLElement, workspacePath: string): Promise<void> {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    // The editor serializes workspace images behind its app:// protocol —
    // strip it back to the stored relative path.
    const raw = img.getAttribute('src') ?? ''
    const src = raw.startsWith('app://') ? raw.slice(6) : raw
    if (!src || isRemoteOrData(src)) continue
    // Whatever happens below, app:// must not leak into the artifact.
    img.setAttribute('src', src)
    const abs = src.startsWith('/') ? src : `${workspacePath}/${src}`
    const res = await window.api.invoke(IpcChannels.InvokeReadFileBinary, { filePath: abs })
    if (!res.success || !res.data) continue
    if (res.data.data.length > MAX_INLINE_IMAGE_BYTES) continue
    const ext = abs.slice(abs.lastIndexOf('.') + 1).toLowerCase()
    const mime = IMAGE_MIME[ext] ?? 'application/octet-stream'
    const bytes = res.data.data
    let binary = ''
    // Chunked — String.fromCharCode(...bytes) overflows the arg limit on
    // large images.
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    img.setAttribute('src', `data:${mime};base64,${btoa(binary)}`)
  }
}

function highlightCode(root: HTMLElement): void {
  for (const code of Array.from(root.querySelectorAll('pre code'))) {
    const lang = /language-(\S+)/.exec(code.className)?.[1]
    if (!lang || !lowlight.registered(lang)) continue
    code.innerHTML = hastToHtml(lowlight.highlight(lang, code.textContent ?? ''))
  }
}

/** Returns true when the document contained math (KaTeX CSS is needed). */
function renderMath(root: HTMLElement): boolean {
  const nodes = root.querySelectorAll('[data-type="inline-math"], [data-type="block-math"]')
  for (const el of Array.from(nodes)) {
    const latex = el.getAttribute('data-latex') ?? ''
    el.innerHTML = katex.renderToString(latex, {
      throwOnError: false,
      displayMode: el.getAttribute('data-type') === 'block-math',
    })
  }
  return nodes.length > 0
}

async function buildExportHtml(
  editor: Editor,
  title: string,
  workspacePath: string,
): Promise<string> {
  const doc = new DOMParser().parseFromString(`<article>${editor.getHTML()}</article>`, 'text/html')
  const article = doc.body.firstElementChild as HTMLElement

  highlightCode(article)
  const hasMath = renderMath(article)
  await inlineImages(article, workspacePath)

  // The raw KaTeX css points at url(fonts/…) — embed the woff2 set so the
  // artifact is truly standalone. Lazy: only math-bearing exports pay.
  const mathCss = hasMath ? (await import('./katexFonts')).embedKatexFonts(katexCss) : ''

  // The file name is the document's title; repeat it as the document
  // heading unless the body already opens with its own H1.
  const firstEl = article.firstElementChild
  const titleHtml =
    firstEl?.tagName === 'H1' ? '' : `<h1 class="doc-title">${escapeHtml(title)}</h1>`

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
${EXPORT_CSS}
${mathCss}
</style>
</head>
<body>
<article class="melo-doc">
${titleHtml}${article.innerHTML}
</article>
</body>
</html>
`
}

// ---------- HTML / PDF ----------

export async function exportHtml(
  editor: Editor,
  title: string,
  workspacePath: string,
): Promise<void> {
  const html = await buildExportHtml(editor, title, workspacePath)
  const res = await window.api.invoke(IpcChannels.InvokeSaveAs, {
    content: html,
    defaultPath: `${title}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  })
  finishToast(res.success, res.error)
}

export async function exportPdf(
  editor: Editor,
  title: string,
  workspacePath: string,
): Promise<void> {
  const html = await buildExportHtml(editor, title, workspacePath)
  const res = await window.api.invoke(IpcChannels.InvokeExportPDF, {
    html,
    defaultName: title,
  })
  finishToast(res.success, res.error)
}

function finishToast(ok: boolean, error?: string): void {
  if (ok) toast(i18n.t('editor.exportDone'))
  else if (error !== CANCELLED) toast(error || i18n.t('editor.exportFailed'))
}

/* ============================================================
   Export stylesheet — the editor's reading typography rebuilt on
   system font stacks (the artifact must not depend on bundled
   fonts). Values track the editor scale: 16px body, 28/24/20
   headings, serif display over sans reading.
   ============================================================ */

const EXPORT_CSS = `
:root {
  --ink: #1f2023;
  --ink-2: #43464b;
  --ink-3: #74777d;
  --hairline: #e5e6e8;
  --paper-2: #f5f5f4;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--ink);
  background: #fff;
  font-family: 'Source Sans 3', 'Source Sans Pro', 'PingFang SC', 'Microsoft YaHei',
    -apple-system, sans-serif;
  font-size: 16px;
  line-height: 1.75;
  -webkit-font-smoothing: antialiased;
}
.melo-doc {
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 32px 96px;
  overflow-wrap: break-word;
}
h1, h2, h3, h4 {
  font-family: 'Source Serif 4', 'Source Serif Pro', Georgia, 'Songti SC', serif;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
}
h1 { font-size: 28px; margin: 36px 0 12px; }
h2 { font-size: 24px; margin: 28px 0 10px; }
h3 { font-size: 20px; margin: 24px 0 8px; }
h1.doc-title { margin-top: 0; }
p { margin: 0 0 16px; }
a { color: #2563eb; text-underline-offset: 2px; }
strong { font-weight: 600; }
mark { background: #fef3c0; padding: 0 2px; }
blockquote {
  margin: 16px 0;
  padding: 2px 0 2px 16px;
  border-left: 3px solid var(--hairline);
  color: var(--ink-2);
}
hr { border: 0; border-top: 1px solid var(--hairline); margin: 24px 0; }
img { max-width: 100%; border-radius: 4px; }
code {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
  font-size: 14px;
  background: var(--paper-2);
  border-radius: 4px;
  padding: 1px 5px;
}
pre {
  background: var(--paper-2);
  border: 1px solid var(--hairline);
  border-radius: 8px;
  padding: 14px 16px;
  overflow-x: auto;
  margin: 16px 0;
}
pre code { background: none; padding: 0; font-size: 13px; line-height: 1.6; }
ul, ol { margin: 0 0 16px; padding-left: 24px; }
li { margin: 4px 0; }
ul[data-type='taskList'] { list-style: none; padding-left: 4px; }
ul[data-type='taskList'] li { display: flex; gap: 8px; align-items: baseline; }
ul[data-type='taskList'] input { accent-color: #2563eb; }
ul[data-type='taskList'] p, td p, th p { margin: 0; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 14px; }
th, td { border: 1px solid var(--hairline); padding: 6px 10px; text-align: left; }
th { background: var(--paper-2); font-weight: 600; }
[data-type='block-math'] { margin: 16px 0; text-align: center; }
/* lowlight (highlight.js classes) — quiet, editor-matching palette */
.hljs-comment, .hljs-quote { color: #8b909a; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal { color: #7c3aed; }
.hljs-string, .hljs-regexp, .hljs-addition { color: #15803d; }
.hljs-number, .hljs-attr, .hljs-symbol { color: #b45309; }
.hljs-title, .hljs-function, .hljs-section { color: #1d4ed8; }
.hljs-type, .hljs-built_in, .hljs-class { color: #0e7490; }
.hljs-deletion { color: #b91c1c; }
@media print {
  .melo-doc { max-width: none; padding: 0; }
  pre { white-space: pre-wrap; }
}
`
