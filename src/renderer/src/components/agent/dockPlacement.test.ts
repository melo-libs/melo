import { expect, it } from 'vitest'
import { placeDock } from './dockPlacement'

const viewport = { x: 0, y: 0, width: 1000, height: 900 }
const size = { width: 48, height: 48 }

it('leaves an unobstructed preferred position alone', () => {
  expect(
    placeDock({ x: 600, y: 450 }, viewport, size, [{ x: 800, y: 800, width: 180, height: 40 }]),
  ).toEqual({ x: 600, y: 450 })
})

it('uses the nearest free position above controls and the status bar', () => {
  expect(
    placeDock({ x: 920, y: 820 }, viewport, size, [
      { x: 0, y: 872, width: 1000, height: 28 },
      { x: 800, y: 800, width: 180, height: 40 },
    ]),
  ).toEqual({ x: 920, y: 740 })
})

it('keeps edge clearance even for a saved position outside the viewport', () => {
  expect(placeDock({ x: 1500, y: 1200 }, viewport, size, [])).toEqual({ x: 920, y: 820 })
  expect(placeDock({ x: -20, y: -20 }, viewport, size, [])).toEqual({ x: 32, y: 64 })
})

it('rounds away from fractional control edges so the gap remains intact', () => {
  expect(
    placeDock({ x: 920, y: 820 }, viewport, size, [{ x: 800, y: 800.4, width: 180, height: 40 }]),
  ).toEqual({ x: 920, y: 740 })
})
