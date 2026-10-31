import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { agentApiService, type AgentApiCatalog, type AgentApiServiceId } from '@shared/agentApi'
import type { AgentProvider } from '@shared/types/agent'
import { agentCommand } from '../../store/agent'
import { Select } from '../ui/Select'
import { Button } from '../ui/Button'
import { agentErrorText } from './agentError'

export function AgentApiModelField({
  provider,
  apiService,
  baseUrl,
  apiKey,
  hasKey,
  model,
  disabled,
  onChange,
}: {
  provider: AgentProvider
  apiService: AgentApiServiceId
  baseUrl: string
  apiKey: string
  hasKey: boolean
  model: string
  disabled: boolean
  onChange(model: string): void
}) {
  const { t } = useTranslation()
  const [manual, setManual] = useState(apiService === 'custom')
  const [catalog, setCatalog] = useState<AgentApiCatalog>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requests = useRef({ generation: 0, pending: false })
  useEffect(() => {
    const state = requests.current
    state.generation++
    state.pending = false
    setCatalog(undefined)
    setError('')
    setLoading(false)
    return () => {
      state.generation++
    }
  }, [provider, apiService, baseUrl, apiKey, hasKey])
  const load = async (refresh = false) => {
    const state = requests.current
    if (state.pending || (!refresh && catalog)) return
    const request = ++state.generation
    state.pending = true
    setLoading(true)
    setError('')
    try {
      const result = await agentCommand({
        action: 'api-models',
        provider,
        apiService,
        baseUrl,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        refresh,
      })
      if (request !== state.generation) return
      setCatalog(result.apiCatalog)
    } catch (error) {
      if (request === state.generation)
        setError(agentErrorText(error instanceof Error ? error.message : ''))
    } finally {
      if (request === state.generation) {
        state.pending = false
        setLoading(false)
      }
    }
  }
  const warning = error || (catalog?.warning ? agentErrorText(catalog.warning) : '')
  const known = agentApiService(provider, apiService).models.find((item) => item.id === model)
  const current = catalog?.models.find((item) => item.id === model) ?? known
  return (
    <div className="agent-api-model">
      {manual ? (
        <label>
          {t('agent.model')}
          <input
            value={model}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      ) : (
        <label>
          {t('agent.model')}
          <Select
            value={model}
            label={t('agent.model')}
            disabled={disabled || !(apiKey.trim() || hasKey)}
            displayValue={current?.label ?? (model || t('agent.chooseApiModel'))}
            options={(catalog?.models ?? []).map((item) => ({ value: item.id, label: item.label }))}
            loading={loading}
            notice={warning}
            emptyText={loading ? t('agent.loadingApiModels') : error || t('agent.apiModelsEmpty')}
            onOpenChange={(open) => {
              if (open) void load()
            }}
            onChange={onChange}
            action={{
              label: t('agent.refreshApiModels'),
              onSelect: () => void load(true),
              closeOnSelect: false,
            }}
          />
        </label>
      )}
      <div className="agent-api-model-meta">
        <small>
          {manual
            ? t('agent.manualApiModelHelp')
            : catalog
              ? t(
                  catalog.source === 'curated' ? 'agent.curatedApiModels' : 'agent.remoteApiModels',
                  { date: catalog.verifiedAt },
                )
              : t('agent.apiModelKeyHelp')}
        </small>
        <Button size="small" disabled={disabled} onClick={() => setManual(!manual)}>
          {t(manual ? 'agent.chooseFromApiModels' : 'agent.enterApiModel')}
        </Button>
      </div>
      {warning && (
        <small role="status">
          {catalog && t('agent.apiModelsFallback')} {warning}
        </small>
      )}
    </div>
  )
}
