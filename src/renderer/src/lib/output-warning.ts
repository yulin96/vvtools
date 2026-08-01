import type { CommonSettings } from '../../../shared/types'

export function shouldShowSourceOverwriteWarning(
  settings: Pick<CommonSettings, 'outputMode' | 'outputConflictPolicy' | 'outputSuffix'>
): boolean {
  return (
    settings.outputMode === 'source' &&
    settings.outputConflictPolicy === 'overwrite' &&
    settings.outputSuffix.length === 0
  )
}
