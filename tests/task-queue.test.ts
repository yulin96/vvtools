import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FailureLogService } from '../src/main/services/failure-log'
import { TaskQueue, type TaskRunner } from '../src/main/services/task-queue'
import { MediaProcessError, TaskCancelledError, TaskSkippedError } from '../src/main/media/errors'
import {
  DEFAULT_FONT_OPTIONS,
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_VIDEO_OPTIONS
} from '../src/shared/constants'
import type { TaskConcurrencyLimits } from '../src/shared/types'

const directories: string[] = []

function fixture(): { source: string; output: string; userData: string } {
  const root = mkdtempSync(join(tmpdir(), 'vvtools-queue-'))
  directories.push(root)
  const source = join(root, 'source.jpg')
  const output = join(root, 'output')
  const userData = join(root, 'user-data')
  writeFileSync(source, 'fixture')
  return { source, output, userData }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for queue state')
}

const successfulRunner: TaskRunner = async (task) => {
  writeFileSync(task.outputPath, 'processed')
  return 9
}

function concurrency(value: number): TaskConcurrencyLimits {
  return { image: value, video: value, audio: value, pdf: value, font: value }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('TaskQueue', () => {
  it('returns the latest state after immediately dispatching a task', async () => {
    const paths = fixture()
    let release!: () => void
    const blocker = new Promise<void>((resolve) => (release = resolve))
    const runner: TaskRunner = async (task, _signal, onProgress) => {
      onProgress(10)
      await blocker
      writeFileSync(task.outputPath, 'processed')
      return 9
    }
    const queue = new TaskQueue(concurrency(1), runner, new FailureLogService(paths.userData))

    const [created] = queue.create({
      kind: 'font',
      sources: [{ path: paths.source, outputFormat: 'woff2' }],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      options: { ...DEFAULT_FONT_OPTIONS, operation: 'convert' }
    })

    expect(created).toMatchObject({ status: 'processing', progress: 10 })
    release()
    await waitFor(() => queue.list()[0]?.status === 'completed')
  })

  it('emits throttled task progress separately from full task snapshots', async () => {
    const paths = fixture()
    let release!: () => void
    const blocker = new Promise<void>((resolve) => (release = resolve))
    const runner: TaskRunner = async (task, _signal, onProgress) => {
      onProgress(10.4)
      onProgress(11.2)
      onProgress(11.8)
      await blocker
      writeFileSync(task.outputPath, 'processed')
      return 9
    }
    const queue = new TaskQueue(concurrency(1), runner, new FailureLogService(paths.userData))
    const snapshots: unknown[] = []
    const progress: unknown[] = []
    queue.on('changed', (tasks) => snapshots.push(tasks))
    queue.on('progress', (update) => progress.push(update))

    const [task] = queue.create({
      kind: 'image',
      sources: [{ path: paths.source, relativeDirectory: '' }],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })

    expect(progress).toEqual([{ id: task.id, progress: 10 }])
    expect(snapshots).toHaveLength(2)
    release()
    await waitFor(() => queue.list()[0]?.status === 'completed')
    expect(snapshots).toHaveLength(3)
  })

  it('respects concurrency and continues dispatching', async () => {
    const paths = fixture()
    let running = 0
    let maximum = 0
    const runner: TaskRunner = async (task) => {
      running += 1
      maximum = Math.max(maximum, running)
      await new Promise((resolve) => setTimeout(resolve, 15))
      running -= 1
      writeFileSync(task.outputPath, 'processed')
      return 12
    }
    const queue = new TaskQueue(concurrency(2), runner, new FailureLogService(paths.userData))
    queue.create({
      kind: 'image',
      sources: [paths.source, paths.source, paths.source].map((path) => ({
        path,
        relativeDirectory: ''
      })),
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })
    await waitFor(() => queue.list().every((task) => task.status === 'completed'))
    expect(maximum).toBe(2)
  })

  it('applies separate concurrency limits to each media type', async () => {
    const paths = fixture()
    const running = { image: 0, video: 0, audio: 0, pdf: 0, font: 0 }
    const maximum = { ...running }
    const runner: TaskRunner = async (task) => {
      running[task.kind] += 1
      maximum[task.kind] = Math.max(maximum[task.kind], running[task.kind])
      await new Promise((resolve) => setTimeout(resolve, 15))
      running[task.kind] -= 1
      writeFileSync(task.outputPath, 'processed')
      return 12
    }
    const queue = new TaskQueue(
      { image: 2, video: 1, audio: 1, pdf: 1, font: 1 },
      runner,
      new FailureLogService(paths.userData)
    )
    queue.create({
      kind: 'image',
      sources: [paths.source, paths.source, paths.source].map((path) => ({
        path,
        relativeDirectory: ''
      })),
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })
    queue.create({
      kind: 'video',
      sourcePaths: [paths.source, paths.source],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      options: { ...DEFAULT_VIDEO_OPTIONS }
    })

    await waitFor(() => queue.list().every((task) => task.status === 'completed'))
    expect(maximum).toMatchObject({ image: 2, video: 1 })
  })

  it('cancels a pending task without running it', async () => {
    const paths = fixture()
    let release!: () => void
    const blocker = new Promise<void>((resolve) => (release = resolve))
    const runner: TaskRunner = async (task, signal) => {
      await blocker
      if (signal.aborted) throw new TaskCancelledError()
      writeFileSync(task.outputPath, 'processed')
      return 1
    }
    const queue = new TaskQueue(concurrency(1), runner, new FailureLogService(paths.userData))
    const tasks = queue.create({
      kind: 'image',
      sources: [paths.source, paths.source].map((path) => ({ path, relativeDirectory: '' })),
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      options: { ...DEFAULT_IMAGE_OPTIONS, format: 'webp' }
    })
    expect(queue.cancel(tasks[1].id)).toBe(true)
    release()
    await waitFor(() =>
      queue.list().every((task) => ['completed', 'cancelled'].includes(task.status))
    )
    expect(queue.list().find((task) => task.id === tasks[1].id)?.status).toBe('cancelled')
  })

  it('records failures and retries with a new task', async () => {
    const paths = fixture()
    let shouldFail = true
    const runner: TaskRunner = async (task) => {
      if (shouldFail) throw new MediaProcessError('broken image', { stderrTail: 'decoder error' })
      writeFileSync(task.outputPath, 'processed')
      return 2
    }
    const queue = new TaskQueue(concurrency(1), runner, new FailureLogService(paths.userData))
    const [original] = queue.create({
      kind: 'image',
      sources: [{ path: paths.source, relativeDirectory: '' }],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      outputConflictPolicy: 'skip',
      options: { ...DEFAULT_IMAGE_OPTIONS, format: 'png', quality: 70 }
    })
    await waitFor(() => queue.list()[0].status === 'failed')
    expect(queue.list()[0].failure?.logPath).toBeTruthy()
    shouldFail = false
    const retry = queue.retry(original.id)
    expect(retry?.retryOf).toBe(original.id)
    await waitFor(() =>
      queue.list().some((task) => task.id === retry?.id && task.status === 'completed')
    )
  })

  it('retries one failed task without deleting other settled tasks', async () => {
    const paths = fixture()
    const secondSource = join(dirname(paths.source), 'second.jpg')
    writeFileSync(secondSource, 'fixture')
    let shouldFail = true
    const runner: TaskRunner = async (task) => {
      if (shouldFail) throw new Error('failed')
      writeFileSync(task.outputPath, 'processed')
      return 2
    }
    const queue = new TaskQueue(concurrency(2), runner, new FailureLogService(paths.userData))
    const originals = queue.create({
      kind: 'image',
      sources: [paths.source, secondSource].map((path) => ({ path, relativeDirectory: '' })),
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '_processed',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })
    await waitFor(() => queue.list().every((task) => task.status === 'failed'))

    shouldFail = false
    const retry = queue.retry(originals[0].id)

    expect(retry?.retryOf).toBe(originals[0].id)
    expect(queue.list().map((task) => task.id)).toEqual(
      expect.arrayContaining([originals[0].id, originals[1].id, retry!.id])
    )
    await waitFor(() => queue.list().find((task) => task.id === retry?.id)?.status === 'completed')
    expect(queue.list().find((task) => task.id === originals[1].id)?.status).toBe('failed')
  })

  it('does not commit partial task state when batch creation fails', () => {
    const paths = fixture()
    const missingSource = join(dirname(paths.source), 'missing.jpg')
    const queue = new TaskQueue(
      concurrency(1),
      successfulRunner,
      new FailureLogService(paths.userData)
    )
    const request = {
      kind: 'image' as const,
      sources: [paths.source, missingSource].map((path) => ({ path, relativeDirectory: '' })),
      outputMode: 'custom' as const,
      outputDirectory: paths.output,
      outputSuffix: '_processed',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    }

    expect(() => queue.create(request)).toThrow()
    expect(queue.list()).toEqual([])

    const [task] = queue.create({ ...request, sources: [request.sources[0]] })
    expect(task.outputPath).toBe(join(paths.output, 'source_processed.jpg'))
  })

  it('marks larger image output as skipped without committing the staged file', async () => {
    const paths = fixture()
    const runner: TaskRunner = async (task) => {
      writeFileSync(task.outputPath, 'larger temporary output')
      throw new TaskSkippedError('转换后文件更大，已跳过且未保存', 23)
    }
    const queue = new TaskQueue(concurrency(1), runner, new FailureLogService(paths.userData))
    queue.create({
      kind: 'image',
      sources: [{ path: paths.source, relativeDirectory: '' }],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '_processed',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })

    await waitFor(() => queue.list()[0]?.status === 'skipped')
    expect(queue.list()[0]).toMatchObject({
      progress: 100,
      outputSize: 23,
      skippedReason: '转换后文件更大，已跳过且未保存'
    })
    expect(existsSync(queue.list()[0].outputPath)).toBe(false)
    expect(existsSync(paths.source)).toBe(true)
  })

  it('keeps task state in memory without writing task history', async () => {
    const paths = fixture()
    const queue = new TaskQueue(
      concurrency(1),
      successfulRunner,
      new FailureLogService(paths.userData)
    )
    queue.create({
      kind: 'image',
      sources: [{ path: paths.source, relativeDirectory: '' }],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })
    await waitFor(() => queue.list()[0]?.status === 'completed')

    expect(existsSync(join(paths.userData, 'tasks.json'))).toBe(false)
    expect(
      new TaskQueue(concurrency(1), async () => 1, new FailureLogService(paths.userData)).list()
    ).toEqual([])
  })

  it('reuses an available output name after a settled batch', async () => {
    const paths = fixture()
    const queue = new TaskQueue(
      concurrency(1),
      successfulRunner,
      new FailureLogService(paths.userData)
    )
    const request = {
      kind: 'image' as const,
      sources: [{ path: paths.source, relativeDirectory: '' }],
      outputMode: 'custom' as const,
      outputDirectory: paths.output,
      outputSuffix: '',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    }

    const [first] = queue.create(request)
    await waitFor(() => queue.list()[0]?.status === 'completed')
    rmSync(first.outputPath)
    const [second] = queue.create(request)

    expect(second.outputPath).toBe(first.outputPath)
    expect(queue.list()).toEqual([expect.objectContaining({ id: second.id })])
  })

  it('replaces a source file only after processing succeeds', async () => {
    const paths = fixture()
    const trashedSource = join(dirname(paths.source), 'trashed-source.jpg')
    const moveToTrash = vi.fn(async (path: string) => renameSync(path, trashedSource))
    const queue = new TaskQueue(
      concurrency(1),
      successfulRunner,
      new FailureLogService(paths.userData),
      moveToTrash
    )
    const [task] = queue.create({
      kind: 'image',
      sources: [{ path: paths.source, relativeDirectory: '' }],
      outputMode: 'source',
      outputDirectory: paths.output,
      outputSuffix: '',
      outputConflictPolicy: 'overwrite',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })

    expect(task.outputPath).toBe(paths.source)
    await waitFor(() => queue.list()[0]?.status === 'completed')
    expect(moveToTrash).toHaveBeenCalledWith(paths.source)
    expect(readFileSync(trashedSource, 'utf8')).toBe('fixture')
    expect(readFileSync(paths.source, 'utf8')).toBe('processed')
    expect(readdirSync(dirname(paths.source)).some((name) => name.includes('.vvtools-'))).toBe(
      false
    )
  })

  it('preserves an existing output when moving it to the trash fails', async () => {
    const paths = fixture()
    const queue = new TaskQueue(
      concurrency(1),
      successfulRunner,
      new FailureLogService(paths.userData),
      async () => {
        throw new Error('trash unavailable')
      }
    )
    queue.create({
      kind: 'image',
      sources: [{ path: paths.source, relativeDirectory: '' }],
      outputMode: 'source',
      outputDirectory: paths.output,
      outputSuffix: '',
      outputConflictPolicy: 'overwrite',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })

    await waitFor(() => queue.list()[0]?.status === 'failed')
    expect(readFileSync(paths.source, 'utf8')).toBe('fixture')
    expect(queue.list()[0]?.failure?.message).toContain('无法将已有输出移入回收站')
    expect(readdirSync(dirname(paths.source)).some((name) => name.includes('.vvtools-'))).toBe(
      false
    )
  })

  it('preserves the source and removes temporary output when processing fails', async () => {
    const paths = fixture()
    const queue = new TaskQueue(
      concurrency(1),
      async (task) => {
        writeFileSync(task.outputPath, 'partial output')
        throw new MediaProcessError('disk full')
      },
      new FailureLogService(paths.userData)
    )
    queue.create({
      kind: 'image',
      sources: [{ path: paths.source, relativeDirectory: '' }],
      outputMode: 'source',
      outputDirectory: paths.output,
      outputSuffix: '',
      outputConflictPolicy: 'overwrite',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })

    await waitFor(() => queue.list()[0]?.status === 'failed')
    expect(readFileSync(paths.source, 'utf8')).toBe('fixture')
    expect(readdirSync(dirname(paths.source)).some((name) => name.includes('.vvtools-'))).toBe(
      false
    )
  })

  it('preserves the source and removes temporary output when processing is cancelled', async () => {
    const paths = fixture()
    const queue = new TaskQueue(
      concurrency(1),
      async (task, signal) => {
        writeFileSync(task.outputPath, 'partial output')
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        )
        throw new TaskCancelledError()
      },
      new FailureLogService(paths.userData)
    )
    const [task] = queue.create({
      kind: 'image',
      sources: [{ path: paths.source, relativeDirectory: '' }],
      outputMode: 'source',
      outputDirectory: paths.output,
      outputSuffix: '',
      outputConflictPolicy: 'overwrite',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })

    await waitFor(() => queue.list()[0]?.status === 'processing')
    expect(queue.cancel(task.id)).toBe(true)
    await waitFor(() => queue.list()[0]?.status === 'cancelled')
    expect(readFileSync(paths.source, 'utf8')).toBe('fixture')
    expect(readdirSync(dirname(paths.source)).some((name) => name.includes('.vvtools-'))).toBe(
      false
    )
  })

  it('numbers duplicate outputs within an overwrite batch', () => {
    const paths = fixture()
    const queue = new TaskQueue(
      concurrency(1),
      successfulRunner,
      new FailureLogService(paths.userData)
    )
    const tasks = queue.create({
      kind: 'image',
      sources: [paths.source, paths.source].map((path) => ({ path, relativeDirectory: '' })),
      outputMode: 'source',
      outputDirectory: paths.output,
      outputSuffix: '',
      outputConflictPolicy: 'overwrite',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })

    expect(tasks.map((task) => task.outputPath)).toEqual([
      paths.source,
      join(dirname(paths.source), 'source_1.jpg')
    ])
  })

  it('writes video output to the selected output directory', () => {
    const paths = fixture()
    const queue = new TaskQueue(
      concurrency(1),
      successfulRunner,
      new FailureLogService(paths.userData)
    )
    const [task] = queue.create({
      kind: 'video',
      sourcePaths: [paths.source],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      options: { ...DEFAULT_VIDEO_OPTIONS, format: 'mkv' }
    })
    expect(task.outputPath).toBe(join(paths.output, 'source.mkv'))
  })

  it('uses the selected audio output format', () => {
    const paths = fixture()
    const queue = new TaskQueue(
      concurrency(1),
      successfulRunner,
      new FailureLogService(paths.userData)
    )
    const [task] = queue.create({
      kind: 'audio',
      sourcePaths: [paths.source],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      options: {
        format: 'flac',
        bitrateKbps: 192,
        channels: 'source',
        normalizeLoudness: false
      }
    })
    expect(task.outputPath).toBe(join(paths.output, 'source.flac'))
  })

  it('keeps one PDF image conversion as one task and commits its page folder', async () => {
    const paths = fixture()
    const source = join(dirname(paths.source), 'document.pdf')
    writeFileSync(source, '%PDF fixture')
    const pdfRunner: TaskRunner = async (task) => {
      mkdirSync(task.outputPath, { recursive: true })
      for (const outputPath of task.outputPaths ?? []) writeFileSync(outputPath, 'processed')
      return (task.outputPaths?.length ?? 0) * 9
    }
    const queue = new TaskQueue(concurrency(1), pdfRunner, new FailureLogService(paths.userData))
    const tasks = queue.create({
      kind: 'pdf',
      sourcePaths: [source],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      outputNameTemplate: '{name}-page-{page}',
      pageNumbers: [1, 2, 3],
      options: { operation: 'toImage', imageFormat: 'png', dpi: 144, imageQuality: 90 }
    })

    expect(tasks).toHaveLength(1)
    expect(tasks[0].pageNumbers).toEqual([1, 2, 3])
    expect(tasks[0].outputPath).toBe(join(paths.output, 'document'))
    expect(tasks[0].outputPaths).toEqual([
      join(paths.output, 'document', 'document-page-001.png'),
      join(paths.output, 'document', 'document-page-002.png'),
      join(paths.output, 'document', 'document-page-003.png')
    ])

    await waitFor(() => queue.list()[0]?.status === 'completed')
    expect(readdirSync(join(paths.output, 'document'))).toEqual([
      'document-page-001.png',
      'document-page-002.png',
      'document-page-003.png'
    ])
  })

  it('moves an existing PDF image folder to the trash before replacing it', async () => {
    const paths = fixture()
    const source = join(dirname(paths.source), 'document.pdf')
    const existingOutput = join(paths.output, 'document')
    const trashedOutput = join(paths.output, 'trashed-document')
    writeFileSync(source, '%PDF fixture')
    mkdirSync(existingOutput, { recursive: true })
    writeFileSync(join(existingOutput, 'old-page.png'), 'old')
    const pdfRunner: TaskRunner = async (task) => {
      mkdirSync(task.outputPath, { recursive: true })
      for (const outputPath of task.outputPaths ?? []) writeFileSync(outputPath, 'new')
      return 3
    }
    const moveToTrash = vi.fn(async (path: string) => renameSync(path, trashedOutput))
    const queue = new TaskQueue(
      concurrency(1),
      pdfRunner,
      new FailureLogService(paths.userData),
      moveToTrash
    )
    queue.create({
      kind: 'pdf',
      sourcePaths: [source],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      outputNameTemplate: '{name}-page-{page}',
      outputConflictPolicy: 'overwrite',
      pageNumbers: [1],
      options: { operation: 'toImage', imageFormat: 'png', dpi: 144, imageQuality: 90 }
    })

    await waitFor(() => queue.list()[0]?.status === 'completed')
    expect(moveToTrash).toHaveBeenCalledWith(existingOutput)
    expect(readFileSync(join(trashedOutput, 'old-page.png'), 'utf8')).toBe('old')
    expect(readFileSync(join(existingOutput, 'document-page-001.png'), 'utf8')).toBe('new')
  })

  it('expands selected font collection entries into independent tasks', () => {
    const paths = fixture()
    const source = join(dirname(paths.source), 'collection.ttc')
    writeFileSync(source, 'font collection fixture')
    const queue = new TaskQueue(
      concurrency(1),
      successfulRunner,
      new FailureLogService(paths.userData)
    )
    const tasks = queue.create({
      kind: 'font',
      sources: [{ path: source, outputFormat: 'woff2' }],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      outputNameTemplate: '{name}-font-{index}',
      fontIndexes: [0, 2],
      options: {
        operation: 'splitCollection',
        outputFormat: 'woff2',
        variableInstanceMode: 'named'
      }
    })

    expect(tasks.map((task) => task.fontIndex)).toEqual([0, 2])
    expect(tasks.map((task) => task.outputPath)).toEqual([
      join(paths.output, 'collection-font-1.woff2'),
      join(paths.output, 'collection-font-3.woff2')
    ])
  })

  it('creates independent font tasks for per-file output formats', () => {
    const paths = fixture()
    const source = join(dirname(paths.source), 'font.ttf')
    writeFileSync(source, 'font fixture')
    const queue = new TaskQueue(
      concurrency(1),
      successfulRunner,
      new FailureLogService(paths.userData)
    )
    const tasks = queue.create({
      kind: 'font',
      sources: [
        { path: source, outputFormat: 'woff' },
        { path: source, outputFormat: 'woff2' }
      ],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      options: {
        operation: 'convert',
        outputFormat: 'woff2',
        variableInstanceMode: 'named'
      }
    })

    expect(tasks.map((task) => task.outputPath)).toEqual([
      join(paths.output, 'font.woff'),
      join(paths.output, 'font.woff2')
    ])
    expect(tasks.map((task) => (task.options as { outputFormat: string }).outputFormat)).toEqual([
      'woff',
      'woff2'
    ])
  })

  it('preserves image directory structure when requested', () => {
    const paths = fixture()
    const queue = new TaskQueue(
      concurrency(1),
      successfulRunner,
      new FailureLogService(paths.userData)
    )
    const [task] = queue.create({
      kind: 'image',
      sources: [{ path: paths.source, relativeDirectory: join('album', 'day-1') }],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      options: { ...DEFAULT_IMAGE_OPTIONS, preserveStructure: true }
    })
    expect(task.outputPath).toBe(join(paths.output, 'album', 'day-1', 'source.jpg'))
    expect(task.relativeDirectory).toBe(join('album', 'day-1'))
  })

  it('writes output beside the source and applies a shared suffix', () => {
    const paths = fixture()
    const queue = new TaskQueue(
      concurrency(1),
      successfulRunner,
      new FailureLogService(paths.userData)
    )
    const [task] = queue.create({
      kind: 'image',
      sources: [{ path: paths.source, relativeDirectory: '' }],
      outputMode: 'source',
      outputDirectory: paths.output,
      outputSuffix: '_optimized',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })
    expect(task.outputPath).toBe(join(paths.source, '..', 'source_optimized.jpg'))
  })

  it('skips task creation when the configured output already exists', () => {
    const paths = fixture()
    mkdirSync(paths.output)
    writeFileSync(join(paths.output, 'source.jpg'), 'existing')
    const queue = new TaskQueue(
      concurrency(1),
      successfulRunner,
      new FailureLogService(paths.userData)
    )
    const tasks = queue.create({
      kind: 'image',
      sources: [{ path: paths.source, relativeDirectory: '' }],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      outputConflictPolicy: 'skip',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })
    expect(tasks).toEqual([])
    expect(queue.list()).toEqual([])
  })
})
