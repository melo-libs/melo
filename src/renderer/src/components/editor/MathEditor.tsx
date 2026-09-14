import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import katex from 'katex'
import type { Editor } from '@tiptap/core'
import { Icon } from '../Icon'
import { explainMathError, type MathHint } from './mathError'

/* ============================================================
   Equation editor — an anchored popover for editing LaTeX, per
   the design's `EquationEditor`. A grouped symbol/template quick-
   bar (inserts at the caret), a monospace LaTeX field, a live
   KaTeX preview that holds its last good render on error, a quiet
   error caption, and keyboard commit (inline ↵ · block ⌘↵).

   The inline/block toggle drives the preview's display mode,
   placeholder and keyboard; switching it and committing also
   converts the node between inline ($…$) and display ($$…$$).
   ============================================================ */

// caret sentinel inside insert snippets — replaced, cursor lands there
const EQ_CARET = '‸'

type EqItem = { lab?: string; text?: string; ins: string; tmpl?: boolean }

// lab : LaTeX rendered on the button (omit when `text` is given)
// ins : snippet inserted at the caret (EQ_CARET marks the cursor)
const EQ_GROUPS: EqItem[][] = [
  [
    { lab: 'x^{2}', ins: '^{' + EQ_CARET + '}' },
    { lab: 'x_{n}', ins: '_{' + EQ_CARET + '}' },
    { lab: '\\frac{a}{b}', ins: '\\frac{' + EQ_CARET + '}{}', tmpl: true },
    { lab: '\\sqrt{x}', ins: '\\sqrt{' + EQ_CARET + '}' },
    { lab: '\\sqrt[n]{x}', ins: '\\sqrt[' + EQ_CARET + ']{}' },
    { lab: '\\sum', ins: '\\sum_{' + EQ_CARET + '}^{}' },
    { lab: '\\int', ins: '\\int_{' + EQ_CARET + '}^{}' },
    { lab: '\\infty', ins: '\\infty' },
  ],
  [
    { lab: '\\alpha', ins: '\\alpha' },
    { lab: '\\beta', ins: '\\beta' },
    { lab: '\\gamma', ins: '\\gamma' },
    { lab: '\\theta', ins: '\\theta' },
    { lab: '\\lambda', ins: '\\lambda' },
    { lab: '\\mu', ins: '\\mu' },
    { lab: '\\pi', ins: '\\pi' },
    { lab: '\\sigma', ins: '\\sigma' },
    { lab: '\\phi', ins: '\\phi' },
    { lab: '\\omega', ins: '\\omega' },
    { lab: '\\Sigma', ins: '\\Sigma' },
    { lab: '\\Omega', ins: '\\Omega' },
  ],
  [
    { lab: '\\times', ins: '\\times' },
    { lab: '\\cdot', ins: '\\cdot' },
    { lab: '\\pm', ins: '\\pm' },
    { lab: '\\neq', ins: '\\neq' },
    { lab: '\\leq', ins: '\\leq' },
    { lab: '\\geq', ins: '\\geq' },
    { lab: '\\approx', ins: '\\approx' },
    { lab: '\\to', ins: '\\to' },
    { lab: '\\partial', ins: '\\partial' },
    { lab: '\\nabla', ins: '\\nabla' },
  ],
  [
    { lab: '\\vec{a}', ins: '\\vec{' + EQ_CARET + '}' },
    { lab: '\\hat{a}', ins: '\\hat{' + EQ_CARET + '}' },
    { lab: '\\bar{a}', ins: '\\overline{' + EQ_CARET + '}' },
    {
      text: 'matrix',
      ins: '\\begin{pmatrix} ' + EQ_CARET + ' & \\\\ & \\end{pmatrix}',
      tmpl: true,
    },
    { text: 'cases', ins: '\\begin{cases} ' + EQ_CARET + ' & \\\\ & \\end{cases}', tmpl: true },
    {
      text: 'aligned',
      ins: '\\begin{aligned} ' + EQ_CARET + ' &= \\\\ &= \\end{aligned}',
      tmpl: true,
    },
  ],
]

function katexHTML(tex: string, displayMode: boolean): string | null {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode })
  } catch {
    return null
  }
}

interface MathTarget {
  pos: number
  latex: string
  block: boolean
  fresh: boolean
  rect: { left: number; top: number; bottom: number }
}

function EqSym({ item, onInsert }: { item: EqItem; onInsert: (ins: string) => void }) {
  const html = useMemo(() => (item.text ? null : katexHTML(item.lab ?? '', false)), [item])
  return (
    <button
      className={'eq-sym' + (item.tmpl ? ' tmpl' : '')}
      title={item.text || item.ins.replace(EQ_CARET, '')}
      onMouseDown={(e) => {
        e.preventDefault()
        onInsert(item.ins)
      }}
    >
      {item.text ? (
        item.text
      ) : html ? (
        <span dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        item.lab
      )}
    </button>
  )
}

