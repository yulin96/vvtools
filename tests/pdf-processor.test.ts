import { mkdtempSync, rmSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PDF_OPTIONS } from '../src/shared/constants'
import type { MediaTask } from '../src/shared/types'
import { isQpdfSuccessExitCode, probePdf, processPdf } from '../src/main/media/pdf-processor'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('PDF processor', () => {
  it('accepts qpdf success and warning exit codes', () => {
    expect(isQpdfSuccessExitCode(0)).toBe(true)
    expect(isQpdfSuccessExitCode(3)).toBe(true)
    expect(isQpdfSuccessExitCode(2)).toBe(false)
  })

  it('compresses a PDF after qpdf repairs a broken xref entry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vvtools-pdf-'))
    directories.push(root)
    const sourcePath = join(root, 'broken-xref.pdf')
    const outputPath = join(root, 'compressed.pdf')
    await writeFile(sourcePath, createPdfWithBrokenXref())
    const task: MediaTask = {
      id: 'pdf-warning',
      kind: 'pdf',
      sourcePath,
      outputPath,
      status: 'processing',
      progress: 0,
      options: { ...DEFAULT_PDF_OPTIONS, operation: 'compress' },
      sourceSize: 1,
      createdAt: new Date(0).toISOString()
    }

    expect(await processPdf(task, new AbortController().signal)).toBeGreaterThan(0)
    expect((await readFile(outputPath)).subarray(0, 5).toString()).toBe('%PDF-')
    await expect(probePdf(outputPath, new AbortController().signal)).resolves.toMatchObject({
      pageCount: 1,
      width: 100,
      height: 100
    })
  })
})

function createPdfWithBrokenXref(): Buffer {
  const chunks = ['%PDF-1.4\n']
  const offsets: number[] = []
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Metadata 5 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /Metadata /Subtype /XML /Length 0 >>\nstream\n\nendstream\nendobj\n'
  ]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(chunks.join('')))
    chunks.push(object)
  }
  const xrefOffset = Buffer.byteLength(chunks.join(''))
  chunks.push('xref\n0 6\n0000000000 65535 f \n')
  for (const [index, offset] of offsets.entries()) {
    const xrefEntry = index === 4 ? 0 : offset
    chunks.push(`${xrefEntry.toString().padStart(10, '0')} 00000 n \n`)
  }
  chunks.push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
  return Buffer.from(chunks.join(''))
}
