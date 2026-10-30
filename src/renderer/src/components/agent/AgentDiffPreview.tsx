import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { diffWordsWithSpace, parsePatch } from 'diff'
import type { ChangeObject } from 'diff'
import { Icon } from '../Icon'

interface EditBlock {
  before: string[]
  after: string[]
  context: string
  beforeNoNewline: boolean
  afterNoNewline: boolean
  words: ChangeObject<string>[] | undefined
}

function readChanges(source: string): EditBlock[] | null {
  let patches: ReturnType<typeof parsePatch>
  try {
    patches = parsePatch(source)
  } catch {
    // A stored preview must remain reviewable even if its patch cannot be parsed.
    return null
  }
  if (
    !patches.some(
      (patch) =>
        patch.hunks.length || patch.oldFileName !== undefined || patch.newFileName !== undefined,
    )
  )
    return null
  const blocks: EditBlock[] = []
  // Highlighting is optional; keep large edits from blocking the approval UI.
  const highlightDeadline = performance.now() + 80
  for (const patch of patches) {
    for (const hunk of patch.hunks) {
      const lines = hunk.lines
      for (let i = 0; i < lines.length; ) {
        if (lines[i][0] !== '-' && lines[i][0] !== '+') {
          i++
          continue
        }
        const start = i
        const before: string[] = [],
          after: string[] = []
        let beforeNoNewline = false,
          afterNoNewline = false
        while (i < lines.length && ['-', '+', '\\'].includes(lines[i][0])) {
          const kind = lines[i][0]
          if (kind === '-') before.push(lines[i].slice(1))
          if (kind === '+') after.push(lines[i].slice(1))
          if (kind === '\\') {
            beforeNoNewline ||= lines[i - 1]?.[0] === '-'
            afterNoNewline ||= lines[i - 1]?.[0] === '+'
          }
          i++
        }
        const end = i
        let contextEnd = end
        while (contextEnd < lines.length && lines[contextEnd][0] === ' ' && contextEnd < end + 3)
          contextEnd++
        blocks.push({
          before,
          after,
          beforeNoNewline,
          afterNoNewline,
          context: lines.slice(Math.max(0, start - 3), contextEnd).join('\n'),
          words:
            before.length && after.length && performance.now() < highlightDeadline
              ? diffWordsWithSpace(before.join('\n'), after.join('\n'), {
                  timeout: Math.max(1, highlightDeadline - performance.now()),
                })
              : undefined,
        })
      }
    }
  }
  if (
    !blocks.length &&
    source
      .split('\n')
      .some(
        (line) =>
          (line.startsWith('+') && !line.startsWith('+++ ')) ||
          (line.startsWith('-') && !line.startsWith('--- ')),
      )
  )
    return null
  return blocks
}

function visibleWhitespace(lines: string[], noNewline: boolean): string {
  return (
    lines
      .map((line) =>
        [...line]
          .map((character) =>
            character === ' '
              ? '·'
              : character === '\t'
                ? '⇥'
                : `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`,
          )
          .join(''),
      )
      .join('↵\n') + (noNewline ? '' : '↵')
  )
}

function ChangeText({ block, side }: { block: EditBlock; side: 'before' | 'after' }) {
  if (!block.words) return <>{block[side].join('\n') || '\u00a0'}</>
  return (
    <>
      {block.words.map((word, index) => {
        if (side === 'before' ? word.added : word.removed) return null
        return word.added || word.removed ? <mark key={index}>{word.value}</mark> : word.value
      })}
    </>
  )
}

export function AgentDiffPreview({ source }: { source: string }) {
  const { t } = useTranslation()
  const blocks = useMemo(() => readChanges(source), [source])
  const scroll = useRef<HTMLDivElement>(null)
  const [moreBelow, setMoreBelow] = useState(false)
  useEffect(() => {
    const element = scroll.current
    if (!element) return
    const update = () =>
      setMoreBelow(element.scrollHeight - element.scrollTop > element.clientHeight + 1)
    const observer = new ResizeObserver(update)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    element.addEventListener('scroll', update, { passive: true })
    update()
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', update)
    }
  }, [blocks])
  if (!blocks)
    return (
      <div className="agent-edit-diff agent-diff-fallback">
        <p>{t('agent.diffRaw')}</p>
        <pre>{source}</pre>
      </div>
    )
  return (
    <div className="agent-edit-diff" aria-label={t('agent.editDiff')}>
      <div className="agent-diff-caption">
        <span>{t('agent.diffCount', { count: blocks.length })}</span>
        {moreBelow && (
          <span className="agent-diff-scroll-hint">
            <Icon name="arrowDown" size={12} />
            {t('agent.diffMoreBelow')}
          </span>
        )}
      </div>
      <div className="agent-diff-scroll" ref={scroll}>
        {!blocks.length && <p>{t('agent.diffUnchanged')}</p>}
        {blocks.map((block, index) => (
          <section className="agent-diff-block" key={index}>
            {blocks.length > 1 && (
              <div className="agent-diff-number">
                {t('agent.diffChange', { number: index + 1 })}
              </div>
            )}
            {(['before', 'after'] as const).map(
              (side) =>
                block[side].length > 0 && (
                  <div
                    className="agent-diff-side"
                    data-kind={side === 'before' ? 'removed' : 'added'}
                    key={side}
                  >
                    <span className="agent-diff-label">
                      {t(`agent.diff${side === 'before' ? 'Before' : 'After'}`)}
                    </span>
                    <div className="agent-diff-copy">
                      {block[side].every((line) => !line.trim()) ? (
                        <>
                          <span className="agent-diff-whitespace">
                            {visibleWhitespace(
                              block[side],
                              side === 'before' ? block.beforeNoNewline : block.afterNoNewline,
                            )}
                          </span>
                          <span className="agent-diff-note">{t('agent.diffWhitespaceLegend')}</span>
                        </>
                      ) : (
                        <ChangeText block={block} side={side} />
                      )}
                    </div>
                    {block.beforeNoNewline !== block.afterNoNewline && (
                      <span className="agent-diff-note">
                        {t(
                          (side === 'before' ? block.beforeNoNewline : block.afterNoNewline)
                            ? 'agent.diffNoNewline'
                            : 'agent.diffNewline',
                        )}
                      </span>
                    )}
                  </div>
                ),
            )}
            {block.before.length > 0 &&
              block.after.length > 0 &&
              block.before.join('').replace(/\s/g, '') ===
                block.after.join('').replace(/\s/g, '') && (
                <p className="agent-diff-note">{t('agent.diffWhitespace')}</p>
              )}
            <details className="agent-diff-context">
              <summary>
                <Icon name="chev" size={12} />
                {t('agent.diffContext')}
              </summary>
              <pre>{block.context}</pre>
            </details>
          </section>
        ))}
      </div>
    </div>
  )
}
