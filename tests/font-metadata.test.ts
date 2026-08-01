import { describe, expect, it } from 'vitest'
import { sanitizeFontInstances } from '../src/main/media/font-metadata'

describe('font instance metadata', () => {
  it('treats an empty instance list as absent metadata', () => {
    expect(sanitizeFontInstances([])).toBeUndefined()
  })

  it('keeps valid variable-font instances', () => {
    expect(sanitizeFontInstances([{ name: 'Regular', axes: { wght: 400, wdth: 100 } }])).toEqual([
      { name: 'Regular', axes: { wght: 400, wdth: 100 } }
    ])
  })

  it('rejects malformed variable-font axes', () => {
    expect(() => sanitizeFontInstances([{ name: 'Regular', axes: { weight: 400 } }])).toThrow(
      '字体轴信息无效'
    )
  })
})
