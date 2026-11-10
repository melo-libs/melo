import { describe, expect, it } from 'vitest'
import { imageDisplaySize, zoomImage } from './ImageViewport'

describe('image viewport zoom', () => {
  it('keeps the diagram point under the cursor fixed', () => {
    const view = { scale: 0.5, x: 20, y: -10 }
    const point = { x: 120, y: 90 }
    const zoomed = zoomImage(view, point, 2, 0.1)
    expect(zoomed).toEqual({ scale: 1, x: -80, y: -110 })
    expect((point.x - zoomed.x) / zoomed.scale).toBe((point.x - view.x) / view.scale)
    expect((point.y - zoomed.y) / zoomed.scale).toBe((point.y - view.y) / view.scale)
  })

  it('clamps zoom without moving the cursor anchor at the limits', () => {
    const view = { scale: 8, x: 20, y: -10 }
    expect(zoomImage(view, { x: 120, y: 90 }, 2, 0.1)).toEqual(view)
    const minimum = { scale: 0.1, x: 0, y: 0 }
    expect(zoomImage(minimum, { x: 120, y: 90 }, 0.5, 0.1)).toEqual(minimum)
  })

  it('allows a large fitted diagram to zoom back out to its original fit', () => {
    expect(zoomImage({ scale: 0.04, x: 0, y: 0 }, { x: 0, y: 0 }, 0.5, 0.02).scale).toBe(0.02)
  })
})

describe('image display dimensions', () => {
  const size = (width: string | null, height: string | null) =>
    imageDisplaySize({
      naturalWidth: 640,
      naturalHeight: 320,
      getAttribute: (name) => (name === 'width' ? width : height),
    })
  it('preserves authored dimensions and their aspect ratio', () => {
    expect(size('160', null)).toEqual({ width: 160, height: 80 })
    expect(size(null, '80')).toEqual({ width: 160, height: 80 })
    expect(size('160', '160')).toEqual({ width: 160, height: 160 })
  })
  it('uses intrinsic dimensions when no valid size is supplied', () => {
    expect(size(null, null)).toEqual({ width: 640, height: 320 })
    expect(size('NaN', '-1')).toEqual({ width: 640, height: 320 })
  })
})
