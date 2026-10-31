import { readFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { adapterEntry } from './runtimeEnvironment'

afterEach(() => vi.unstubAllEnvs())
it.each([true, false])(
  'controls automatic title requests only in the owned Harness (disabled: %s)',
  async (disabled) => {
    vi.stubEnv('MELO_DISABLE_TITLE_GENERATION', disabled ? '1' : '0')
    const source = await readFile(adapterEntry('codex'), 'utf8')
    const start = source.indexOf('  onTurnCompleted(userPromptText) {')
    const end = source.indexOf('\n  /**', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    // Importing the adapter starts its CLI. Exercise only the pinned policy hook.
    const onTurnCompleted = new Function(
      `return ({${source.slice(start, end)}}).onTurnCompleted`,
    )() as (this: typeof title, prompt: string) => void
    const title = {
      generated: false,
      inFlight: null as Promise<void> | null,
      getSessionTitleSource: () => 'unset',
      generateAndPersist: vi.fn(async () => {}),
    }
    onTurnCompleted.call(title, 'Fixture prompt')
    await title.inFlight
    expect(title.generateAndPersist).toHaveBeenCalledTimes(disabled ? 0 : 1)
  },
)