export const MathEditor = ({ editor }: { editor: Editor }) => {
  const [target, setTarget] = useState<MathTarget | null>(null)

  // Listen for open requests (click an existing node, or fresh slash insert).
  useEffect(() => {
    const onEdit = (e: Event) => {
      const { pos, latex, block, fresh } = (e as CustomEvent).detail
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null
      const r = dom?.getBoundingClientRect()
      setTarget({
        pos,
        latex: latex || '',
        block: !!block,
        fresh: !!fresh,
        rect: r
          ? { left: r.left, top: r.top, bottom: r.bottom }
          : { left: 120, top: 120, bottom: 140 },
      })
    }
    window.addEventListener('melo:math-edit', onEdit)
    return () => window.removeEventListener('melo:math-edit', onEdit)
  }, [editor])

  // While the equation editor is open, suppress the selection bubble menu — the
  // node stays selected underneath, and the two popovers must not overlap.
  useEffect(() => {
    if (!target) return
    document.body.classList.add('melo-eq-editing')
    return () => document.body.classList.remove('melo-eq-editing')
  }, [target])

  if (!target) return null
  return (
    <EquationEditor
      key={target.pos + ':' + target.block}
      editor={editor}
      target={target}
      onClose={() => setTarget(null)}
    />
  )
}

