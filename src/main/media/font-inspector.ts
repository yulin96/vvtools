import type { FontEditValues, FontInspection } from '../../shared/types'
import { createFontPreviewUrl } from './font-preview-protocol'
import { fontMetadataProcesses } from './font-metadata-process'
export { validateFontEditValues } from './font-edit-values'

export async function inspectFontFile(sourcePath: string): Promise<FontInspection> {
  const result = await fontMetadataProcesses.run<Omit<FontInspection, 'previewUrl'>>({
    kind: 'inspect',
    sourcePath
  })
  return { ...result, previewUrl: createFontPreviewUrl(sourcePath) }
}

export async function saveEditedFontFile(
  sourcePath: string,
  outputPath: string,
  edits: FontEditValues
): Promise<void> {
  await fontMetadataProcesses.run({ kind: 'edit', sourcePath, outputPath, edits })
}
