import { useEffect, useState, useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import type { TableHandlesState } from './TableHandlePlugin'

export function useTableHandleState(editor: Editor | null) {
  const [state, setState] = useState<TableHandlesState | null>(null)
  const prevRef = useRef<TableHandlesState | null>(null)

  const updateState = useCallback((newState: TableHandlesState) => {
    setState(newState)
    prevRef.current = newState
  }, [])

  useEffect(() => {
    if (!editor) {
      setState(null)
      prevRef.current = null
      return
    }

    editor.on('tableHandleState', updateState)
    return () => {
      editor.off('tableHandleState', updateState)
    }
  }, [editor, updateState])

  return state
}
