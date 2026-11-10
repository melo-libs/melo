import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseHTML } from 'linkedom'
import { getSchema, type Editor } from '@tiptap/core'
import { EditorState, NodeSelection } from '@tiptap/pm/state'
import { editorExtensions } from './tiptapExtensions'
import { canCopyEditorSelection } from './EditorClipboard'

afterEach(() => vi.unstubAllGlobals())

describe('clipboard focus inside a selected image viewport', () => {
  const schema = getSchema(editorExtensions)
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.node('image', { src: 'photo.png' })]),
  ])
  const state = EditorState.create({ doc, selection: NodeSelection.create(doc, 1) })

  function canCopy(active: string) {
    const { document } = parseHTML(
      '<main><span id="selected"><span id="canvas" tabindex="0"></span><button id="control"></button><input id="input"></span></main><input id="outside">',
    )
    Object.defineProperty(document, 'activeElement', { value: document.getElementById(active) })
    Object.defineProperty(document, 'getSelection', { value: () => null })
    const editor = {
      state,
      view: {
        dom: document.querySelector('main'),
        nodeDOM: () => document.getElementById('selected'),
      },
    } as unknown as Editor
    return canCopyEditorSelection(editor)
  }

  it('keeps Copy as Markdown available on the selected node canvas and controls', () => {
    expect(canCopy('canvas')).toBe(true)
    expect(canCopy('control')).toBe(true)
  })
  it('leaves text fields and unrelated focus targets to native copying', () => {
    expect(canCopy('input')).toBe(false)
    expect(canCopy('outside')).toBe(false)
  })
})
