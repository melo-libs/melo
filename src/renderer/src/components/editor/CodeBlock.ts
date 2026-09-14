import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import type { EditorState } from '@tiptap/pm/state'
import { toast } from '../Toaster'
import i18n from '../../i18n'
import { appStore } from '../../store/appStore'
import { settingsAtom } from '../../store/settings'

/* ============================================================
   MeloCodeBlock — CodeBlockLowlight plus the ergonomics a code
   block needs: a line-number gutter, a language chip that opens a
   filter-as-you-type picker (persists into the markdown fence), a
   hover copy button, Tab / Shift-Tab indentation and
   indent-preserving Enter. Gutter / chip / copy are view-only
   chrome — the markdown round-trip carries exactly the fence
   language and the text.
   ============================================================ */

export const lowlight = createLowlight(common)

export const CODE_LANGUAGES = lowlight.listLanguages().sort()

/** Current line's bounds inside a code block, in doc positions. */
function currentLine(state: EditorState): {
  indent: string
  lineStart: number
  atLineText: string
  fullLine: string
} | null {
  const { $from } = state.selection
  if ($from.parent.type.name !== 'codeBlock') return null
  const text = $from.parent.textContent
  const offset = $from.parentOffset
  const lineStartOffset = text.lastIndexOf('\n', offset - 1) + 1
  let lineEndOffset = text.indexOf('\n', offset)
  if (lineEndOffset === -1) lineEndOffset = text.length
  const atLineText = text.slice(lineStartOffset, offset)
  const indent = /^[\t ]*/.exec(text.slice(lineStartOffset))?.[0] ?? ''
  return {
    indent,
    lineStart: $from.start() + lineStartOffset,
    atLineText,
    fullLine: text.slice(lineStartOffset, lineEndOffset),
  }
}

/** Start offsets (block-relative) of every line the selection touches —
 *  null unless the whole selection sits in ONE code block (a range that
 *  leaks outside must fall through, not get eaten by an indent). */
function selectedLineStarts(state: EditorState): { base: number; offsets: number[] } | null {
  const { $from, $to } = state.selection
  if ($from.parent.type.name !== 'codeBlock' || $from.parent !== $to.parent) return null
  const text = $from.parent.textContent
  const offsets = [text.lastIndexOf('\n', $from.parentOffset - 1) + 1]
  for (let i = $from.parentOffset; i < $to.parentOffset; i++) {
    if (text[i] === '\n') offsets.push(i + 1)
  }
  return { base: $from.start(), offsets }
}

/** What Tab inserts — from Settings (tab / 2 spaces / 4 spaces). */
function indentUnit(): string {
  const pref = appStore.get(settingsAtom).codeIndent
  return pref === 'tab' ? '\t' : ' '.repeat(Number(pref))
}

/** How many chars one outdent step removes at a given line start. Space
 *  runs shrink by up to one indent unit so outdent mirrors indent. */
function outdentWidth(text: string, offset: number): number {
  if (text.startsWith('\t', offset)) return 1
  const unit = indentUnit().length === 1 ? 2 : indentUnit().length
  for (let n = unit; n >= 1; n--) {
    if (text.startsWith(' '.repeat(n), offset)) return n
  }
  return 0
}

