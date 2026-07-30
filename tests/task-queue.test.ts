import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { FailureLogService } from '../src/main/services/failure-log'
import { TaskQueue, type TaskRunner } from '../src/main/services/task-queue'
import { MediaProcessError, TaskCancelledError } from '../src/main/media/errors'
import { DEFAULT_IMAGE_OPTIONS, DEFAULT_VIDEO_OPTIONS } from '../src/shared/constants'
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
  return { image: value, video: value, audio: value }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('TaskQueue', () => {
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
    const running = { image: 0, video: 0, audio: 0 }
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
      { image: 2, video: 1, audio: 1 },
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
      outputSuffix: '',
      outputConflictPolicy: 'overwrite',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })

    expect(task.outputPath).toBe(paths.source)
    await waitFor(() => queue.list()[0]?.status === 'completed')
    expect(readFileSync(paths.source, 'utf8')).toBe('processed')
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
