export interface TagEditorSnapshot {
  tags: string[]
  saving: boolean
  error: 'conflict' | 'save' | null
}

/** Serializes quick edits and keeps tag undo separate from the document's text history. */
export function createDocumentTagEditor(
  initial: { frontmatter: string; tags: string[] },
  save: (expectedFrontmatter: string, tags: string[]) => Promise<string>,
) {
  let confirmed = initial
  let snapshot: TagEditorSnapshot = { tags: initial.tags, saving: false, error: null }
  let pending: string[][] = []
  let past: string[][] = []
  let future: string[][] = []
  let saving: Promise<void> | null = null
  const listeners = new Set<() => void>()
  const publish = (next: TagEditorSnapshot) => {
    snapshot = next
    listeners.forEach((listener) => listener())
  }
  const drain = async () => {
    if (snapshot.saving) return
    publish({ ...snapshot, saving: true, error: null })
    while (pending.length) {
      const tags = pending[0]
      try {
        const frontmatter = await save(confirmed.frontmatter, tags)
        confirmed = { frontmatter, tags }
        pending.shift()
      } catch (error) {
        pending = []
        past = []
        future = []
        publish({
          tags: confirmed.tags,
          saving: false,
          error:
            error instanceof Error && error.message === 'DOCUMENT_TAGS_CONFLICT'
              ? 'conflict'
              : 'save',
        })
        return
      }
    }
    publish({ ...snapshot, saving: false })
  }
  const enqueue = (tags: string[]) => {
    pending.push(tags)
    publish({ ...snapshot, tags, error: null })
    if (!snapshot.saving) saving = drain()
  }
  return {
    getSnapshot: () => snapshot,
    async settled(): Promise<boolean> {
      const pendingAtStart = snapshot.saving
      while (snapshot.saving) await saving
      return !pendingAtStart || snapshot.error === null
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    sync(next: { frontmatter: string; tags: string[] }) {
      // The session publishes metadata before its disk write finishes. Only the
      // save result may advance our revision while queued edits are in flight.
      if (snapshot.saving || confirmed.frontmatter === next.frontmatter) return
      confirmed = next
      past = []
      future = []
      publish({ ...snapshot, tags: next.tags })
    },
    setTags(tags: string[]) {
      if (JSON.stringify(tags) === JSON.stringify(snapshot.tags)) return
      past.push(snapshot.tags)
      future = []
      enqueue(tags)
    },
    undo() {
      const tags = past.pop()
      if (!tags) return
      future.push(snapshot.tags)
      enqueue(tags)
    },
    redo() {
      const tags = future.pop()
      if (!tags) return
      past.push(snapshot.tags)
      enqueue(tags)
    },
  }
}