export const MeloCodeBlock = CodeBlockLowlight.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Tab must never walk focus out of the document — inside a code
      // block it types indentation; with a selection it indents every
      // touched line (and never eats a cross-block selection).
      Tab: () => {
        const { state } = this.editor
        if (state.selection.empty) {
          if (state.selection.$from.parent.type.name !== 'codeBlock') return false
          return this.editor.commands.insertContent(indentUnit())
        }
        const lines = selectedLineStarts(state)
        if (!lines) return false
        const tr = state.tr
        for (const off of [...lines.offsets].reverse()) {
          tr.insertText(indentUnit(), lines.base + off)
        }
        this.editor.view.dispatch(tr)
        return true
      },
      'Shift-Tab': () => {
        const { state } = this.editor
        const lines = selectedLineStarts(state)
        if (!lines) return false
        const text = state.selection.$from.parent.textContent
        const tr = state.tr
        for (const off of [...lines.offsets].reverse()) {
          const eat = outdentWidth(text, off)
          if (eat > 0) tr.delete(lines.base + off, lines.base + off + eat)
        }
        if (tr.docChanged) this.editor.view.dispatch(tr)
        return true
      },
      // Auto-indent: Enter carries the current line's leading whitespace.
      // Whitespace-free lines fall through to the stock handler so the
      // triple-Enter exit keeps working.
      Enter: () => {
        const { state } = this.editor
        const line = currentLine(state)
        if (!line) return false
        // Whole-line whitespace: Enter resets it (kills runaway indent)
        // — judged on the FULL line, not just the text before the caret,
        // so Enter inside the indentation of "  foo" still splits.
        if (/^[\t ]+$/.test(line.fullLine) && state.selection.empty) {
          const tr = state.tr.delete(line.lineStart, line.lineStart + line.fullLine.length)
          tr.insertText('\n')
          this.editor.view.dispatch(tr)
          return true
        }
        // Carry only the whitespace BEFORE the caret (capped by the
        // line's indent) — carrying the full indent would duplicate the
        // part the caret hasn't passed yet.
        const carry = /^[\t ]*/.exec(line.atLineText)?.[0] ?? ''
        if (carry === '') return false
        this.editor.view.dispatch(state.tr.insertText('\n' + carry))
        return true
      },
    }
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('pre')
      dom.className = 'code-block'

      const gutter = document.createElement('span')
      gutter.className = 'cb-gutter'
      gutter.contentEditable = 'false'
      gutter.setAttribute('aria-hidden', 'true')

      const code = document.createElement('code')

      // ---- top-right chrome: [copy] [language chip / picker] ----
      // Copy sits LEFT of the chip: the chrome is right-anchored, so the
      // hover-only button grows leftward and the chip never moves.
      const chrome = document.createElement('span')
      chrome.className = 'cb-chrome'
      chrome.contentEditable = 'false'

      const copy = document.createElement('button')
      copy.className = 'cb-copy'
      copy.type = 'button'
      copy.title = i18n.t('editor.copyCode')
      // Icon.tsx's `copy` glyph (18-viewBox) — the NodeView is vanilla DOM.
      copy.innerHTML =
        '<svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="5" width="9" height="10" rx="1"/><path d="M5.5 5V3.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H12"/></svg>'
      copy.addEventListener('mousedown', (e) => e.preventDefault())
      copy.addEventListener('click', () => {
        const pos = getPos()
        const current = pos != null ? editor.state.doc.nodeAt(pos) : null
        navigator.clipboard
          .writeText(current?.textContent ?? '')
          .then(() => toast(i18n.t('editor.codeCopied')))
          .catch(() => toast(i18n.t('editor.copyFailed')))
      })

      // Language chip — display only; clicking hands off to the React
      // CodeLangPicker (Radix Popover) via the app's overlay event
      // pattern, same as the lightbox and the equation editor.
      const chip = document.createElement('button')
      chip.className = 'cb-lang-btn'
      chip.type = 'button'
      chip.title = i18n.t('editor.changeLanguage')
      chip.addEventListener('mousedown', (e) => e.preventDefault())
      chip.addEventListener('click', () => {
        const pos = getPos()
        if (pos == null) return
        const current = editor.state.doc.nodeAt(pos)
        window.dispatchEvent(
          new CustomEvent('melo:code-lang', {
            detail: {
              pos,
              rect: chip.getBoundingClientRect(),
              language: (current?.attrs.language as string | null) ?? '',
            },
          }),
        )
      })

      chrome.append(copy, chip)

      const sync = (n: typeof node) => {
        const lines = n.textContent.split('\n').length
        gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n')
        const language = (n.attrs.language as string | null) ?? ''
        chip.textContent = language || i18n.t('editor.plainLanguage')
        chip.classList.toggle('is-plain', !language)
      }
      sync(node)

      // Vanilla DOM gets no React i18n re-render — refresh the translated
      // bits ourselves when the language switches.
      const onLanguageChanged = () => {
        copy.title = i18n.t('editor.copyCode')
        chip.title = i18n.t('editor.changeLanguage')
        const pos = getPos()
        const current = pos != null ? editor.state.doc.nodeAt(pos) : null
        if (current) sync(current)
      }
      i18n.on('languageChanged', onLanguageChanged)

      dom.append(gutter, code, chrome)
      return {
        dom,
        contentDOM: code,
        update: (n) => {
          if (n.type !== node.type) return false
          sync(n)
          return true
        },
        ignoreMutation: (m) =>
          m.type !== 'selection' && !code.contains(m.target as globalThis.Node),
        destroy: () => {
          i18n.off('languageChanged', onLanguageChanged)
        },
      }
    }
  },
})
