import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PDFDocument } from 'pdf-lib'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PDF_OPTIONS } from '../../shared/constants'
import { validateCreateRequest } from '../ipc-validation'
import { probePdfProcess, shutdownPdfProcesses } from './pdf-process'

const directories: string[] = []

afterEach(async () => {
  shutdownPdfProcesses()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('PDF submission metadata', () => {
  it.each(['lossless', 'lossy', 'toImage'] as const)(
    'accepts fractional PDF page dimensions for %s',
    async (mode) => {
      const root = await mkdtemp(join(tmpdir(), 'vvtools-pdf-submission-'))
      directories.push(root)
      const source = join(root, 'a4.pdf')
      const document = await PDFDocument.create()
      document.addPage([595.28, 841.89])
      await writeFile(source, await document.save())
      const probe = await probePdfProcess(source, new AbortController().signal)
      expect(probe.width).toBeCloseTo(595.28, 2)
      expect(probe.height).toBeCloseTo(841.89, 2)
      expect(Number.isInteger(probe.width)).toBe(false)

      const metadata = {
        path: source,
        width: mode === 'toImage' ? Math.round((probe.width * 150) / 72) : probe.width,
        height: mode === 'toImage' ? Math.round((probe.height * 150) / 72) : probe.height,
        inputWidth: probe.width,
        inputHeight: probe.height,
        pageCount: probe.pageCount
      }
      const result = validateCreateRequest({
        kind: 'pdf',
        sourcePaths: [source],
        outputMode: 'source',
        outputDirectory: '',
        outputSuffix: '_out',
        inputMetadata: [metadata],
        options: {
          ...DEFAULT_PDF_OPTIONS,
          operation: mode === 'toImage' ? 'toImage' : 'compress',
          compressionMode: mode === 'toImage' ? 'lossless' : mode,
          dpi: 150
        }
      })
      expect(result.inputMetadata).toEqual([metadata])
    }
  )
})
