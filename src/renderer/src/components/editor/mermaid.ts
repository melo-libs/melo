import type { Mermaid } from 'mermaid'

export const MERMAID_LANGUAGE = 'mermaid'
export const MERMAID_EXAMPLE = 'flowchart LR\n  A[Start] --> B[Finish]'
const MAX_SOURCE_LENGTH = 50_000
let engine: Mermaid | undefined
let nextId = 0
let queue = Promise.resolve()

/** Mermaid configuration is global; serialize initialization together with rendering. */
export function renderMermaid(source: string, dark = false): Promise<string> {
  const job = queue.then(async () => {
    if (source.length > MAX_SOURCE_LENGTH)
      throw new Error('Diagram source exceeds 50,000 characters.')
    engine ??= (await import('mermaid')).default
    engine.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: MAX_SOURCE_LENGTH,
      maxEdges: 500,
      htmlLabels: false,
      theme: dark ? 'dark' : 'default',
      fontFamily: 'sans-serif',
      flowchart: { htmlLabels: false },
      secure: [
        'secure',
        'securityLevel',
        'startOnLoad',
        'maxTextSize',
        'maxEdges',
        'suppressErrorRendering',
        'htmlLabels',
        'flowchart',
        'theme',
        'themeCSS',
        'themeVariables',
        'fontFamily',
      ],
    })
    const { svg } = await engine.render(`melo-mermaid-${++nextId}`, source)
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
    const viewBox = root
      .getAttribute('viewBox')
      ?.trim()
      .split(/[\s,]+/)
    // Mermaid's percentage dimensions lose their intrinsic size inside <img>.
    if (viewBox?.length === 4) {
      root.setAttribute('width', viewBox[2])
      root.setAttribute('height', viewBox[3])
    }
    // An image context keeps diagram markup out of the privileged editor DOM.
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(root.outerHTML)}`
  })
  // A broken diagram must not stop subsequent diagrams from rendering.
  queue = job.then(
    () => {},
    () => {},
  )
  return job
}

export async function renderMermaidBlocks(root: HTMLElement): Promise<void> {
  for (const code of root.querySelectorAll<HTMLElement>('pre > code')) {
    if (
      !Array.from(code.classList).some(
        (name) => name.toLowerCase() === `language-${MERMAID_LANGUAGE}`,
      )
    )
      continue
    const source = code.textContent ?? ''
    const pre = code.parentElement!
    try {
      const image = root.ownerDocument.createElement('img')
      image.src = await renderMermaid(source)
      image.alt = 'Mermaid diagram'
      const figure = root.ownerDocument.createElement('figure')
      figure.className = 'mermaid-diagram'
      figure.append(image)
      pre.replaceWith(figure)
    } catch (error) {
      // Invalid diagrams export as their original code, with an explanation.
      const caption = root.ownerDocument.createElement('p')
      caption.className = 'mermaid-error'
      caption.textContent = error instanceof Error ? error.message : String(error)
      pre.after(caption)
    }
  }
}
