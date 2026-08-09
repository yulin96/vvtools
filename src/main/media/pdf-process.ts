import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
import type { MediaTask } from '../../shared/types'
import { TaskCancelledError } from './errors'

const require = createRequire(import.meta.url)
const IDLE_TIMEOUT_MS = 500

export interface PdfProbeResult {
  pageCount: number
  width: number
  height: number
}

interface WorkerModules {
  pdfium: string
  pdfLib: string
  qpdf: string
  qpdfWasm: string
  sharp: string
}

interface QueueItem<T> {
  id: string
  command: 'probe' | 'process'
  payload: unknown
  signal: AbortSignal
  onProgress: (progress: number) => void
  resolve: (value: T) => void
  reject: (error: unknown) => void
  handleAbort: () => void
}

interface WorkerMessage {
  id: string
  type: 'progress' | 'result' | 'error'
  progress?: number
  result?: unknown
  error?: string
}

const modules: WorkerModules = {
  pdfium: require.resolve('@hyzyla/pdfium'),
  pdfLib: require.resolve('pdf-lib'),
  qpdf: require.resolve('@neslinesli93/qpdf-wasm'),
  qpdfWasm: require.resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm'),
  sharp: require.resolve('sharp')
}

const sessions = new Map<string, PdfProcessSession>()

export function probePdfProcess(sourcePath: string, signal: AbortSignal): Promise<PdfProbeResult> {
  return sessionFor(sourcePath).enqueue<PdfProbeResult>('probe', { sourcePath }, signal)
}

export function runPdfProcess(
  task: MediaTask,
  signal: AbortSignal,
  onProgress: (progress: number) => void
): Promise<number> {
  return sessionFor(task.sourcePath).enqueue<number>('process', { task }, signal, onProgress)
}

export function shutdownPdfProcesses(): void {
  for (const session of sessions.values()) session.dispose()
  sessions.clear()
}

function sessionFor(sourcePath: string): PdfProcessSession {
  let session = sessions.get(sourcePath)
  if (session) return session
  session = new PdfProcessSession(() => {
    if (sessions.get(sourcePath) === session) sessions.delete(sourcePath)
  })
  sessions.set(sourcePath, session)
  return session
}

class PdfProcessSession {
  private child: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private queue: QueueItem<unknown>[] = []
  private current: QueueItem<unknown> | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private disposed = false
  private stopping = false

  constructor(private readonly onIdle: () => void) {}

  enqueue<T>(
    command: QueueItem<T>['command'],
    payload: unknown,
    signal: AbortSignal,
    onProgress: (progress: number) => void = () => undefined
  ): Promise<T> {
    if (signal.aborted) return Promise.reject(new TaskCancelledError())
    if (this.disposed) return Promise.reject(new Error('PDF 处理会话已关闭'))
    this.clearIdleTimer()
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        id: randomUUID(),
        command,
        payload,
        signal,
        onProgress,
        resolve,
        reject,
        handleAbort: () => this.abort(item as QueueItem<unknown>)
      }
      signal.addEventListener('abort', item.handleAbort, { once: true })
      this.queue.push(item as QueueItem<unknown>)
      this.pump()
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearIdleTimer()
    const error = new Error('PDF 处理会话已关闭')
    if (this.current) this.settle(this.current, () => this.current?.reject(error))
    for (const item of this.queue.splice(0)) this.settle(item, () => item.reject(error))
    this.child?.kill()
    this.child = null
  }

  private pump(): void {
    if (this.disposed || this.stopping || this.current || !this.queue.length) return
    const item = this.queue.shift()!
    if (item.signal.aborted) {
      this.settle(item, () => item.reject(new TaskCancelledError()))
      this.pump()
      return
    }
    this.current = item
    const child = this.ensureChild()
    child.stdin.write(
      `${JSON.stringify({ id: item.id, command: item.command, payload: item.payload, modules })}\n`
    )
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child
    const child = spawn(process.execPath, ['-e', childSource], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true
    })
    child.unref()
    this.child = child
    this.stdoutBuffer = ''
    child.stdin.on('error', () => undefined)
    child.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk))
    child.stderr.on('data', (chunk: Buffer) => console.error(`PDF 处理进程：${chunk.toString()}`))
    child.once('error', (error) => this.handleChildExit(child, error))
    child.once('close', (code) =>
      this.handleChildExit(child, new Error(`PDF 处理进程异常退出（${code ?? '未知'}）`))
    )
    return child
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString()
    const lines = this.stdoutBuffer.split(/\r?\n/u)
    this.stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      let message: WorkerMessage
      try {
        message = JSON.parse(line) as WorkerMessage
      } catch {
        continue
      }
      const item = this.current
      if (!item || message.id !== item.id) continue
      if (message.type === 'progress' && typeof message.progress === 'number') {
        item.onProgress(message.progress)
      } else if (message.type === 'result') {
        this.current = null
        this.settle(item, () => item.resolve(message.result))
        this.afterItem()
      } else if (message.type === 'error') {
        this.current = null
        this.settle(item, () => item.reject(new Error(message.error || 'PDF 处理失败')))
        this.afterItem()
      }
    }
  }

  private abort(item: QueueItem<unknown>): void {
    if (this.current === item) {
      this.current = null
      this.settle(item, () => item.reject(new TaskCancelledError()))
      this.stopping = true
      this.child?.kill()
      return
    }
    const index = this.queue.indexOf(item)
    if (index < 0) return
    this.queue.splice(index, 1)
    this.settle(item, () => item.reject(new TaskCancelledError()))
    if (!this.current && !this.queue.length) this.scheduleIdle()
  }

  private handleChildExit(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) return
    this.child = null
    this.stopping = false
    if (this.current) {
      const item = this.current
      this.current = null
      this.settle(item, () => item.reject(error))
    }
    if (this.queue.length) this.pump()
    else this.scheduleIdle()
  }

  private afterItem(): void {
    if (this.queue.length) this.pump()
    else this.scheduleIdle()
  }

  private settle(item: QueueItem<unknown>, callback: () => void): void {
    item.signal.removeEventListener('abort', item.handleAbort)
    callback()
  }

  private scheduleIdle(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.child?.stdin.end(`${JSON.stringify({ command: 'shutdown' })}\n`)
      this.child = null
      this.disposed = true
      this.onIdle()
    }, IDLE_TIMEOUT_MS)
    this.idleTimer.unref()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}

