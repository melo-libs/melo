export interface DockPoint {
  x: number
  y: number
}
interface Rect extends DockPoint {
  width: number
  height: number
}

const EDGE = 32
const TOP = 64
const GAP = 12

/** Keep the preferred position unless bounds or fixed controls make it unusable. */
export function placeDock(
  preferred: DockPoint,
  viewport: Rect,
  size: { width: number; height: number },
  obstacles: Rect[],
): DockPoint {
  const left = viewport.x + EDGE
  const top = viewport.y + TOP
  const right = Math.max(left, viewport.x + viewport.width - size.width - EDGE)
  const bottom = Math.max(top, viewport.y + viewport.height - size.height - EDGE)
  const clampX = (x: number) => Math.round(Math.max(left, Math.min(x, right)))
  const clampY = (y: number) => Math.round(Math.max(top, Math.min(y, bottom)))
  const origin = { x: clampX(preferred.x), y: clampY(preferred.y) }
  const blocked = obstacles.map((rect) => ({
    x: Math.floor(rect.x - GAP),
    y: Math.floor(rect.y - GAP),
    width: Math.ceil(rect.x + rect.width + GAP) - Math.floor(rect.x - GAP),
    height: Math.ceil(rect.y + rect.height + GAP) - Math.floor(rect.y - GAP),
  }))
  const overlap = ({ x, y }: DockPoint) =>
    blocked.reduce(
      (area, rect) =>
        area +
        Math.max(0, Math.min(x + size.width, rect.x + rect.width) - Math.max(x, rect.x)) *
          Math.max(0, Math.min(y + size.height, rect.y + rect.height) - Math.max(y, rect.y)),
      0,
    )
  if (!overlap(origin)) return origin
  const xs = new Set([
    origin.x,
    left,
    right,
    ...blocked.flatMap((rect) => [clampX(rect.x - size.width), clampX(rect.x + rect.width)]),
  ])
  const ys = new Set([
    origin.y,
    top,
    bottom,
    ...blocked.flatMap((rect) => [clampY(rect.y - size.height), clampY(rect.y + rect.height)]),
  ])
  let best = origin
  let bestOverlap = overlap(origin)
  let bestDistance = (origin.x - preferred.x) ** 2 + (origin.y - preferred.y) ** 2
  for (const x of xs)
    for (const y of ys) {
      const candidate = { x, y }
      const area = overlap(candidate)
      const distance = (x - preferred.x) ** 2 + (y - preferred.y) ** 2
      // If no empty position fits, keep the least obstructed reachable position.
      if (area < bestOverlap || (area === bestOverlap && distance < bestDistance)) {
        best = candidate
        bestOverlap = area
        bestDistance = distance
      }
    }
  return best
}
