import type { FontEditValues, FontOptions } from '../../shared/types'
import { inspectFontFileCore, saveEditedFontFileCore } from './font-inspector-core'
import { probeFontCore } from './font-probe-core'

type Request =
  | { kind: 'inspect'; sourcePath: string }
  | { kind: 'probe'; sourcePath: string; options: FontOptions }
  | { kind: 'edit'; sourcePath: string; outputPath: string; edits: FontEditValues }

process.on('message', async (request: Request) => {
  try {
    let result: unknown
    if (request.kind === 'inspect') result = inspectFontFileCore(request.sourcePath)
    else if (request.kind === 'probe')
      result = await probeFontCore(request.sourcePath, request.options)
    else if (request.kind === 'edit')
      await saveEditedFontFileCore(request.sourcePath, request.outputPath, request.edits)
    else throw new Error('字体操作无效')
    process.send?.({ ok: true, result })
  } catch (error) {
    process.send?.({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})
