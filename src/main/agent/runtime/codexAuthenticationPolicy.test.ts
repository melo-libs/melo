import { readFile } from 'node:fs/promises'
import { RequestError } from '@agentclientprotocol/sdk'
import { expect, it, vi } from 'vitest'
import { adapterEntry } from './runtimeEnvironment'

it.each(['Please log out and retry', 'Failed to meet cloud requirements'])(
  'reports an authentication failure without revoking the shared account: %s',
  async (message) => {
    const source = await readFile(adapterEntry('codex'), 'utf8')
    const start = source.indexOf('  async handleError(e) {')
    const end = source.indexOf('\n  beginSessionOpen(', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    // Importing the adapter starts its CLI. Evaluate only the pinned error handler.
    const handleError = new Function(
      'RequestError',
      `return ({${source.slice(start, end)}}).handleError`,
    )(RequestError) as (this: typeof account, error: Error) => Promise<void>
    const account = {
      codexAcpClient: { logout: vi.fn(), getHomePath: () => 'unused' },
      runWithProcessCheck: vi.fn(async (work: () => Promise<void>) => work()),
      refreshAuthState: vi.fn(),
    }
    await expect(handleError.call(account, new Error(message))).rejects.toMatchObject({
      code: RequestError.authRequired().code,
    })
    expect(account.codexAcpClient.logout).not.toHaveBeenCalled()
    expect(account.runWithProcessCheck).not.toHaveBeenCalled()
    expect(account.refreshAuthState).not.toHaveBeenCalled()
  },
)
