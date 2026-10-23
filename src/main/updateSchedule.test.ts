import { afterEach, describe, expect, it, vi } from 'vitest'
import { scheduleUpdateChecks } from './updateSchedule'

afterEach(() => vi.useRealTimers())

describe('automatic update schedule', () => {
  it('checks 60 seconds after launch, then every 24 hours rather than every 6 hours', () => {
    vi.useFakeTimers()
    const check = vi.fn()
    const stop = scheduleUpdateChecks(check)
    vi.advanceTimersByTime(59000)
    expect(check).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(check).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(6 * 60 * 60 * 1000)
    expect(check).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(18 * 60 * 60 * 1000 - 60000)
    expect(check).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(check).toHaveBeenCalledTimes(3)
    stop()
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(check).toHaveBeenCalledTimes(3)
  })

  it('can cancel both timers before the initial check', () => {
    vi.useFakeTimers()
    const check = vi.fn()
    scheduleUpdateChecks(check)()
    vi.advanceTimersByTime(48 * 60 * 60 * 1000)
    expect(check).not.toHaveBeenCalled()
  })
})
