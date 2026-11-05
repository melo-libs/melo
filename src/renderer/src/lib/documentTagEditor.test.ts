import { describe, expect, it, vi } from 'vitest'
import { createDocumentTagEditor } from './documentTagEditor'

const turn = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('inline tag editing', () => {
  it('serializes rapid edits, including undo/redo, with each saved revision', async () => {
    const releases: ((revision: string) => void)[] = []
    const save = vi.fn(() => new Promise<string>((resolve) => releases.push(resolve)))
    const editor = createDocumentTagEditor({ frontmatter: 'v0', tags: [] }, save)
    editor.setTags(['a'])
    editor.setTags(['a', 'b'])
    editor.undo()
    editor.redo()
    expect(editor.getSnapshot().tags).toEqual(['a', 'b'])
    expect(save).toHaveBeenCalledTimes(1)
    for (let index = 0; index < 4; index++) {
      releases[index](`v${index + 1}`)
      await turn()
    }
    expect(save.mock.calls).toEqual([
      ['v0', ['a']],
      ['v1', ['a', 'b']],
      ['v2', ['a']],
      ['v3', ['a', 'b']],
    ])
    expect(editor.getSnapshot()).toEqual({ tags: ['a', 'b'], saving: false, error: null })
  })

  it('reverts failed queued changes to the last saved tags and exposes the failure', async () => {
    const save = vi.fn().mockResolvedValueOnce('v1').mockRejectedValueOnce(new Error('disk full'))
    const editor = createDocumentTagEditor({ frontmatter: 'v0', tags: [] }, save)
    editor.setTags(['a'])
    editor.setTags(['a', 'b'])
    editor.setTags(['a', 'b', 'c'])
    expect(await editor.settled()).toBe(false)
    expect(save).toHaveBeenCalledTimes(2)
    expect(editor.getSnapshot()).toEqual({ tags: ['a'], saving: false, error: 'save' })
    expect(await editor.settled()).toBe(true)
    editor.undo()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('does not adopt premature session publications as a saved revision', async () => {
    let finish!: (value: string) => void
    const save = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
    )
    const editor = createDocumentTagEditor({ frontmatter: 'v0', tags: [] }, save)
    editor.setTags(['a'])
    editor.sync({ frontmatter: 'unconfirmed', tags: ['a'] })
    finish('v1')
    await turn()
    editor.setTags(['a', 'b'])
    expect(save.mock.calls[1]).toEqual(['v1', ['a', 'b']])
    finish('v2')
    await turn()
  })

  it('resets undo history on external changes and recovers from a conflict', async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce('v1')
      .mockRejectedValueOnce(new Error('DOCUMENT_TAGS_CONFLICT'))
      .mockResolvedValueOnce('v4')
    const editor = createDocumentTagEditor({ frontmatter: 'v0', tags: [] }, save)
    editor.setTags(['a'])
    await turn()
    editor.sync({ frontmatter: 'v2', tags: ['external'] })
    editor.undo()
    expect(save).toHaveBeenCalledTimes(1)
    editor.setTags(['external', 'b'])
    await turn()
    editor.sync({ frontmatter: 'v3', tags: ['latest'] })
    expect(editor.getSnapshot()).toEqual({ tags: ['latest'], saving: false, error: 'conflict' })
    editor.setTags(['latest', 'b'])
    await turn()
    expect(save.mock.calls[2]).toEqual(['v3', ['latest', 'b']])
    expect(editor.getSnapshot().error).toBeNull()
  })
})
