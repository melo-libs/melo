import { createElement } from 'react'
import { parseHTML } from 'linkedom'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { AgentCommandResult } from '@shared/types/agent'
import { AgentApiModelField } from './AgentApiModelField'
import { agentCommand } from '../../store/agent'
import { Select } from '../ui/Select'

vi.mock('../../store/agent', () => ({ agentCommand: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./agentError', () => ({ agentErrorText: (code: string) => code }))
vi.mock('../ui/Select', () => ({
  Select: vi.fn((props: ComponentProps<typeof Select>) =>
    createElement(
      'button',
      { type: 'button', onClick: () => props.onOpenChange?.(true) },
      props.displayValue,
    ),
  ),
}))
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
const initial: ComponentProps<typeof AgentApiModelField> = {
  provider: 'claude',
  apiService: 'deepseek',
  baseUrl: 'https://api.deepseek.com/anthropic',
  apiKey: '',
  hasKey: true,
  model: 'deepseek-flash',
  disabled: false,
  onChange: vi.fn(),
}
async function render() {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  const { createRoot } = await import('react-dom/client'),
    { flushSync } = await import('react-dom')
  const root = createRoot(window.document.getElementById('root')!)
  const update = (props = initial) =>
    flushSync(() => root.render(createElement(AgentApiModelField, props)))
  update()
  return { window, update, flushSync, close: () => flushSync(() => root.unmount()) }
}
const props = () => vi.mocked(Select).mock.lastCall![0]

it('keeps the selected model stable, loads only when opened, and offers refresh inside the shared menu', async () => {
  let finish!: (result: AgentCommandResult) => void
  vi.mocked(agentCommand).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const view = await render()
  try {
    expect(agentCommand).not.toHaveBeenCalled()
    view.flushSync(() => props().onOpenChange!(true))
    expect(props().loading).toBe(true)
    expect(props().displayValue).toBe('DeepSeek Flash')
    expect(initial.onChange).not.toHaveBeenCalled()
    finish({ apiCatalog: { source: 'remote', models: [{ id: 'deepseek-flash', label: 'Flash' }] } })
    await vi.waitFor(() => expect(props().loading).toBe(false))
    expect(props().options).toEqual([{ value: 'deepseek-flash', label: 'Flash' }])
    view.flushSync(() => props().onOpenChange!(true))
    expect(agentCommand).toHaveBeenCalledTimes(1)
    view.flushSync(() => props().action!.onSelect())
    expect(agentCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'api-models', refresh: true, apiService: 'deepseek' }),
    )
    expect(props().action!.closeOnSelect).toBe(false)
  } finally {
    view.close()
  }
})

it('ignores results for an old draft key, and keeps failed queries retryable without changing the model', async () => {
  let finish!: (result: AgentCommandResult) => void
  vi.mocked(agentCommand).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const view = await render()
  try {
    view.flushSync(() => props().onOpenChange!(true))
    view.update({ ...initial, apiKey: 'new-key' })
    finish({ apiCatalog: { source: 'remote', models: [{ id: 'old-key-model', label: 'Old' }] } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(props().options).toEqual([])
    vi.mocked(agentCommand).mockRejectedValueOnce(new Error('AGENT_API_AUTH_FAILED'))
    view.flushSync(() => props().onOpenChange!(true))
    await vi.waitFor(() => expect(props().emptyText).toBe('AGENT_API_AUTH_FAILED'))
    expect(props().displayValue).toBe('DeepSeek Flash')
    expect(initial.onChange).not.toHaveBeenCalled()
    expect(agentCommand).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'new-key' }))
  } finally {
    view.close()
  }
})

it('labels built-in fallback directories and keeps manual entry available', async () => {
  vi.mocked(agentCommand).mockResolvedValue({
    apiCatalog: {
      source: 'curated',
      verifiedAt: '2026-10-30',
      warning: 'AGENT_API_TIMEOUT',
      models: [{ id: 'deepseek-flash', label: 'Flash' }],
    },
  })
  const view = await render()
  try {
    view.flushSync(() => props().onOpenChange!(true))
    await vi.waitFor(() =>
      expect(view.window.document.body.textContent).toContain('agent.curatedApiModels'),
    )
    expect(view.window.document.querySelector('[role="status"]')?.textContent).toContain(
      'AGENT_API_TIMEOUT',
    )
    view.flushSync(() =>
      view.window.document
        .querySelector<HTMLButtonElement>('.agent-api-model-meta button')!
        .click(),
    )
    expect(view.window.document.querySelector<HTMLInputElement>('input')?.value).toBe(
      'deepseek-flash',
    )
    expect(initial.onChange).not.toHaveBeenCalled()
  } finally {
    view.close()
  }
})

it('shows a failed refresh alongside the previous catalog instead of silently keeping stale options', async () => {
  vi.mocked(agentCommand)
    .mockResolvedValueOnce({
      apiCatalog: { source: 'remote', models: [{ id: 'deepseek-flash', label: 'Flash' }] },
    })
    .mockRejectedValueOnce(new Error('AGENT_API_NETWORK_ERROR'))
  const view = await render()
  try {
    view.flushSync(() => props().onOpenChange!(true))
    await vi.waitFor(() => expect(props().options).toHaveLength(1))
    view.flushSync(() => props().action!.onSelect())
    await vi.waitFor(() => expect(props().loading).toBe(false))
    expect(props().options).toHaveLength(1)
    expect(props().notice).toBe('AGENT_API_NETWORK_ERROR')
    expect(view.window.document.querySelector('[role="status"]')?.textContent).toContain(
      'AGENT_API_NETWORK_ERROR',
    )
    expect(initial.onChange).not.toHaveBeenCalled()
  } finally {
    view.close()
  }
})
