import { describe, expect, it } from 'vitest'
import { scoreTitle, BODY_SCORE_MAX, BODY_SCORE_MIN } from './searchEngine'

const score = (q: string, name: string) => scoreTitle(q, name)?.score ?? -1

describe('scoreTitle tiers', () => {
  it('exact > prefix > word-start substring > substring > fuzzy', () => {
    const exact = score('notes', 'notes')
    const prefix = score('notes', 'notes on testing.md')
    const wordStart = score('notes', 'meeting notes.md')
    const substring = score('note', 'footnotes.md')
    const fuzzy = score('nts', 'napkin thoughts.md')
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(wordStart)
    expect(wordStart).toBeGreaterThan(substring)
    expect(substring).toBeGreaterThan(fuzzy)
  })

  it('the "tes" case: contiguous substring beats scattered word starts', () => {
    const contiguous = score('tes', '40 Kubernetes的资源模型与资源管理.pdf')
    const scattered = score('tes', 'Services The New Software.md')
    expect(contiguous).toBeGreaterThan(scattered)
  })

  it('body-hit zone sits above fuzzy titles and below substring titles', () => {
    const scattered = score('tes', 'Services The New Software.md')
    const contiguous = score('tes', 'Kubernetes.pdf')
    expect(BODY_SCORE_MIN).toBeGreaterThan(scattered)
    expect(contiguous).toBeGreaterThan(BODY_SCORE_MAX)
  })

  it('matching is case-insensitive and works for CJK substrings', () => {
    expect(score('KUBER', 'kubernetes.pdf')).toBeGreaterThan(8900)
    expect(score('合同', '租房合同.pdf')).toBeGreaterThan(6900)
  })

  it('earlier and tighter matches win within a tier', () => {
    expect(score('plan', 'plan b.md')).toBeGreaterThan(score('plan', 'plan for the quarter.md'))
    expect(score('note', 'a note.md')).toBeGreaterThan(score('note', 'a keynote.md'))
  })

  it('multi-word queries match all terms in any order', () => {
    const both = scoreTitle('lite melo', 'melo-lite roadmap.md')
    expect(both).not.toBeNull()
    expect(both!.score).toBeGreaterThanOrEqual(4900)
    expect(scoreTitle('melo missing', 'melo-lite roadmap.md')?.score ?? -1).toBeLessThan(4000)
  })

  it('returns null when a query character never appears', () => {
    expect(scoreTitle('xyz', 'notes.md')).toBeNull()
  })

  it('reports highlight positions for the matched range', () => {
    const s = scoreTitle('note', 'meeting notes.md')!
    expect(s.positions).toEqual([8, 9, 10, 11])
  })
})
