import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSaveScheduler } from './saveScheduler'

const IDLE = 10_000
const MAX = 60_000

describe('createSaveScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires once after the idle delay', () => {
    const fire = vi.fn()
    const s = createSaveScheduler(fire, IDLE, MAX)
    s.edited()
    vi.advanceTimersByTime(IDLE - 1)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(1)
    expect(s.pending()).toBe(false)
  })

  it('postpones the idle fire on every edit', () => {
    const fire = vi.fn()
    const s = createSaveScheduler(fire, IDLE, MAX)
    for (let i = 0; i < 5; i++) {
      s.edited()
      vi.advanceTimersByTime(IDLE - 1)
    }
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('the cap bounds continuous editing at maxMs from the first edit', () => {
    const fire = vi.fn()
    const s = createSaveScheduler(fire, IDLE, MAX)
    // Edit every 5s — the idle timer never elapses, the cap must fire.
    const step = 5_000
    for (let elapsed = 0; elapsed < MAX; elapsed += step) {
      s.edited()
      vi.advanceTimersByTime(step)
    }
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('a new edit after the fire re-arms both timers', () => {
    const fire = vi.fn()
    const s = createSaveScheduler(fire, IDLE, MAX)
    s.edited()
    vi.advanceTimersByTime(IDLE)
    expect(fire).toHaveBeenCalledTimes(1)
    s.edited()
    expect(s.pending()).toBe(true)
    vi.advanceTimersByTime(IDLE)
    expect(fire).toHaveBeenCalledTimes(2)
  })

  it('cancel drops both timers without firing', () => {
    const fire = vi.fn()
    const s = createSaveScheduler(fire, IDLE, MAX)
    s.edited()
    s.cancel()
    expect(s.pending()).toBe(false)
    vi.advanceTimersByTime(MAX * 2)
    expect(fire).not.toHaveBeenCalled()
  })
})
