import i18n from '../../i18n'

export function agentErrorText(code: string): string {
  const key = `agent.errors.${code}`
  return i18n.exists(key) ? i18n.t(key) : code || i18n.t('agent.failed')
}
