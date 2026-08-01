import { describe, expect, it } from 'vitest'
import { shouldShowSourceOverwriteWarning } from '../src/renderer/src/lib/output-warning'

describe('source overwrite warning', () => {
  it('only shows for source-folder overwrite without a file-name suffix', () => {
    expect(
      shouldShowSourceOverwriteWarning({
        outputMode: 'source',
        outputConflictPolicy: 'overwrite',
        outputSuffix: ''
      })
    ).toBe(true)
    expect(
      shouldShowSourceOverwriteWarning({
        outputMode: 'source',
        outputConflictPolicy: 'overwrite',
        outputSuffix: '_processed'
      })
    ).toBe(false)
    expect(
      shouldShowSourceOverwriteWarning({
        outputMode: 'custom',
        outputConflictPolicy: 'overwrite',
        outputSuffix: ''
      })
    ).toBe(false)
  })
})
