import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { AgentAuthentication, AgentProvider } from '../../../shared/types/agent'
import { adapterEntry } from './runtimeEnvironment'

const execute = promisify(execFile)
const CLAUDE_STATUS = z.object({
  loggedIn: z.boolean(),
  email: z.string().email().nullish().catch(undefined),
})

/** Query CLI status only; never initialize an ACP session or request authentication. */
export async function checkNativeAuthentication(
  node: string,
  provider: AgentProvider,
): Promise<AgentAuthentication> {
  try {
    const args =
      provider === 'claude' ? ['--cli', 'auth', 'status', '--json'] : ['cli', 'login', 'status']
    const result = await execute(node, [adapterEntry(provider), ...args], {
      timeout: 8000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    })
    if (provider === 'claude') {
      const status = CLAUDE_STATUS.parse(JSON.parse(result.stdout))
      return {
        status: status.loggedIn ? 'signed-in' : 'signed-out',
        ...(status.loggedIn && status.email ? { email: status.email } : {}),
      }
    }
    const output = `${result.stdout}\n${result.stderr}`
    const method = /using ChatGPT/i.test(output)
      ? 'chatgpt'
      : /using an? API key/i.test(output)
        ? 'api-key'
        : undefined
    return { status: 'signed-in', ...(method ? { method } : {}) }
  } catch (error) {
    const failure = error as {
      code?: string | number
      killed?: boolean
      stdout?: string
      stderr?: string
    }
    const timedOut = failure.code === 'ETIMEDOUT' || failure.killed
    if (!timedOut && failure.code === 1) {
      if (
        provider === 'codex' &&
        /not logged in/i.test(`${failure.stdout ?? ''}\n${failure.stderr ?? ''}`)
      )
        return { status: 'signed-out' }
      if (provider === 'claude') {
        let status: unknown
        try {
          status = JSON.parse(failure.stdout ?? '')
        } catch {
          status = null
        }
        const result = CLAUDE_STATUS.safeParse(status)
        if (result.success && !result.data.loggedIn) return { status: 'signed-out' }
      }
    }
    // execFile errors retain stdout/stderr, which may include account details.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(timedOut ? 'AGENT_AUTH_CHECK_TIMEOUT' : 'AGENT_AUTH_CHECK_FAILED')
  }
}
