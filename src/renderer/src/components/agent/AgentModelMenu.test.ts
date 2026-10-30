import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentSetup } from '@shared/types/agent'
import { Select } from '../ui/Select'
import { AgentModelMenu } from './AgentModelMenu'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./agentError', () => ({ agentErrorText: (message: string) => message }))
vi.mock('../ui/Select', () => ({ Select: vi.fn(() => null) }))
afterEach(() => vi.clearAllMocks())

const setup: AgentSetup = {
  configuration: { provider: 'codex', access: 'native', baseUrl: '', model: '', hasApiKey: false },
  runtimeAvailable: true,
  installing: false,
}

it('keeps both placeholders disabled until connection setup is available', () => {
  const onLoad = vi.fn()
  renderToStaticMarkup(
    createElement(AgentModelMenu, {
      setup: null,
      modelLoad: { status: 'idle' },
      disabled: true,
      onLoad,
      onChange: vi.fn(),
    }),
  )
  const [model, effort] = vi.mocked(Select).mock.calls.map(([props]) => props)
  expect(model.loading).toBe(true)
  expect(model.disabled).toBe(true)
  expect(model.options).toEqual([])
  expect(effort.disabled).toBe(true)
  model.onOpenChange!(true)
  expect(onLoad).not.toHaveBeenCalled()
})

it('does not invent a default model while capabilities are unknown and reserves effort space', () => {
  const onLoad = vi.fn()
  renderToStaticMarkup(
    createElement(AgentModelMenu, {
      setup,
      modelLoad: { status: 'idle' },
      disabled: false,
      onLoad,
      onChange: vi.fn(),
    }),
  )
  const [model, effort] = vi.mocked(Select).mock.calls.map(([props]) => props)
  expect(model.options).toEqual([])
  expect(model.placeholder).toBe('agent.model')
  expect(effort.placeholder).toBe('agent.reasoningEffort')
  expect(effort.disabled).toBe(true)
  model.onOpenChange!(true)
  expect(onLoad).toHaveBeenCalledTimes(1)
})

it('restores the saved model and reasoning labels before any catalog has been fetched', () => {
  const onLoad = vi.fn()
  renderToStaticMarkup(
    createElement(AgentModelMenu, {
      setup: {
        ...setup,
        configuration: {
          ...setup.configuration,
          native: {
            model: 'model-a',
            effort: 'high',
            modelLabel: 'Model A',
            effortLabel: 'High',
          },
        },
      },
      modelLoad: { status: 'idle' },
      disabled: false,
      onLoad,
      onChange: vi.fn(),
    }),
  )
  const [model, effort] = vi.mocked(Select).mock.calls.map(([props]) => props)
  expect(model.displayValue).toBe('Model A')
  expect(effort.displayValue).toBe('High')
  expect(model.options).toEqual([])
  expect(effort.options).toEqual([])
  expect(model.disabled).toBe(false)
  expect(effort.disabled).toBe(false)
  expect(onLoad).not.toHaveBeenCalled()
  effort.onOpenChange!(true)
  expect(onLoad).toHaveBeenCalledTimes(1)
})

it('preserves saved choices while loading or retrying the catalog', () => {
  for (const modelLoad of [
    { status: 'loading' },
    { status: 'error', message: 'offline' },
  ] as const) {
    vi.mocked(Select).mockClear()
    renderToStaticMarkup(
      createElement(AgentModelMenu, {
        setup: {
          ...setup,
          configuration: {
            ...setup.configuration,
            native: { model: 'saved-model', effort: 'high' },
          },
        },
        modelLoad,
        disabled: false,
        onLoad: vi.fn(),
        onChange: vi.fn(),
      }),
    )
    const [model, effort] = vi.mocked(Select).mock.calls.map(([props]) => props)
    expect(model.displayValue).toBe('saved-model')
    expect(effort.displayValue).toBe('high')
    expect(model.disabled).toBe(false)
    expect(effort.disabled).toBe(false)
  }
})