const childSource = String.raw`
const { mkdir, readFile, stat, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const readline = require('node:readline')

let loadedModules
let sourcePath = ''
let sourceDocument = null

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

async function loadModules(paths) {
  if (loadedModules) return loadedModules
  const [pdfium, pdfLib, sharpModule] = await Promise.all([
    import(pathToFileURL(paths.pdfium).href),
    import(pathToFileURL(paths.pdfLib).href),
    import(pathToFileURL(paths.sharp).href)
  ])
  loadedModules = {
    PDFiumLibrary: pdfium.PDFiumLibrary,
    PDFDocument: pdfLib.PDFDocument,
    sharp: sharpModule.default,
    paths,
    library: await pdfium.PDFiumLibrary.init(),
    qpdf: null
  }
  return loadedModules
}

async function documentFor(path, paths) {
  const modules = await loadModules(paths)
  if (sourceDocument && sourcePath === path) return sourceDocument
  if (sourceDocument) sourceDocument.destroy()
  sourceDocument = await modules.library.loadDocument(await readFile(path))
  sourcePath = path
  return sourceDocument
}

function swapBlueRedChannels(data) {
  for (let index = 0; index < data.length; index += 4) {
    const blue = data[index]
    data[index] = data[index + 2]
    data[index + 2] = blue
  }
  return data
}

async function probe(path, paths) {
  const document = await documentFor(path, paths)
  const pageCount = document.getPageCount()
  if (pageCount < 1) throw new Error('PDF 中没有可处理的页面')
  const size = document.getPage(0).getOriginalSize()
  if (!size.originalWidth || !size.originalHeight) throw new Error('无法读取 PDF 页面尺寸')
  return { pageCount, width: size.originalWidth, height: size.originalHeight }
}

async function renderPage(task, options, paths, progress) {
  const document = await documentFor(task.sourcePath, paths)
  const pageNumber = task.pageNumber || 1
  if (pageNumber < 1 || pageNumber > document.getPageCount()) {
    throw new Error('PDF 页面不存在：第 ' + pageNumber + ' 页')
  }
  progress(5)
  const modules = await loadModules(paths)
  const page = document.getPage(pageNumber - 1)
  const render = await page.render({
    scale: options.dpi / 72,
    colorSpace: 'BGRA',
    render: async ({ data, width, height }) => {
      const rgba = swapBlueRedChannels(data)
      const pipeline = modules.sharp(rgba, { raw: { width, height, channels: 4 } })
      const output = options.imageFormat === 'jpeg'
        ? await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: options.imageQuality, mozjpeg: true }).toBuffer()
        : options.imageFormat === 'webp'
          ? await pipeline.webp({ quality: options.imageQuality, effort: 4 }).toBuffer()
          : await pipeline.png({ compressionLevel: 9 }).toBuffer()
      progress(90)
      return output
    }
  })
  await writeFile(task.outputPath, render.data)
}

async function renderPages(task, options, paths, progress) {
  const pageNumbers = task.pageNumbers || []
  const outputPaths = task.outputPaths || []
  if (!pageNumbers.length || pageNumbers.length !== outputPaths.length) {
    throw new Error('PDF 页面与输出文件数量不匹配')
  }
  await mkdir(task.outputPath, { recursive: true })
  let outputSize = 0
  for (let index = 0; index < pageNumbers.length; index += 1) {
    await renderPage(
      { ...task, pageNumber: pageNumbers[index], outputPath: outputPaths[index] },
      options,
      paths,
      (value) => progress(Math.min(99, Math.round(((index + value / 100) / pageNumbers.length) * 100)))
    )
    outputSize += (await stat(outputPaths[index])).size
    progress(Math.min(99, Math.round(((index + 1) / pageNumbers.length) * 100)))
  }
  progress(100)
  return outputSize
}

async function getQpdf(paths) {
  const modules = await loadModules(paths)
  if (modules.qpdf) return modules.qpdf
  const qpdfModule = await import(pathToFileURL(paths.qpdf).href)
  modules.qpdf = await qpdfModule.default({
    locateFile: () => paths.qpdfWasm,
    print: () => undefined,
    printErr: () => undefined
  })
  return modules.qpdf
}

async function compressLossless(task, paths, progress) {
  const qpdf = await getQpdf(paths)
  const inputPath = '/vvtools-input-' + task.id + '.pdf'
  const outputPath = '/vvtools-output-' + task.id + '.pdf'
  try {
    qpdf.FS.writeFile(inputPath, new Uint8Array(await readFile(task.sourcePath)))
    progress(15)
    const exitCode = qpdf.callMain([
      '--stream-data=compress', '--recompress-flate', '--object-streams=generate',
      '--compression-level=9', inputPath, outputPath
    ])
    if (exitCode !== 0 && exitCode !== 3) throw new Error('qpdf 退出码 ' + exitCode)
    const output = qpdf.FS.readFile(outputPath)
    if (!output.length) throw new Error('qpdf 未生成有效的 PDF 输出')
    await writeFile(task.outputPath, output)
    progress(95)
  } finally {
    try { qpdf.FS.unlink(inputPath) } catch {}
    try { qpdf.FS.unlink(outputPath) } catch {}
  }
}

async function compressLossy(task, options, paths, progress) {
  const source = await documentFor(task.sourcePath, paths)
  const pageCount = source.getPageCount()
  if (pageCount < 1) throw new Error('PDF 中没有可处理的页面')
  const modules = await loadModules(paths)
  const outputDocument = await modules.PDFDocument.create()
  progress(5)
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const sourcePage = source.getPage(pageIndex)
    const size = sourcePage.getOriginalSize()
    const render = await sourcePage.render({
      scale: options.compressionDpi / 72,
      colorSpace: 'BGRA',
      render: async ({ data, width, height }) => modules.sharp(swapBlueRedChannels(data), {
        raw: { width, height, channels: 4 }
      }).flatten({ background: '#ffffff' }).jpeg({
        quality: options.compressionQuality,
        mozjpeg: true
      }).toBuffer()
    })
    const image = await outputDocument.embedJpg(render.data)
    const outputPage = outputDocument.addPage([size.originalWidth, size.originalHeight])
    outputPage.drawImage(image, {
      x: 0, y: 0, width: size.originalWidth, height: size.originalHeight
    })
    progress(5 + Math.round(((pageIndex + 1) / pageCount) * 85))
  }
  const output = await outputDocument.save({ addDefaultPage: false, useObjectStreams: true })
  if (!output.length) throw new Error('PDF 有损压缩未生成有效输出')
  await writeFile(task.outputPath, output)
  progress(95)
}

async function processTask(task, paths, progress) {
  const options = task.options
  if (options.operation === 'compress') {
    if (options.compressionMode === 'lossy') await compressLossy(task, options, paths, progress)
    else await compressLossless(task, paths, progress)
  } else if (task.outputPaths && task.outputPaths.length) {
    return renderPages(task, options, paths, progress)
  } else {
    await renderPage(task, options, paths, progress)
  }
  const stats = await stat(task.outputPath)
  progress(100)
  return stats.size
}

async function handle(message) {
  if (message.command === 'shutdown') {
    if (sourceDocument) sourceDocument.destroy()
    process.exit(0)
  }
  const progress = (value) => send({ id: message.id, type: 'progress', progress: value })
  try {
    const result = message.command === 'probe'
      ? await probe(message.payload.sourcePath, message.modules)
      : await processTask(message.payload.task, message.modules, progress)
    send({ id: message.id, type: 'result', result })
  } catch (error) {
    send({
      id: message.id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

let chain = Promise.resolve()
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  chain = chain.then(() => handle(JSON.parse(line)), () => handle(JSON.parse(line)))
})
`
