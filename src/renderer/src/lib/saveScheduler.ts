/* ============================================================
   Debounced save scheduling with a hard cap: fire after `idleMs` of
   no edits, but never let continuous editing defer the fire past
   `maxMs` from the first unsaved edit. Pure timer logic, extracted
   for unit testing.
   ============================================================ */

export interface SaveScheduler {
  /** Note an edit: (re)start the idle timer, arm the cap timer. */
  edited(): void
  /** Cancel both timers without firing. */
  cancel(): void
  /** Whether a fire is currently scheduled. */
  pending(): boolean
}

export function createSaveScheduler(
  fire: () => void,
  idleMs: number,
  maxMs: number,
): SaveScheduler {
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let capTimer: ReturnType<typeof setTimeout> | null = null

  const clear = () => {
    if (idleTimer) clearTimeout(idleTimer)
    if (capTimer) clearTimeout(capTimer)
    idleTimer = null
    capTimer = null
  }

  const trigger = () => {
    clear()
    fire()
  }

  return {
    edited() {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(trigger, idleMs)
      // The cap is armed by the first edit of a dirty stretch and NOT
      // reset by later edits — that's what bounds continuous typing.
      if (!capTimer) capTimer = setTimeout(trigger, maxMs)
    },
    cancel: clear,
    pending: () => idleTimer !== null || capTimer !== null,
  }
}
