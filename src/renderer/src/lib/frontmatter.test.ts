import { describe, expect, it } from 'vitest'
import { splitFrontmatter } from './frontmatter'

describe('splitFrontmatter', () => {
  it('splits a normal frontmatter block and keeps it verbatim', () => {
    const raw = '---\ntitle: hi\n---\n\nbody text\n'
    const { frontmatter, body } = splitFrontmatter(raw)
    expect(frontmatter).toBe('---\ntitle: hi\n---\n\n')
    expect(body).toBe('body text\n')
    expect(frontmatter + body).toBe(raw)
  })

  it('returns everything as body when there is no frontmatter', () => {
    const raw = '# heading\n\ntext'
    expect(splitFrontmatter(raw)).toEqual({ frontmatter: '', body: raw })
  })

  it('handles CRLF line endings', () => {
    const raw = '---\r\ntitle: hi\r\n---\r\nbody'
    const { frontmatter, body } = splitFrontmatter(raw)
    expect(body).toBe('body')
    expect(frontmatter.startsWith('---\r\n')).toBe(true)
  })

  it('accepts a closing delimiter at end of file', () => {
    const raw = '---\ntitle: hi\n---'
    const { frontmatter, body } = splitFrontmatter(raw)
    expect(frontmatter).toBe('---\ntitle: hi\n---')
    expect(body).toBe('')
  })

  it('only a full-line --- closes the block (values containing --- do not)', () => {
    const raw = '---\nnotes: ---draft\ntitle: hi\n---\nbody'
    const { frontmatter, body } = splitFrontmatter(raw)
    expect(frontmatter).toContain('notes: ---draft')
    expect(body).toBe('body')
  })

  it('leaves body --- lines (horizontal rules) alone', () => {
    const raw = '---\ntitle: hi\n---\n\npara\n\n---\n\nmore'
    const { body } = splitFrontmatter(raw)
    expect(body).toBe('para\n\n---\n\nmore')
  })

  it('treats an unclosed opening delimiter as body', () => {
    const raw = '---\ntitle: never closed\ntext'
    expect(splitFrontmatter(raw)).toEqual({ frontmatter: '', body: raw })
  })

  it('handles the minimal empty block', () => {
    const raw = '---\n---\nbody'
    const { frontmatter, body } = splitFrontmatter(raw)
    expect(frontmatter).toBe('---\n---\nbody'.slice(0, 8))
    expect(body).toBe('body')
  })
})
