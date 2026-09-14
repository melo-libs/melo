/* ============================================================
   Friendly LaTeX error explanations for the equation editor.

   KaTeX's raw ParseError messages ("Expected 'EOF', got '&' at
   position 3: a &̲ b") are developer-facing. explainMathError turns
   the common cases into a calm, actionable sentence — and, for a
   misspelled command, a one-click "Did you mean \theta?" fix.
   ============================================================ */

import i18n from '../../i18n'

export interface MathHint {
  /** Human sentence describing what's wrong and how to fix it. */
  text: string
  /** Optional one-click correction: a button label plus the transform it
   *  applies to the current LaTeX. */
  fix?: { label: string; apply: (latex: string) => string }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Commands the palette can produce plus the everyday ones, used for the
// "did you mean" fuzzy match. Each includes its leading backslash.
const KNOWN_COMMANDS = [
  '\\alpha',
  '\\beta',
  '\\gamma',
  '\\delta',
  '\\epsilon',
  '\\varepsilon',
  '\\zeta',
  '\\eta',
  '\\theta',
  '\\vartheta',
  '\\iota',
  '\\kappa',
  '\\lambda',
  '\\mu',
  '\\nu',
  '\\xi',
  '\\pi',
  '\\varpi',
  '\\rho',
  '\\sigma',
  '\\tau',
  '\\upsilon',
  '\\phi',
  '\\varphi',
  '\\chi',
  '\\psi',
  '\\omega',
  '\\Gamma',
  '\\Delta',
  '\\Theta',
  '\\Lambda',
  '\\Xi',
  '\\Pi',
  '\\Sigma',
  '\\Upsilon',
  '\\Phi',
  '\\Psi',
  '\\Omega',
  '\\frac',
  '\\dfrac',
  '\\tfrac',
  '\\sqrt',
  '\\sum',
  '\\prod',
  '\\int',
  '\\oint',
  '\\lim',
  '\\log',
  '\\ln',
  '\\sin',
  '\\cos',
  '\\tan',
  '\\cot',
  '\\sec',
  '\\csc',
  '\\exp',
  '\\max',
  '\\min',
  '\\det',
  '\\gcd',
  '\\infty',
  '\\partial',
  '\\nabla',
  '\\times',
  '\\cdot',
  '\\div',
  '\\pm',
  '\\mp',
  '\\neq',
  '\\leq',
  '\\geq',
  '\\approx',
  '\\equiv',
  '\\sim',
  '\\simeq',
  '\\cong',
  '\\propto',
  '\\to',
  '\\rightarrow',
  '\\leftarrow',
  '\\Rightarrow',
  '\\Leftarrow',
  '\\leftrightarrow',
  '\\mapsto',
  '\\in',
  '\\notin',
  '\\subset',
  '\\subseteq',
  '\\supset',
  '\\cup',
  '\\cap',
  '\\emptyset',
  '\\forall',
  '\\exists',
  '\\neg',
  '\\land',
  '\\lor',
  '\\hat',
  '\\bar',
  '\\vec',
  '\\tilde',
  '\\dot',
  '\\ddot',
  '\\overline',
  '\\underline',
  '\\begin',
  '\\end',
  '\\left',
  '\\right',
  '\\text',
  '\\mathbb',
  '\\mathcal',
  '\\mathrm',
  '\\mathbf',
  '\\boldsymbol',
  '\\binom',
  '\\pmatrix',
  '\\bmatrix',
  '\\vmatrix',
  '\\matrix',
  '\\cases',
  '\\aligned',
]

const KNOWN_SET = new Set(KNOWN_COMMANDS)

// Matches exactly two standalone backslashes before a command name. The
// look-around rules out longer runs: `\\\frac` is a row break "\\" plus the
// command "\frac" (an odd backslash count is legitimate), so it must not match.
const DOUBLED_CMD = /(?<!\\)\\\\(?!\\)([A-Za-z]+)/g

// True when a known command carries a doubled backslash (\\int). Keyed on known
// command names — not any letter — so a real row break followed by row content
// (e.g. `a\\b` inside a matrix) is left alone.
function hasDoubledCommand(latex: string): boolean {
  const re = new RegExp(DOUBLED_CMD.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(latex))) {
    if (KNOWN_SET.has('\\' + m[1])) return true
  }
  return false
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return d[m][n]
}

// Nearest known command within a small edit distance. On ties, prefer one that
// keeps the first letter (people rarely mistype the leading character).
function suggestCommand(cmd: string): string | null {
  const max = cmd.length <= 4 ? 1 : 2
  let best: string | null = null
  let bestDist = Infinity
  let bestPenalty = 9
  for (const k of KNOWN_COMMANDS) {
    const dist = levenshtein(cmd, k)
    if (dist > max) continue
    const penalty = cmd[1] && k[1] && cmd[1] === k[1] ? 0 : 1
    if (dist < bestDist || (dist === bestDist && penalty < bestPenalty)) {
      bestDist = dist
      bestPenalty = penalty
      best = k
    }
  }
  return best
}