function EquationEditor({
  editor,
  target,
  onClose,
}: {
  editor: Editor
  target: MathTarget
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState(target.latex)
  const [mode, setMode] = useState<'inline' | 'block'>(target.block ? 'block' : 'inline')
  const [err, setErr] = useState<MathHint | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const prevRef = useRef<HTMLSpanElement>(null)
  const pendingCaret = useRef<number | null>(null)

  // focus the field on open, caret at end
  useEffect(() => {
    const el = taRef.current
    if (el) {
      el.focus()
      const n = el.value.length
      try {
        el.setSelectionRange(n, n)
      } catch {
        /* noop */
      }
    }
  }, [])

  // apply caret after a palette insertion
  useEffect(() => {
    if (pendingCaret.current != null && taRef.current) {
      const p = pendingCaret.current
      pendingCaret.current = null
      taRef.current.focus()
      try {
        taRef.current.setSelectionRange(p, p)
      } catch {
        /* noop */
      }
    }
  }, [value])

  // live preview — renderToString throws without touching the node, so the
  // last good render stays on screen when the new input is invalid.
  useEffect(() => {
    const el = prevRef.current
    if (!el) return
    const v = value.trim()
    if (!v) {
      el.innerHTML = ''
      setErr(null)
      return
    }
    try {
      el.innerHTML = katex.renderToString(v, { displayMode: mode === 'block', throwOnError: true })
      setErr(null)
    } catch (e) {
      setErr(explainMathError(e, v))
    }
  }, [value, mode, t])

  const insert = (snippet: string) => {
    const el = taRef.current
    const start = el ? el.selectionStart : value.length
    const end = el ? el.selectionEnd : value.length
    const mk = snippet.indexOf(EQ_CARET)
    const clean = snippet.replace(EQ_CARET, '')
    pendingCaret.current = mk >= 0 ? start + mk : start + clean.length
    setValue(value.slice(0, start) + clean + value.slice(end))
  }

  // Apply a one-click correction (command spelling, or stripping extra
  // backslashes) by running its transform over the current value.
  const applyFix = (fix: NonNullable<MathHint['fix']>) => {
    setValue(fix.apply(value))
    taRef.current?.focus()
  }

  // Validate that target.pos still resolves to the math node we opened, so a
  // stale position (after some other transaction) never updates/deletes the
  // wrong node. Returns the expected type name, or null if the node moved.
  const liveType = (): 'blockMath' | 'inlineMath' | null => {
    const expected = target.block ? 'blockMath' : 'inlineMath'
    const node = editor.state.doc.nodeAt(target.pos)
    return node && node.type.name === expected ? expected : null
  }

  const commit = () => {
    const latex = value.trim()
    const cur = liveType()
    if (!cur) {
      onClose()
      return
    }
    const wantBlock = mode === 'block'
    if (wantBlock === target.block) {
      // Same type — just rewrite the LaTeX in place.
      if (target.block) editor.chain().updateBlockMath({ pos: target.pos, latex }).run()
      else editor.chain().updateInlineMath({ pos: target.pos, latex }).run()
    } else if (wantBlock) {
      // Inline → block: replace the inline atom with a display equation
      // (this splits the surrounding paragraph).
      editor
        .chain()
        .insertContentAt(
          { from: target.pos, to: target.pos + 1 },
          { type: 'blockMath', attrs: { latex } },
        )
        .run()
    } else {
      // Block → inline: replace the block with a paragraph holding inline math.
      editor
        .chain()
        .insertContentAt(
          { from: target.pos, to: target.pos + 1 },
          { type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex } }] },
        )
        .run()
    }
    onClose()
  }

  const cancel = () => {
    // A freshly inserted node the user backed out of leaves no orphan — but
    // only delete if the position still points at that very node.
    if (target.fresh && liveType()) {
      if (target.block) editor.chain().deleteBlockMath({ pos: target.pos }).run()
      else editor.chain().deleteInlineMath({ pos: target.pos }).run()
    }
    onClose()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
      return
    }
    if (e.key === 'Enter') {
      if (mode === 'inline' && !e.shiftKey) {
        e.preventDefault()
        commit()
      } else if (mode === 'block' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        commit()
      }
    }
  }

  // position: anchored under the equation, clamped to the viewport
  const W = mode === 'inline' ? 420 : 468
  const estH = mode === 'inline' ? 300 : 420
  const left = Math.min(Math.max(8, target.rect.left | 0), window.innerWidth - W - 8)
  let top = (target.rect.bottom | 0) + 8
  if (top + estH > window.innerHeight - 8) {
    const above = (target.rect.top | 0) - estH - 8
    top = above >= 8 ? above : Math.max(8, window.innerHeight - estH - 8)
  }

  return (
    <>
      <div
        className="eq-scrim"
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          cancel()
        }}
      />
      <div className={'eq' + (mode === 'inline' ? ' inline' : '')} style={{ left, top }}>
        <div className="eq-head">
          <span className="eq-head-glyph">
            <Icon name="sigma" size={15} />
          </span>
          <span className="eq-head-title">
            {mode === 'inline' ? t('math.inlineMath') : t('math.equation')}
          </span>
          <div className="eq-mode">
            <button
              data-on={mode === 'inline'}
              onMouseDown={(e) => {
                e.preventDefault()
                setMode('inline')
              }}
            >
              {t('math.inline')}
            </button>
            <button
              data-on={mode === 'block'}
              onMouseDown={(e) => {
                e.preventDefault()
                setMode('block')
              }}
            >
              {t('math.block')}
            </button>
          </div>
        </div>

        <div className="eq-palette">
          {EQ_GROUPS.map((g, gi) => (
            <div className="eq-pgroup" key={gi}>
              {g.map((it, ii) => (
                <EqSym key={ii} item={it} onInsert={insert} />
              ))}
            </div>
          ))}
        </div>

        <textarea
          ref={taRef}
          className="eq-input"
          value={value}
          spellCheck={false}
          rows={mode === 'inline' ? 1 : 3}
          placeholder={mode === 'inline' ? t('math.inlineExample') : t('math.blockExample')}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
        />

        <div className={'eq-preview' + (mode === 'inline' ? ' inline' : '')}>
          {value.trim() ? (
            <span ref={prevRef} />
          ) : (
            <span className="eq-preview-empty">{t('math.livePreview')}</span>
          )}
        </div>

        {err && (
          <div className="eq-err">
            <span className="eq-err-dot">⚠</span>
            <span className="eq-err-text">{err.text}</span>
            {err.fix && (
              <button
                className="eq-err-fix"
                onMouseDown={(e) => {
                  e.preventDefault()
                  applyFix(err.fix!)
                }}
              >
                {err.fix.label}
              </button>
            )}
          </div>
        )}

        <div className="eq-foot">
          <div className="eq-foot-hint">
            {mode === 'inline' ? (
              <>
                <span>
                  <kbd>↵</kbd> {t('math.hintInsert')}
                </span>
                <span>
                  <kbd>⇧ ↵</kbd> {t('math.hintNewLine')}
                </span>
                <span>
                  <kbd>esc</kbd> {t('math.hintCancel')}
                </span>
              </>
            ) : (
              <>
                <span>
                  <kbd>⌘ ↵</kbd> {t('math.hintInsert')}
                </span>
                <span>
                  <kbd>↵</kbd> {t('math.hintNewLine')}
                </span>
                <span>
                  <kbd>esc</kbd> {t('math.hintCancel')}
                </span>
              </>
            )}
          </div>
          <div className="eq-foot-actions">
            <button
              className="eq-cancel"
              onMouseDown={(e) => {
                e.preventDefault()
                cancel()
              }}
            >
              {t('common.cancel')}
            </button>
            <button
              className="eq-done"
              onMouseDown={(e) => {
                e.preventDefault()
                commit()
              }}
            >
              {t('math.insert')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
