import { useCallback, useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import type { AgentProvider } from '@shared/types/agent'
import { agentAccountsAtom, agentCommand } from '../../store/agent'
import { agentErrorText } from './agentError'

export function useAgentAccounts(enabled: boolean) {
  const [accounts, setAccounts] = useAtom(agentAccountsAtom)
  const generation = useRef(0)
  const pending = useRef(new Set<AgentProvider>())
  const loginProvider = useRef<AgentProvider | null>(null)
  const check = useCallback(
    async (provider: AgentProvider) => {
      if (!enabled || pending.current.has(provider)) return
      const request = generation.current
      pending.current.add(provider)
      setAccounts((current) => ({ ...current, [provider]: { status: 'checking' } }))
      try {
        const response = await agentCommand({ action: 'check-sign-in', provider })
        const authentication = response.authentication
        if (!authentication) throw new Error('AGENT_AUTH_CHECK_FAILED')
        if (request === generation.current)
          setAccounts((current) => ({ ...current, [provider]: authentication }))
      } catch (error) {
        if (request === generation.current)
          setAccounts((current) => ({
            ...current,
            [provider]: {
              status: 'error',
              message: agentErrorText(error instanceof Error ? error.message : ''),
            },
          }))
      } finally {
        if (request === generation.current) pending.current.delete(provider)
      }
    },
    [enabled, setAccounts],
  )
  useEffect(() => {
    const version = ++generation.current
    const requests = pending.current
    return () => {
      generation.current = version + 1
      requests.clear()
    }
  }, [])
  useEffect(() => {
    if (!enabled) return
    if (accounts.claude.status === 'unknown' || accounts.claude.status === 'checking')
      void check('claude')
    if (accounts.codex.status === 'unknown' || accounts.codex.status === 'checking')
      void check('codex')
  }, [enabled, accounts.claude.status, accounts.codex.status, check])
  useEffect(() => {
    if (!enabled) return
    const onFocus = () => {
      const provider = loginProvider.current
      if (!provider) return
      loginProvider.current = null
      void check(provider)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, check])
  const login = async (provider: AgentProvider) => {
    loginProvider.current = provider
    try {
      await agentCommand({ action: 'login', provider })
    } catch (error) {
      loginProvider.current = null
      throw error
    }
  }
  return { accounts, check, login }
}
