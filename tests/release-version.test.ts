import { describe, expect, it } from 'vitest'
import { resolveReleaseVersion } from '../src/shared/release-version.mjs'

describe('release version', () => {
  it.each([
    ['patch', '0.5.1'],
    ['minor', '0.6.0'],
    ['major', '1.0.0'],
    ['0.7.0', '0.7.0']
  ])('resolves %s', (input, expected) => {
    expect(resolveReleaseVersion('0.5.0', input)).toBe(expected)
  })

  it.each(['invalid', 'v0.6.0', '0.5.0', '0.4.99'])('rejects %s', (input) => {
    expect(() => resolveReleaseVersion('0.5.0', input)).toThrow()
  })
})
