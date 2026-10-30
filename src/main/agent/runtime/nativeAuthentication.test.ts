import { afterEach, expect, it, vi } from 'vitest'
import { checkNativeAuthentication } from './nativeAuthentication'

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }) }
})
vi.mock('./runtimeEnvironment', () => ({
  adapterEntry: (provider: string) => `/fixture/${provider}.js`,
}))
afterEach(() => vi.resetAllMocks())

it.each(['claude', 'codex'] as const)('uses only the %s CLI status command', async (provider) => {
  execute.mockResolvedValue({
    stdout: provider === 'claude' ? '{"loggedIn":true}' : 'Logged in using ChatGPT',
    stderr: '',
  })
  expect((await checkNativeAuthentication('/fixture/node', provider)).status).toBe('signed-in')
  expect(execute.mock.calls[0][1]).toEqual(
    provider === 'claude'
      ? ['/fixture/claude.js', '--cli', 'auth', 'status', '--json']
      : ['/fixture/codex.js', 'cli', 'login', 'status'],
  )
  expect(execute).toHaveBeenCalledTimes(1)
})
it.each(['claude', 'codex'] as const)(
  'recognizes an explicit signed-out %s response',
  async (provider) => {
    execute.mockRejectedValue({ code: 1, stdout: '{"loggedIn":false}', stderr: 'Not logged in' })
    expect((await checkNativeAuthentication('/fixture/node', provider)).status).toBe('signed-out')
  },
)
it.each([{ code: 'ETIMEDOUT' }, { code: null, killed: true }])(
  'reports a timeout instead of unknown or signed-out',
  async (error) => {
    execute.mockRejectedValue(error)
    await expect(checkNativeAuthentication('/fixture/node', 'codex')).rejects.toThrow(
      'AGENT_AUTH_CHECK_TIMEOUT',
    )
  },
)
it.each(['claude', 'codex'] as const)(
  'does not treat an arbitrary %s CLI failure as signed-out or expose its output',
  async (provider) => {
    execute.mockRejectedValue({
      code: 1,
      stdout: 'private account details',
      stderr: 'config failure: private credential',
    })
    await expect(checkNativeAuthentication('/fixture/node', provider)).rejects.toThrow(
      /^AGENT_AUTH_CHECK_FAILED$/,
    )
  },
)
it('reports malformed Claude status as a check failure', async () => {
  execute.mockResolvedValue({ stdout: 'not json', stderr: '' })
  await expect(checkNativeAuthentication('/fixture/node', 'claude')).rejects.toThrow(
    'AGENT_AUTH_CHECK_FAILED',
  )
})

it('returns only a validated email from Claude status, without retaining other account fields', async () => {
  execute.mockResolvedValue({
    stdout: JSON.stringify({ loggedIn: true, email: 'test@example.com', token: 'do-not-return' }),
    stderr: '',
  })
  expect(await checkNativeAuthentication('/fixture/node', 'claude')).toEqual({
    status: 'signed-in',
    email: 'test@example.com',
  })
})
it('reports the Codex sign-in method without returning the displayed key', async () => {
  execute.mockResolvedValue({
    stdout: '',
    stderr: 'Logged in using an API key - private-key-fixture',
  })
  expect(await checkNativeAuthentication('/fixture/node', 'codex')).toEqual({
    status: 'signed-in',
    method: 'api-key',
  })
})
