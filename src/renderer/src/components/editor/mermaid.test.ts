import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMParser, parseHTML } from 'linkedom'
import { renderMermaid, renderMermaidBlocks } from './mermaid'

const engine = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))
vi.mock('mermaid', () => ({ default: engine }))

beforeEach(() => {
  vi.stubGlobal('DOMParser', DOMParser)
  vi.clearAllMocks()
  engine.render.mockResolvedValue({
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>你好</text></svg>',
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('Mermaid rendering', () => {
  it('preserves intrinsic diagram dimensions in image contexts', async () => {
    engine.render.mockResolvedValueOnce({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 640 320"></svg>',
    })
    const url = await renderMermaid('flowchart LR\nA --> B')
    const svg = decodeURIComponent(url.split(',')[1])
    expect(svg).toContain('width="640"')
    expect(svg).toContain('height="320"')
  })
  it('uses locked strict settings and returns an image rather than live markup', async () => {
    const url = await renderMermaid('flowchart LR\nA --> B', true)
    expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(url.split(',')[1])).toContain('你好')
    expect(engine.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: 'strict',
        htmlLabels: false,
        theme: 'dark',
        startOnLoad: false,
        secure: expect.arrayContaining([
          'securityLevel',
          'secure',
          'themeCSS',
          'flowchart',
          'htmlLabels',
        ]),
      }),
    )
  })

  it('serializes theme configuration with each render and recovers after an invalid diagram', async () => {
    const order: string[] = []
    engine.initialize.mockImplementation((config) => {
      order.push(config.theme)
    })
    engine.render
      .mockImplementationOnce(async () => {
        order.push('invalid')
        throw Error('Syntax error')
      })
      .mockImplementationOnce(async () => {
        order.push('valid')
        return { svg: '<svg />' }
      })
    const invalid = renderMermaid('bad input', true)
    const valid = renderMermaid('flowchart LR\nA --> B')
    await expect(invalid).rejects.toThrow('Syntax error')
    await expect(valid).resolves.toMatch(/^data:image/)
    expect(order).toEqual(['dark', 'invalid', 'default', 'valid'])
  })

  it('rejects oversized source before Mermaid can silently replace it', async () => {
    await expect(renderMermaid('x'.repeat(50_001))).rejects.toThrow('50,000')
    expect(engine.render).not.toHaveBeenCalled()
  })

  it('exports diagrams as embedded images and retains invalid source and other code', async () => {
    const { document } = parseHTML(
      '<article><pre><code class="language-mermaid">flowchart LR\nA --&gt; B</code></pre><pre><code class="language-mermaid">bad input</code></pre><pre><code class="language-js">let a = 1</code></pre></article>',
    )
    engine.render
      .mockResolvedValueOnce({ svg: '<svg />' })
      .mockRejectedValueOnce(Error('Syntax error'))
    const root = document.querySelector('article')! as unknown as HTMLElement
    await renderMermaidBlocks(root)
    expect(root.querySelector('.mermaid-diagram img')?.getAttribute('src')).toMatch(/^data:image/)
    expect(root.querySelector('code.language-mermaid')?.textContent).toBe('bad input')
    expect(root.querySelector('.mermaid-error')?.textContent).toBe('Syntax error')
    expect(root.querySelector('code.language-js')?.textContent).toBe('let a = 1')
    expect(root.querySelector('script')).toBeNull()
  })

  it('exports the same case-insensitive language variants accepted by the editor', async () => {
    const { document } = parseHTML(
      '<article><pre><code class="language-Mermaid">flowchart LR\nA --&gt; B</code></pre></article>',
    )
    const root = document.querySelector('article')! as unknown as HTMLElement
    await renderMermaidBlocks(root)
    expect(root.querySelector('.mermaid-diagram img')).not.toBeNull()
  })
})
