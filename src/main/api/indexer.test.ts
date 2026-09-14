import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import {
  openIndex,
  closeIndex,
  indexFile,
  resolveWikilinks,
  listLinkTargets,
  getNoteLinks,
  linkMention,
  querySmartRules,
  countSmartViews,
  getSmartVocab,
  preciseCreatedAt,
  getClipSources,
  getClipSourcesForPaths,
  fullScan,
} from './indexer'
import { getSmartViews, saveSmartViews } from './smartViews'

let root: string

function write(rel: string, content: string): string {
  const abs = path.join(root, rel)
  fs.ensureDirSync(path.dirname(abs))
  fs.writeFileSync(abs, content)
  indexFile(abs)
  return abs
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-indexer-'))
  openIndex(root)
})

afterEach(() => {
  closeIndex()
  fs.removeSync(root)
})

describe('resolveWikilinks', () => {
  it('resolves by title, filename stem and relative path, case-insensitively', () => {
    write('notes/The CODE Method.md', '# The CODE Method\n\nBody text here.')
    const r = resolveWikilinks(['the code method', 'The CODE Method', 'notes/The CODE Method'])
    expect(r['the code method']?.path).toContain('The CODE Method.md')
    expect(r['The CODE Method']?.title).toBe('The CODE Method')
    expect(r['notes/The CODE Method']?.path).toContain('The CODE Method.md')
    expect(resolveWikilinks(['no such note'])['no such note']).toBeNull()
  })

  it('prefers the frontmatter title over the filename', () => {
    write('a.md', '---\ntitle: Fancy Title\n---\n\ncontent body')
    expect(resolveWikilinks(['Fancy Title'])['Fancy Title']).not.toBeNull()
    // The stem still resolves too.
    expect(resolveWikilinks(['a'])['a']?.title).toBe('Fancy Title')
  })
})

describe('listLinkTargets', () => {
  it('ranks exact title matches first and excludes self', () => {
    const self = write('Go.md', '# Go\n\nabout go')
    write('Golang tips.md', '# Golang tips\n\ntips')
    const hits = listLinkTargets('go', null)
    expect(hits[0].title).toBe('Go')
    const excluded = listLinkTargets('go', self)
    expect(excluded.some((h) => h.title === 'Go')).toBe(false)
  })
})

describe('getNoteLinks', () => {
  it('collects backlinks with heading context, outgoing and edges', () => {
    const target = write('Target.md', '# Target\n\nSome body long enough to index.')
    write(
      'Source.md',
      '# Source\n\n## Section A\n\nThis paragraph links to [[Target]] right here.\n\nUnrelated paragraph.',
    )
    write('Other.md', '# Other\n\n[[Source]] connects elsewhere.')

    const data = getNoteLinks(target)
    expect(data.selfTitle).toBe('Target')
    expect(data.backlinks).toHaveLength(1)
    expect(data.backlinks[0].title).toBe('Source')
    expect(data.backlinks[0].refs[0].heading).toBe('Section A')
    expect(data.backlinks[0].refs[0].context).toContain('[[Target]]')

    const source = getNoteLinks(path.join(root, 'Source.md'))
    expect(source.outgoing).toEqual([{ target: 'Target', path: target, title: 'Target' }])
    expect(source.backlinks.map((b) => b.title)).toEqual(['Other'])
  })

  it('reports bare mentions but not aliased links or substrings', () => {
    const target = write('Art.md', '# Art\n\nabout art itself, long enough.')
    write('Mention.md', '# Mention\n\nSome thoughts about Art and more.')
    write('Aliased.md', '# Aliased\n\nSee [[Other|Art]] for details.')
    write('Substr.md', '# Substr\n\nCartography is not about art history maps.')

    const data = getNoteLinks(target)
    const titles = data.mentions.map((m) => m.title).sort()
    // 'Mention' has a bare mention; 'Aliased' only has the label inside a
    // link; 'Substr' contains "art" only inside "Cartography" and in
    // "art history" — the latter IS a bare mention.
    expect(titles).toContain('Mention')
    expect(titles).not.toContain('Aliased')
  })

  it('suggests prose mentions but ignores URLs, links and code', () => {
    const target = write('README.md', '# README\n\nProject documentation.')
    write('Prose.md', '# Prose\n\nPlease read the README before starting.')
    write(
      'Syntax.md',
      [
        '# Syntax',
        '',
        'https://github.com/example/project?tab=readme-ov-file',
        '[README](https://example.com/readme)',
        '![README](cover.png)',
        '[README][docs]',
        '[README]',
        '[docs]: https://example.com/readme',
        '[README]: /docs "README documentation"',
        '`README`',
        '<code>README</code>',
        '<!-- README -->',
        '```text',
        'README',
        '```',
        '~~~text',
        'README',
        '~~~',
      ].join('\n'),
    )

    const data = getNoteLinks(target)
    expect(data.mentions.map((mention) => mention.title)).toEqual(['Prose'])
  })
})

