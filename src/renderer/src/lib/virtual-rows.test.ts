import { describe, expect, it } from 'vitest'
import { virtualRowRange } from './virtual-rows'

describe('visible batch row range', () => {
  it('bounds a 500-row batch to the viewport plus nearby rows', () => {
    expect(virtualRowRange(500, 0, 480)).toEqual({ start: 0, end: 16, before: 0, after: 23232 })
    expect(virtualRowRange(500, 4800, 480)).toEqual({
      start: 94,
      end: 116,
      before: 4512,
      after: 18432
    })
    expect(virtualRowRange(500, 23552, 480)).toEqual({
      start: 484,
      end: 500,
      before: 23232,
      after: 0
    })
  })

  it('keeps all short batches and clamps stale scroll positions after removing rows', () => {
    expect(virtualRowRange(3, 999999, 480)).toEqual({ start: 0, end: 3, before: 0, after: 0 })
    expect(virtualRowRange(0, 4800, 480)).toEqual({ start: 0, end: 0, before: 0, after: 0 })
    expect(virtualRowRange(500, 0, 0)).toEqual({ start: 0, end: 7, before: 0, after: 23664 })
  })
})
