import { useTranslation } from 'react-i18next'
import { Select } from '../ui/Select'
import type { AgentModelControl, AgentSetup } from '@shared/types/agent'
import { Icon } from '../Icon'
import type { AgentModelLoadState } from '../../store/agent'
import { agentErrorText } from './agentError'

export function AgentModelMenu({
  setup,
  disabled,
  modelLoad,
  onLoad,
  onChange,
}: {
  setup: AgentSetup | null
  disabled: boolean
  modelLoad: AgentModelLoadState
  onLoad(): void
  onChange(category: AgentModelControl['category'], value: string): void
}) {
  const { t } = useTranslation()
  const configuration = setup?.configuration
  const native = configuration?.access === 'native'
  const preferences = native ? configuration.native : undefined
  const unknown = !setup || (native && !preferences && setup.nativeControls === undefined)
  const failed = modelLoad.status === 'error' && native
  const loading = !setup || (native && (modelLoad.status === 'loading' || (unknown && !failed)))
  const modelControl = native
    ? setup?.nativeControls?.find((option) => option.category === 'model')
    : undefined
  const effort = native
    ? setup?.nativeControls?.find((option) => option.category === 'thought_level')
    : undefined
  const model = native
    ? (preferences?.model ?? modelControl?.value ?? t('agent.automaticModel'))
    : configuration?.model || t('agent.automaticModel')
  const modelLabel =
    preferences?.modelLabel ??
    modelControl?.options.find((option) => option.value === model)?.label ??
    model
  const effortValue = preferences?.effort ?? effort?.value
  const effortLabel =
    preferences?.effortLabel ??
    effort?.options.find((option) => option.value === effortValue)?.label ??
    effortValue
  const loadOnOpen = (open: boolean) => {
    if (open && native && modelLoad.status === 'idle') onLoad()
  }
  return (
    <>
      <Select
        className="agent-picker agent-model"
        contentClassName="agent-picker-menu"
        side="top"
        align="start"
        icon={<Icon name="cube" size={14} />}
        label={t('agent.model')}
        value={model}
        displayValue={unknown ? undefined : modelLabel}
        options={
          !setup || failed
            ? []
            : native
              ? (modelControl?.options ?? [])
              : [{ value: model, label: model }]
        }
        loading={loading}
        placeholder={t('agent.model')}
        emptyText={failed ? agentErrorText(modelLoad.message) : t('agent.loadingModelOptions')}
        onOpenChange={loadOnOpen}
        onChange={(value) => {
          if (modelControl) onChange('model', value)
        }}
        disabled={!setup || disabled}
        description={
          unknown ? undefined : native ? t('agent.nativeModelHelp') : t('agent.apiModelHelp')
        }
        descriptionLabel={t('agent.modelHelpLabel')}
        action={
          failed
            ? { label: t('agent.retryModels'), onSelect: onLoad, closeOnSelect: false }
            : undefined
        }
      />
      {(effort || effortValue !== undefined || unknown) && (
        <Select
          className="agent-picker agent-effort"
          contentClassName="agent-picker-menu"
          side="top"
          align="start"
          label={t('agent.reasoningEffort')}
          value={effortValue ?? ''}
          displayValue={effortLabel}
          options={failed ? [] : (effort?.options ?? [])}
          placeholder={t('agent.reasoningEffort')}
          loading={loading}
          emptyText={failed ? agentErrorText(modelLoad.message) : t('agent.loadingModelOptions')}
          onOpenChange={loadOnOpen}
          action={
            failed
              ? { label: t('agent.retryModels'), onSelect: onLoad, closeOnSelect: false }
              : undefined
          }
          disabled={disabled || !setup || (effortValue === undefined && !effort)}
          onChange={(value) => onChange('thought_level', value)}
        />
      )}
    </>
  )
}
