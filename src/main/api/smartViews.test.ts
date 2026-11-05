import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { onSmartViewsChanged, readSmartViewsSnapshot, updateSmartViews } from './smartViews'
let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'melo-smart-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
it('normalizes known legacy rules while retaining the raw configuration revision', () => {
  readSmartViewsSnapshot(root)
  const file = path.join(root, '.melo/views.json')
  const raw =
    JSON.stringify([
      {
        id: 'legacy',
        name: 'Legacy',
        glyph: 'clock',
        rules: [
          { key: 'Captured', op: 'in', val: 'Today' },
          { key: 'Captured', op: 'in', val: 'Anytime' },
          { key: 'Created', op: 'in', val: 'Anytime' },
        ],
      },
    ]) + '\n'
  writeFileSync(file, raw)
  const loaded = readSmartViewsSnapshot(root)
  expect(loaded.views[0].rules).toEqual([{ key: 'Created', op: 'in', val: 'Today' }])
  expect(loaded.revision).toBe(createHash('sha256').update(raw).digest('hex'))
  expect(readFileSync(file, 'utf8')).toBe(raw)
  const saved = updateSmartViews(root, loaded.views, loaded.revision)
  expect(saved.views).toEqual(loaded.views)
  expect(() => updateSmartViews(root, loaded.views, loaded.revision)).toThrow(
    'SMART_VIEWS_CONFLICT',
  )
})

it('rejects unknown rule keys without dropping rules or overwriting configuration', () => {
  readSmartViewsSnapshot(root)
  const file = path.join(root, '.melo/views.json')
  const raw = JSON.stringify([
    {
      id: 'unknown',
      name: 'Unknown',
      glyph: 'clock',
      rules: [{ key: 'Unknown', op: 'in', val: 'Today' }],
    },
  ])
  writeFileSync(file, raw)
  expect(() => readSmartViewsSnapshot(root)).toThrow()
  expect(readFileSync(file, 'utf8')).toBe(raw)
})

it('saves with revisions, notifies, and rejects stale manual/Agent writes', () => {
  const original = readSmartViewsSnapshot(root)
  const notifications: string[] = []
  const off = onSmartViewsChanged((value) => notifications.push(value))
  try {
    const next = updateSmartViews(
      root,
      [
        ...original.views,
        {
          id: 'travel',
          name: 'Travel PDFs',
          glyph: 'pdf',
          rules: [
            { key: 'Kind', op: 'is', val: 'PDF' },
            { key: 'Folder', op: 'is', val: 'Travel' },
          ],
        },
      ],
      original.revision,
    )
    expect(next.views).toHaveLength(original.views.length + 1)
    expect(notifications).toEqual([root])
    expect(() => updateSmartViews(root, original.views, original.revision)).toThrow(
      'SMART_VIEWS_CONFLICT',
    )
    expect(readSmartViewsSnapshot(root)).toEqual(next)
    const file = path.join(root, '.melo/views.json')
    writeFileSync(file, readFileSync(file, 'utf8') + '\n')
    expect(() => updateSmartViews(root, original.views, next.revision)).toThrow(
      'SMART_VIEWS_CONFLICT',
    )
  } finally {
    off()
  }
})
it('does not reset malformed config or follow a configuration symlink', () => {
  readSmartViewsSnapshot(root)
  const file = path.join(root, '.melo/views.json')
  writeFileSync(file, '{broken')
  expect(() => readSmartViewsSnapshot(root)).toThrow()
  expect(readFileSync(file, 'utf8')).toBe('{broken')
  rmSync(file)
  symlinkSync(path.join(root, 'outside.json'), file)
  writeFileSync(path.join(root, 'outside.json'), '[]')
  expect(() => readSmartViewsSnapshot(root)).toThrow('symbolic link')
})
it.each([
  { key: 'Kind', op: 'is not', val: 'Anything' },
  { key: 'Created', op: 'after', val: '2026-02-30' },
  { key: 'Created', op: 'near', val: 'Today' },
  { key: 'Folder', op: 'is', val: 'Travel/Hangzhou' },
])('rejects unsupported rules instead of silently matching files: %j', (rule) => {
  const current = readSmartViewsSnapshot(root)
  expect(() =>
    updateSmartViews(
      root,
      [...current.views, { id: 'bad', name: 'Bad', glyph: 'folder', rules: [rule as never] }],
      current.revision,
    ),
  ).toThrow()
  expect(readSmartViewsSnapshot(root)).toEqual(current)
})
it('does not follow a pre-existing temporary-file symlink', () => {
  const current = readSmartViewsSnapshot(root)
  const outside = path.join(root, 'keep.txt')
  writeFileSync(outside, 'Keep me')
  symlinkSync(outside, path.join(root, '.melo/views.json.tmp'))
  updateSmartViews(root, current.views, current.revision)
  expect(readFileSync(outside, 'utf8')).toBe('Keep me')
})
it('keeps legacy incomplete rules and duplicate names editable without blocking other changes', () => {
  const current = readSmartViewsSnapshot(root)
  const file = path.join(root, '.melo/views.json')
  const legacy = [
    ...current.views,
    {
      id: 'legacy',
      name: 'Duplicate',
      glyph: 'bookmark',
      rules: [{ key: 'Title', op: 'contains', val: '' }],
    },
    { id: 'other', name: 'Duplicate', glyph: 'bookmark', rules: [] },
  ]
  writeFileSync(file, JSON.stringify(legacy))
  const loaded = readSmartViewsSnapshot(root)
  expect(loaded.views).toEqual(legacy)
  const next = updateSmartViews(
    root,
    [...loaded.views, { id: 'new', name: 'New', glyph: 'pdf', rules: [] }],
    loaded.revision,
  )
  expect(next.views.find((view) => view.id === 'legacy')).toEqual(legacy.at(-2))
  updateSmartViews(
    root,
    next.views.filter((view) => view.id !== 'legacy'),
    next.revision,
  )
})
