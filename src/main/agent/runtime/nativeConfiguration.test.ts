import { expect, it, vi } from 'vitest'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import type { AcpConnection } from './acpConnection'
import { applyNativePreferences, modelControls, nativePreferences } from './nativeConfiguration'

const model: SessionConfigOption = {
  id: 'model-id',
  category: 'model',
  name: 'Model',
  type: 'select',
  currentValue: 'a',
  options: [
    {
      group: 'account',
      name: 'Account',
      options: [
        { value: 'a', name: 'Model A' },
        { value: 'b', name: 'Model B' },
      ],
    },
  ],
}
const effort: SessionConfigOption = {
  id: 'reasoning',
  category: 'thought_level',
  name: 'Effort',
  type: 'select',
  currentValue: 'high',
  options: [{ value: 'high', name: 'High' }],
}
it('persists only the current choices and their display labels, separately from the catalog', () => {
  expect(nativePreferences(modelControls([model, effort]))).toEqual({
    model: 'a',
    modelLabel: 'Model A',
    effort: 'high',
    effortLabel: 'High',
  })
})

it('projects only advertised model and reasoning selectors, including grouped and out-of-picker values', () => {
  expect(modelControls([model, effort, { ...model, category: 'mode' }])).toEqual([
    {
      id: 'model-id',
      category: 'model',
      value: 'a',
      options: [
        { value: 'a', label: 'Model A' },
        { value: 'b', label: 'Model B' },
      ],
    },
    {
      id: 'reasoning',
      category: 'thought_level',
      value: 'high',
      options: [{ value: 'high', label: 'High' }],
    },
  ])
  expect(modelControls([{ ...model, currentValue: 'custom' }])[0].options[0].value).toBe('custom')
})
it('reconciles effort against the full replacement returned by a model switch', async () => {
  const setConfigOption = vi.fn().mockResolvedValue([{ ...model, currentValue: 'b' }])
  const connection = { setConfigOption } as unknown as AcpConnection
  const result = await applyNativePreferences(connection, [model, effort], {
    model: 'b',
    effort: 'high',
  })
  expect(setConfigOption.mock.calls).toEqual([['model-id', 'b']])
  expect(modelControls(result).some((option) => option.category === 'thought_level')).toBe(false)
})
it('pins saved effort even when the adapter reports it as the initial value', async () => {
  const setConfigOption = vi.fn().mockResolvedValue([model, effort])
  await applyNativePreferences({ setConfigOption } as unknown as AcpConnection, [model, effort], {
    model: 'a',
    effort: 'high',
  })
  expect(setConfigOption.mock.calls).toEqual([['reasoning', 'high']])
})
