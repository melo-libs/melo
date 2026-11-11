import { expect, it } from 'vitest'
import { agentDockWidth } from './agentPanelLayout'

it('protects document space and retains a usable conversation width', () => {
  expect(agentDockWidth(420, 359)).toBe(0)
  expect(agentDockWidth(420, 360)).toBe(360)
  expect(agentDockWidth(420, 400)).toBe(400)
  expect(agentDockWidth(500, 600)).toBe(500)
  expect(agentDockWidth(200, 600)).toBe(360)
  expect(agentDockWidth(900, 800)).toBe(600)
  expect(agentDockWidth(Number.NaN, 600)).toBe(420)
})