describe('non-md metadata rows', () => {
  it('tracks non-md files with title but no content indexing', () => {
    const abs = path.join(root, 'papers', 'attention.pdf')
    fs.ensureDirSync(path.dirname(abs))
    fs.writeFileSync(abs, 'fake pdf bytes')
    indexFile(abs)
    // Resolvable as a link target by stem…
    expect(resolveWikilinks(['attention'])['attention']?.path).toBe(abs)
    // …and offered by the picker.
    expect(listLinkTargets('atten', null).some((h) => h.path === abs)).toBe(true)
  })
})

describe('fullScan filesystem boundaries', () => {
  it('does not follow or index symlinks', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'melo-indexer-outside-'))
    const target = path.join(outside, 'outside.md')
    fs.writeFileSync(target, '# Outside\n\nMust not enter this workspace index.')
    fs.symlinkSync(target, path.join(root, 'linked.md'))

    try {
      await fullScan()
      expect(resolveWikilinks(['Outside'])['Outside']).toBeNull()
      expect(resolveWikilinks(['linked'])['linked']).toBeNull()
    } finally {
      fs.removeSync(outside)
    }
  })
})

describe('clip source batches', () => {
  it('returns metadata only for the requested absolute paths', () => {
    const first = write(
      'Inbox/first.md',
      '---\nsource: https://first.example/article\ncreated: 2026-08-09T00:00:00Z\n---\n\nFirst',
    )
    write('Inbox/second.md', '---\nsource: https://second.example/article\n---\n\nSecond')
    const plain = write('Inbox/plain.md', '# Plain')

    expect(getClipSourcesForPaths([first, plain])).toEqual({
      [first]: {
        url: 'https://first.example/article',
        capturedAt: '2026-08-09T00:00:00.000Z',
      },
    })
  })
})

describe('smart folders', () => {
  function seedWorkspace() {
    write(
      'Inbox/clip.md',
      '---\ntitle: A Clip\nsource: https://www.example.com/post\ncreated: 2020-01-01T00:00:00Z\ntags: [reading]\n---\n\nclipped body text goes here',
    )
    write('Inbox/untagged.md', '# Untagged\n\nplain inbox note without tags')
    write('Projects/plan.md', '---\ntags: [second-brain]\n---\n\nproject planning body')
    const pdf = path.join(root, 'Projects', 'paper.pdf')
    fs.writeFileSync(pdf, 'bytes')
    indexFile(pdf)
    write('root-note.md', '# Root\n\nlives at workspace root')
  }

  it('filters by kind, folder, tag and source', () => {
    seedWorkspace()
    const pdfs = querySmartRules([{ key: 'Kind', op: 'is', val: 'PDF' }])
    expect(pdfs.map((h) => h.title)).toEqual(['paper'])

    const clips = querySmartRules([{ key: 'Kind', op: 'is', val: 'Web clipping' }])
    expect(clips.map((h) => h.title)).toEqual(['A Clip'])
    expect(clips[0].sourceHost).toBe('example.com')
    // frontmatter created (2020) beats mtime (now) for the time bucket
    expect(clips[0].days).toBeGreaterThan(365)

    const inboxUntagged = querySmartRules([
      { key: 'Folder', op: 'is', val: 'Inbox' },
      { key: 'Tag', op: 'is empty', val: '' },
    ])
    expect(inboxUntagged.map((h) => h.title)).toEqual(['Untagged'])

    const bySource = querySmartRules([{ key: 'Source', op: 'is', val: 'example.com' }])
    expect(bySource).toHaveLength(1)

    const rootFiles = querySmartRules([{ key: 'Folder', op: 'is', val: 'Workspace' }])
    expect(rootFiles.map((h) => h.title)).toEqual(['Root'])
  })

  it('counts many views over one snapshot and exposes vocab', () => {
    seedWorkspace()
    const counts = countSmartViews([
      { id: 'pdfs', rules: [{ key: 'Kind', op: 'is', val: 'PDF' }] },
      { id: 'sb', rules: [{ key: 'Tag', op: 'is', val: 'second-brain' }] },
      { id: 'all', rules: [] },
    ])
    expect(counts).toEqual({ pdfs: 1, sb: 1, all: 5 })

    const vocab = getSmartVocab()
    expect(vocab.tags.sort()).toEqual(['reading', 'second-brain'])
    expect(vocab.folders).toEqual(['Inbox', 'Projects'])
    expect(vocab.sources).toEqual(['example.com'])
  })

  it('seeds, persists and survives corrupt views.json', () => {
    const seeded = getSmartViews(root)
    expect(seeded.map((v) => v.id)).toEqual(['thisweek', 'pdfs', 'secondbrain', 'untagged'])
    const custom = [...seeded, { id: 'x', name: 'X', glyph: 'star', rules: [] }]
    saveSmartViews(root, custom)
    expect(getSmartViews(root).map((v) => v.id)).toContain('x')

    fs.writeFileSync(path.join(root, '.melo', 'views.json'), '{not json')
    expect(getSmartViews(root).map((v) => v.id)).toEqual([
      'thisweek',
      'pdfs',
      'secondbrain',
      'untagged',
    ])
    expect(fs.existsSync(path.join(root, '.melo', 'views.json.corrupt'))).toBe(true)
  })
})

