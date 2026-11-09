import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveDocumentLink } from './documentLinks'

describe('workspace document links', () => {
  let temp: string
  let root: string
  let source: string
  const resolve = (href: string, fromPath: string | null = source) =>
    resolveDocumentLink({ href, fromPath, workspaceRoot: root }, root)

  beforeEach(async () => {
    temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'melo-document-links-')))
    root = path.join(temp, 'workspace')
    source = path.join(root, 'notes', 'source.md')
    await fs.mkdir(path.dirname(source), { recursive: true })
    await fs.writeFile(source, '')
    await fs.writeFile(path.join(root, 'root.md'), '')
    await fs.writeFile(path.join(root, 'notes', 'next.md'), '')
    await fs.writeFile(path.join(root, 'notes', '你好 #100%.md'), '')
    await fs.writeFile(path.join(temp, 'outside.md'), '')
  })
  afterEach(async () => fs.rm(temp, { recursive: true, force: true }))

  it.each(['next.md', './next.md', 'next', 'next.md?view=read'])(
    'resolves relative %s',
    async (href) => {
      expect(await resolve(href)).toEqual({
        kind: 'file',
        path: path.join(root, 'notes', 'next.md'),
        fragment: '',
      })
    },
  )
  it('resolves parents inside the root and untitled links from the root', async () => {
    expect(await resolve('../root.md')).toMatchObject({
      kind: 'file',
      path: path.join(root, 'root.md'),
    })
    expect(await resolve('root.md', null)).toMatchObject({
      kind: 'file',
      path: path.join(root, 'root.md'),
    })
    expect(await resolve('../../outside.md')).toEqual({ kind: 'error', reason: 'outside' })
  })
  it('splits fragments and queries before decoding filenames', async () => {
    expect(await resolve(encodeURIComponent('你好 #100%.md') + '?x=1#%E6%A0%87%E9%A2%98')).toEqual({
      kind: 'file',
      path: path.join(root, 'notes', '你好 #100%.md'),
      fragment: '标题',
    })
    expect(await resolve('bad%xx.md')).toEqual({ kind: 'error', reason: 'invalid' })
  })
  it('opens absolute paths and file URLs within the workspace', async () => {
    const target = path.join(root, 'root.md')
    expect(await resolve(target)).toMatchObject({ kind: 'file', path: target })
    expect(await resolve(pathToFileURL(target).href + '#heading')).toMatchObject({
      kind: 'file',
      path: target,
      fragment: 'heading',
    })
    expect(await resolve(pathToFileURL(path.join(temp, 'outside.md')).href)).toEqual({
      kind: 'error',
      reason: 'outside',
    })
  })
  it('treats slash paths as workspace-relative without existence fallback', async () => {
    expect(await resolve('/root.md')).toMatchObject({
      kind: 'file',
      path: path.join(root, 'root.md'),
    })
    expect(await resolve('/does-not-exist')).toEqual({ kind: 'error', reason: 'missing' })
    expect(await resolve(path.join(temp, 'outside.md'))).toEqual({
      kind: 'error',
      reason: 'missing',
    })
  })
  it('tries an exact extensionless file before .md', async () => {
    await fs.writeFile(path.join(root, 'notes', 'next'), 'exact')
    expect(await resolve('next')).toMatchObject({ path: path.join(root, 'notes', 'next') })
  })
  it('returns directories and media without opening system applications', async () => {
    expect(await resolve('/notes')).toMatchObject({
      kind: 'directory',
      path: path.join(root, 'notes'),
    })
    for (const name of ['image.png', 'document.pdf']) {
      await fs.writeFile(path.join(root, name), '')
      expect(await resolve('/' + name)).toMatchObject({ kind: 'file', path: path.join(root, name) })
    }
  })
  it('rejects symlinks that escape the workspace', async () => {
    await fs.symlink(path.join(temp, 'outside.md'), path.join(root, 'escape.md'))
    await fs.symlink(temp, path.join(root, 'escape-dir'))
    expect(await resolve('/escape.md')).toEqual({ kind: 'error', reason: 'outside' })
    expect(await resolve('/escape-dir/outside.md')).toEqual({ kind: 'error', reason: 'outside' })
  })
  it('canonicalizes internal symlinks and preserves a workspace alias for tab identity', async () => {
    await fs.symlink(path.join(root, 'root.md'), path.join(root, 'alias.md'))
    expect(await resolve('/alias.md')).toMatchObject({ path: path.join(root, 'root.md') })
    const alias = path.join(temp, 'workspace-alias')
    await fs.symlink(root, alias)
    expect(
      await resolveDocumentLink({ href: '/root.md', fromPath: null, workspaceRoot: alias }, alias),
    ).toMatchObject({
      kind: 'file',
      path: path.join(alias, 'root.md'),
    })
  })
  it('resolves relative hrefs against the opened note path after validating its symlink', async () => {
    await fs.symlink(path.join(root, 'root.md'), path.join(root, 'notes', 'linked-source.md'))
    expect(await resolve('next.md', path.join(root, 'notes', 'linked-source.md'))).toMatchObject({
      path: path.join(root, 'notes', 'next.md'),
    })
  })
  it.each(['obsidian://note', 'javascript:alert(1)', '#heading', 'https://example.com'])(
    'does not resolve non-file href %s',
    async (href) => {
      expect(await resolve(href)).toEqual({ kind: 'error', reason: 'invalid' })
    },
  )
  it('rejects stale workspace and outside source paths', async () => {
    expect(
      await resolveDocumentLink({ href: 'root.md', fromPath: null, workspaceRoot: temp }, root),
    ).toEqual({ kind: 'error', reason: 'workspaceChanged' })
    expect(await resolve('root.md', path.join(temp, 'outside.md'))).toEqual({
      kind: 'error',
      reason: 'outside',
    })
  })
})