// Walk \begin / \end in source order with a stack, so nested environments are
// validated correctly (parallel begin/end arrays misjudge nesting). Returns a
// friendly message for the first structural problem, or null if balanced.
function envError(latex: string): string | null {
  const re = /\\(begin|end)\s*\{([^}]*)\}/g
  const stack: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(latex))) {
    const [, kind, name] = m
    if (kind === 'begin') {
      stack.push(name)
      continue
    }
    if (stack.length === 0) {
      return i18n.t('math.endNoBegin', { end: `\\end{${name}}`, begin: `\\begin{${name}}` })
    }
    const top = stack.pop()!
    if (top !== name) {
      return i18n.t('math.envMismatch', { begin: `\\begin{${top}}`, end: `\\end{${name}}` })
    }
  }
  if (stack.length > 0) {
    const env = stack[stack.length - 1]
    return i18n.t('math.beginNoEnd', { begin: `\\begin{${env}}`, end: `\\end{${env}}` })
  }
  return null
}

// Net unclosed braces, ignoring escaped \{ \} (and skipping the char after any
// backslash, so \\ and \{ don't miscount).
function braceDelta(s: string): number {
  let d = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '{') d++
    else if (c === '}') d--
  }
  return d
}

// Strip KaTeX's prefix and the noisy "at position N: …context…" suffix.
function rawMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  return msg
    .replace(/^KaTeX parse error:\s*/, '')
    .replace(/\s+at (position \d+|end of input):.*$/, '')
    .trim()
}

export function explainMathError(error: unknown, latex: string): MathHint {
  // Doubled backslashes on commands (\\int instead of \int) — almost always
  // pasted from an escaped source. Keyed on known command names so a legit row
  // break followed by row content (e.g. `a\\b`) is never touched. The fix also
  // un-escapes \_ and \^, which carry the same mistake.
  if (hasDoubledCommand(latex)) {
    return {
      text: i18n.t('math.doubledBackslash'),
      fix: {
        label: i18n.t('math.removeBackslashes'),
        apply: (s) =>
          s
            .replace(new RegExp(DOUBLED_CMD.source, 'g'), (full, word) =>
              KNOWN_SET.has('\\' + word) ? '\\' + word : full,
            )
            .replace(/(?<!\\)\\([_^])/g, '$1'),
      },
    }
  }

  const raw = rawMessage(error)

  // Misspelled command — the most actionable case, so try it first.
  const undef = raw.match(/Undefined control sequence:?\s*(\\[A-Za-z@]+)/)
  if (undef) {
    const cmd = undef[1]
    const guess = suggestCommand(cmd)
    if (!guess) return { text: i18n.t('math.unknownCommandCheck', { cmd }) }
    const re = new RegExp(escapeRegExp(cmd) + '(?![A-Za-z])', 'g')
    return {
      text: i18n.t('math.unknownCommand', { cmd }),
      fix: { label: i18n.t('math.didYouMean', { guess }), apply: (s) => s.replace(re, guess) },
    }
  }

  // Brace balance — precise and easy to act on.
  const bd = braceDelta(latex)
  if (bd > 0) return { text: i18n.t('math.unclosedBraces', { count: bd }) }
  if (bd < 0) return { text: i18n.t('math.extraBraces', { count: -bd }) }

  // \begin / \end environments (stack-matched, nesting-aware).
  const env = envError(latex)
  if (env) return { text: env }

  // A required argument never arrived (e.g. \frac{a} with no second group).
  if (/macro argument/.test(raw)) {
    return { text: i18n.t('math.missingArgument') }
  }

  let m: RegExpMatchArray | null
  if ((m = raw.match(/Expected group as argument to '(\\[A-Za-z]+)'/))) {
    return { text: i18n.t('math.needsGroupArg', { cmd: m[1], example: `${m[1]}{x}` }) }
  }
  if ((m = raw.match(/Expected group after '(.)'/))) {
    const ch = m[1]
    if (ch === '^') return { text: i18n.t('math.caretNeedsValue') }
    if (ch === '_') return { text: i18n.t('math.underscoreNeedsValue') }
    return { text: i18n.t('math.charNeedsValue', { ch }) }
  }
  if (/Double superscript/.test(raw)) {
    return { text: i18n.t('math.doubleSuperscript') }
  }
  if (/Double subscript/.test(raw)) {
    return { text: i18n.t('math.doubleSubscript') }
  }
  if (/got '&'/.test(raw) || /Misplaced &/.test(raw)) {
    return { text: i18n.t('math.misplacedAmp') }
  }
  if (/got '#'/.test(raw)) {
    return { text: i18n.t('math.reservedHash') }
  }
  if (/Unknown column alignment/.test(raw)) {
    return { text: i18n.t('math.unknownColumn') }
  }

  // Anything unrecognised: show the cleaned KaTeX cause rather than nothing.
  return { text: raw || i18n.t('math.invalidFormula') }
}
