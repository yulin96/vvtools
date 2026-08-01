import { createRequire } from 'module'
import { readFile, writeFile } from 'fs/promises'
import { statSync } from 'fs'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import sharp from 'sharp'
import type { QpdfInstance } from '@neslinesli93/qpdf-wasm'
import type { MediaTask, PdfOptions } from '../../shared/types'
import { MediaProcessError, TaskCancelledError } from './errors'
import { createTaskCommand } from './ffmpeg-runtime'

const require = createRequire(import.meta.url)
const pdfiumLibraryPromise = PDFiumLibrary.init()
let qpdfModulePromise: Promise<QpdfInstance> | null = null
let qpdfQueue: Promise<void> = Promise.resolve()

export interface PdfProbe {
  pageCount: number
  width: number
  height: number
}

export async function probePdf(sourcePath: string, signal: AbortSignal): Promise<PdfProbe> {
  if (signal.aborted) throw new TaskCancelledError()
  const library = await pdfiumLibraryPromise
  const document = await library.loadDocument(await readFile(sourcePath))
  try {
    const pageCount = document.getPageCount()
    if (pageCount < 1) throw new Error('PDF 中没有可处理的页面')
    const size = document.getPage(0).getOriginalSize()
    if (!size.originalWidth || !size.originalHeight) throw new Error('无法读取 PDF 页面尺寸')
    return { pageCount, width: size.originalWidth, height: size.originalHeight }
  } finally {
    document.destroy()
  }
}

export async function processPdf(
  task: MediaTask,
  signal: AbortSignal,
  onProgress: (progress: number) => void = () => undefined
): Promise<number> {
  if (signal.aborted) throw new TaskCancelledError()
  const options = task.options as PdfOptions
  const command = createTaskCommand('pdfium/qpdf-wasm', [
    task.sourcePath,
    options.operation,
    options.operation === 'toImage' ? `${options.imageFormat}@${options.dpi}dpi` : 'lossless',
    task.outputPath
  ])

  try {
    if (options.operation === 'compress') {
      await compressPdf(task.sourcePath, task.outputPath, signal, onProgress)
    } else {
      await renderPdfPage(task, options, signal, onProgress)
    }
    if (signal.aborted) {
      throw new TaskCancelledError()
    }
    const outputSize = statSync(task.outputPath).size
    onProgress(100)
    return outputSize
  } catch (error) {
    if (error instanceof TaskCancelledError || error instanceof MediaProcessError) throw error
    throw new MediaProcessError('PDF 处理失败，请确认文件未损坏或未加密', {
      command,
      stderrTail: error instanceof Error ? error.message : String(error)
    })
  }
}

async function renderPdfPage(
  task: MediaTask,
  options: PdfOptions,
  signal: AbortSignal,
  onProgress: (progress: number) => void
): Promise<void> {
  const pageNumber = task.pageNumber ?? 1
  const library = await pdfiumLibraryPromise
  const document = await library.loadDocument(await readFile(task.sourcePath))
  try {
    if (pageNumber < 1 || pageNumber > document.getPageCount()) {
      throw new Error(`PDF 页面不存在：第 ${pageNumber} 页`)
    }
    if (signal.aborted) throw new TaskCancelledError()
    onProgress(5)
    const page = document.getPage(pageNumber - 1)
    const render = await page.render({
      scale: options.dpi / 72,
      colorSpace: 'BGRA',
      render: async ({ data, width, height }) => {
        if (signal.aborted) throw new TaskCancelledError()
        const rgba = swapBlueRedChannels(data)
        const pipeline = sharp(rgba, { raw: { width, height, channels: 4 } })
        const output =
          options.imageFormat === 'jpeg'
            ? await pipeline
                .flatten({ background: '#ffffff' })
                .jpeg({
                  quality: options.imageQuality,
                  mozjpeg: true
                })
                .toBuffer()
            : options.imageFormat === 'webp'
              ? await pipeline.webp({ quality: options.imageQuality, effort: 4 }).toBuffer()
              : await pipeline.png({ compressionLevel: 9 }).toBuffer()
        onProgress(90)
        return output
      }
    })
    if (signal.aborted) throw new TaskCancelledError()
    await writeFile(task.outputPath, Buffer.from(render.data))
  } finally {
    document.destroy()
  }
}

function swapBlueRedChannels(data: Uint8Array): Buffer {
  const rgba = Buffer.from(data)
  for (let index = 0; index < rgba.length; index += 4) {
    const blue = rgba[index]
    rgba[index] = rgba[index + 2]
    rgba[index + 2] = blue
  }
  return rgba
}

async function compressPdf(
  sourcePath: string,
  outputPath: string,
  signal: AbortSignal,
  onProgress: (progress: number) => void
): Promise<void> {
  await enqueueQpdf(async () => {
    if (signal.aborted) throw new TaskCancelledError()
    const qpdf = await getQpdfModule()
    const inputPath = `/vvtools-input-${Date.now()}.pdf`
    const virtualOutputPath = `/vvtools-output-${Date.now()}.pdf`
    const fileSystem = qpdf.FS as unknown as QpdfFileSystem
    try {
      fileSystem.writeFile(inputPath, new Uint8Array(await readFile(sourcePath)))
      onProgress(15)
      let exitCode: number
      try {
        exitCode = qpdf.callMain([
          '--stream-data=compress',
          '--recompress-flate',
          '--object-streams=generate',
          '--compression-level=9',
          inputPath,
          virtualOutputPath
        ])
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error))
      }
      if (!isQpdfSuccessExitCode(exitCode)) throw new Error(`qpdf 退出码 ${exitCode}`)
      if (signal.aborted) throw new TaskCancelledError()
      const output = fileSystem.readFile(virtualOutputPath)
      if (output.length === 0) throw new Error('qpdf 未生成有效的 PDF 输出')
      await writeFile(outputPath, Buffer.from(output))
      onProgress(95)
    } finally {
      fileSystem.unlink?.(inputPath)
      fileSystem.unlink?.(virtualOutputPath)
    }
  })
}

export function isQpdfSuccessExitCode(exitCode: number): boolean {
  // qpdf uses 3 when processing succeeds after recovering from input warnings.
  return exitCode === 0 || exitCode === 3
}

async function getQpdfModule(): Promise<QpdfInstance> {
  qpdfModulePromise ??= (async () => {
    const module = await import('@neslinesli93/qpdf-wasm')
    const wasmPath = require.resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm')
    return module.default({ locateFile: () => wasmPath })
  })()
  return qpdfModulePromise
}

function enqueueQpdf<T>(operation: () => Promise<T>): Promise<T> {
  const current = qpdfQueue.then(operation, operation)
  qpdfQueue = current.then(
    () => undefined,
    () => undefined
  )
  return current
}

interface QpdfFileSystem {
  writeFile: (path: string, data: Uint8Array) => void
  readFile: (path: string) => Uint8Array
  unlink?: (path: string) => void
}