it('shows a loading menu without selectable fake options or duplicate requests', () => {
  const onLoad = vi.fn()
  renderToStaticMarkup(
    createElement(AgentModelMenu, {
      setup,
      modelLoad: { status: 'loading' },
      disabled: false,
      onLoad,
      onChange: vi.fn(),
    }),
  )
  const [model, effort] = vi.mocked(Select).mock.calls.map(([props]) => props)
  expect(model.loading).toBe(true)
  expect(model.placeholder).toBe('agent.model')
  expect(model.emptyText).toBe('agent.loadingModelOptions')
  expect(model.options).toEqual([])
  expect(model.disabled).toBe(false)
  expect(effort.disabled).toBe(true)
  model.onOpenChange!(true)
  expect(onLoad).not.toHaveBeenCalled()
})

it('keeps a failure visible until the user retries', () => {
  const onLoad = vi.fn()
  renderToStaticMarkup(
    createElement(AgentModelMenu, {
      setup,
      modelLoad: { status: 'error', message: 'Catalog unavailable' },
      disabled: false,
      onLoad,
      onChange: vi.fn(),
    }),
  )
  const model = vi.mocked(Select).mock.calls[0][0]
  expect(model.placeholder).toBe('agent.model')
  expect(model.emptyText).toBe('Catalog unavailable')
  expect(model.action?.closeOnSelect).toBe(false)
  model.onOpenChange!(true)
  expect(onLoad).not.toHaveBeenCalled()
  model.action!.onSelect()
  expect(onLoad).toHaveBeenCalledTimes(1)
})

it('shows cached controls and refreshes the catalog only when a menu opens', () => {
  const onLoad = vi.fn(),
    onChange = vi.fn()
  renderToStaticMarkup(
    createElement(AgentModelMenu, {
      setup: {
        ...setup,
        nativeControls: [
          {
            id: 'model',
            category: 'model',
            value: 'model-a',
            options: [{ value: 'model-a', label: 'Model A' }],
          },
          {
            id: 'effort',
            category: 'thought_level',
            value: 'high',
            options: [{ value: 'high', label: 'High' }],
          },
        ],
      },
      modelLoad: { status: 'idle' },
      disabled: false,
      onLoad,
      onChange,
    }),
  )
  const [model, effort] = vi.mocked(Select).mock.calls.map(([props]) => props)
  expect(model.value).toBe('model-a')
  expect(effort.value).toBe('high')
  expect(model.loading).toBe(false)
  model.onOpenChange!(true)
  expect(onLoad).toHaveBeenCalledTimes(1)
  effort.onChange!('high')
  expect(onChange).toHaveBeenCalledWith('thought_level', 'high')
})

it('does not show unsupported reasoning controls after discovery, or fetch native controls for API access', () => {
  const onLoad = vi.fn()
  renderToStaticMarkup(
    createElement(AgentModelMenu, {
      setup: { ...setup, nativeControls: [] },
      modelLoad: { status: 'idle' },
      disabled: false,
      onLoad,
      onChange: vi.fn(),
    }),
  )
  expect(Select).toHaveBeenCalledTimes(1)
  expect(vi.mocked(Select).mock.calls[0][0].options).toEqual([])
  vi.mocked(Select).mockClear()
  renderToStaticMarkup(
    createElement(AgentModelMenu, {
      setup: {
        ...setup,
        configuration: { ...setup.configuration, access: 'api', model: 'api-model' },
      },
      modelLoad: { status: 'error', message: 'Old native error' },
      disabled: false,
      onLoad,
      onChange: vi.fn(),
    }),
  )
  expect(Select).toHaveBeenCalledTimes(1)
  const model = vi.mocked(Select).mock.calls[0][0]
  expect(model.value).toBe('api-model')
  expect(model.loading).toBe(false)
  expect(model.action).toBeUndefined()
  model.onOpenChange!(true)
  expect(onLoad).not.toHaveBeenCalled()
})