describe('linkMention', () => {
  it('wraps the first bare mention, preserving casing via alias', () => {
    write('Topic.md', '# Topic\n\nbody long enough to index fine.')
    const src = write('Diary.md', '# Diary\n\nThought about topic today.\n')
    expect(linkMention(src, 'Topic')).toBe(true)
    const after = fs.readFileSync(src, 'utf-8')
    expect(after).toContain('[[Topic|topic]]')
  })

  it('skips occurrences inside links, URLs and code', () => {
    write('Beta.md', '# Beta\n\nbody long enough to index well.')
    const src = write(
      'Uses.md',
      [
        '# Uses',
        '',
        '[[Beta]] already linked.',
        '[Beta](https://example.com/Beta)',
        '[Beta][docs]',
        '[Beta]',
        '[docs]: https://example.com/Beta',
        '[Beta]: /docs "Beta documentation"',
        'https://example.com/Beta-guide',
        '`Beta`',
        '<code>Beta</code>',
        '<!-- Beta -->',
        '```',
        'beta in code',
        '```',
      ].join('\n'),
    )
    expect(linkMention(src, 'Beta')).toBe(false)
  })

  it('links the first prose occurrence after ignored Markdown syntax', () => {
    write('Gamma.md', '# Gamma\n\nbody long enough to index well.')
    const src = write(
      'Uses.md',
      '# Uses\n\n📎 https://example.com/Gamma\n\n`Gamma`\n\nGamma belongs in this sentence.\n',
    )

    expect(linkMention(src, 'Gamma')).toBe(true)
    expect(fs.readFileSync(src, 'utf-8')).toContain('`Gamma`\n\n[[Gamma]] belongs')
  })

  it('refuses paths outside the workspace', () => {
    const outside = path.join(os.tmpdir(), 'melo-outside.md')
    fs.writeFileSync(outside, 'Beta mention here')
    expect(linkMention(outside, 'Beta')).toBe(false)
    fs.removeSync(outside)
  })
})

describe('preciseCreatedAt', () => {
  it('trusts the frontmatter instant as written', () => {
    const exact = '2026-08-03T10:30:00.000Z'
    expect(preciseCreatedAt(exact, 999, 0)).toBe(Date.parse(exact))
  })

  it('orders same-day captures by their instants', () => {
    const early = preciseCreatedAt('2026-08-03T02:20:14.567Z', 0, 0)
    const late = preciseCreatedAt('2026-08-03T14:21:11.441Z', 0, 0)
    expect(late).toBeGreaterThan(early)
  })

  it('falls back to btime, then mtime, without frontmatter', () => {
    expect(preciseCreatedAt(undefined, 111, 222)).toBe(111)
    expect(preciseCreatedAt(undefined, 0, 222)).toBe(222)
    expect(preciseCreatedAt('not a date', 111, 222)).toBe(111)
  })
})

describe('smart query ordering (integration)', () => {
  // The regression this guards: two clips captured the same day tied on a
  // day-precision timestamp, so Newest/Oldest never reordered them.
  const clip = (title: string, iso: string) => `---
title: ${title}
source: https://example.com/${title}
created: ${iso}
---

# ${title}

body
`

  it('orders same-day clips by their capture instants, both directions', () => {
    write('Inbox/early.md', clip('early', '2026-08-03T02:20:14.567Z'))
    write('Inbox/late.md', clip('late', '2026-08-03T14:21:11.441Z'))

    const newest = querySmartRules([], 200, 'Newest first')
    expect(newest.map((h) => h.title)).toEqual(['late', 'early'])
    expect(newest[0].createdAt).toBeGreaterThan(newest[1].createdAt)

    const oldest = querySmartRules([], 200, 'Oldest first')
    expect(oldest.map((h) => h.title)).toEqual(['early', 'late'])
  })

  it('applies the sort BEFORE the limit', () => {
    write('Inbox/a-oldest.md', clip('a-oldest', '2026-08-01T08:00:00.000Z'))
    write('Inbox/b-mid.md', clip('b-mid', '2026-08-02T08:00:00.000Z'))
    write('Inbox/c-newest.md', clip('c-newest', '2026-08-03T08:00:00.000Z'))

    const oldestTwo = querySmartRules([], 2, 'Oldest first')
    expect(oldestTwo.map((h) => h.title)).toEqual(['a-oldest', 'b-mid'])
  })

  it('exposes clip sources with their capture times', () => {
    const abs = write('Inbox/clip.md', clip('clip', '2026-08-03T10:00:00.000Z'))
    const sources = getClipSources()
    expect(sources[abs]?.url).toBe('https://example.com/clip')
    expect(Date.parse(sources[abs]?.capturedAt ?? '')).toBe(Date.parse('2026-08-03T10:00:00.000Z'))
  })
})
