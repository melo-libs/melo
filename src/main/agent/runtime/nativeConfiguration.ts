import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import type { AgentModelControl, AgentNativePreferences } from '../../../shared/types/agent'
import type { AcpConnection } from './acpConnection'

export function modelControls(options: SessionConfigOption[]): AgentModelControl[] {
  return options.flatMap((option) => {
    if (
      option.type !== 'select' ||
      (option.category !== 'model' && option.category !== 'thought_level')
    )
      return []
    const choices = option.options.flatMap((entry) =>
      'options' in entry ? entry.options : [entry],
    )
    const values = choices.map((entry) => ({ value: entry.value, label: entry.name }))
    if (!values.some((entry) => entry.value === option.currentValue)) {
      values.unshift({ value: option.currentValue, label: option.currentValue })
    }
    return [
      { id: option.id, category: option.category, value: option.currentValue, options: values },
    ]
  })
}

export async function applyNativePreferences(
  connection: AcpConnection,
  options: SessionConfigOption[],
  preferences?: AgentNativePreferences,
): Promise<SessionConfigOption[]> {
  if (!preferences) return options
  for (const category of ['model', 'thought_level'] as const) {
    const control = modelControls(options).find((option) => option.category === category)
    const value = category === 'model' ? preferences.model : preferences.effort
    if (!control || value === undefined) continue
    if (control.value !== value) options = await connection.setConfigOption(control.id, value)
    // Pin even a displayed effort: Claude's default picker can otherwise remain
    // tied to file-backed preferences changed outside Melo during a session.
    else if (category === 'thought_level')
      options = await connection.setConfigOption(control.id, value)
  }
  return options
}

export function nativePreferences(controls: AgentModelControl[]): AgentNativePreferences {
  const model = controls.find((option) => option.category === 'model')
  if (!model) throw new Error('This harness does not advertise model controls')
  const effort = controls.find((option) => option.category === 'thought_level')
  const modelLabel = model.options.find((option) => option.value === model.value)?.label
  const effortLabel = effort?.options.find((option) => option.value === effort.value)?.label
  return {
    model: model.value,
    effort: effort?.value,
    ...(modelLabel && modelLabel !== model.value ? { modelLabel } : {}),
    ...(effortLabel && effortLabel !== effort?.value ? { effortLabel } : {}),
  }
}
