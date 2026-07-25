import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { FailureLogService } from '../src/main/services/failure-log'
import { TaskQueue, type TaskRunner } from '../src/main/services/task-queue'
import { TaskHistoryStore } from '../src/main/services/task-history-store'
import { MediaProcessError, TaskCancelledError } from '../src/main/media/errors'
import { DEFAULT_IMAGE_OPTIONS, DEFAULT_VIDEO_OPTIONS } from '../src/shared/constants'

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

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('TaskQueue', () => {
  it('respects concurrency and continues dispatching', async () => {
    const paths = fixture()
    let running = 0
    let maximum = 0
    const runner: TaskRunner = async () => {
      running += 1
      maximum = Math.max(maximum, running)
      await new Promise((resolve) => setTimeout(resolve, 15))
      running -= 1
      return 12
    }
    const queue = new TaskQueue(2, runner, new FailureLogService(paths.userData))
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

  it('cancels a pending task without running it', async () => {
    const paths = fixture()
    let release!: () => void
    const blocker = new Promise<void>((resolve) => (release = resolve))
    const runner: TaskRunner = async (_task, signal) => {
      await blocker
      if (signal.aborted) throw new TaskCancelledError()
      return 1
    }
    const queue = new TaskQueue(1, runner, new FailureLogService(paths.userData))
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
    const runner: TaskRunner = async () => {
      if (shouldFail) throw new MediaProcessError('broken image', { stderrTail: 'decoder error' })
      return 2
    }
    const queue = new TaskQueue(1, runner, new FailureLogService(paths.userData))
    const [original] = queue.create({
      kind: 'image',
      sources: [{ path: paths.source, relativeDirectory: '' }],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
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

  it('persists task history and restores unfinished tasks as interrupted', async () => {
    const paths = fixture()
    let release!: () => void
    const blocker = new Promise<void>((resolve) => (release = resolve))
    const history = new TaskHistoryStore(paths.userData)
    const queue = new TaskQueue(
      1,
      async () => {
        await blocker
        return 1
      },
      new FailureLogService(paths.userData),
      history,
      30
    )
    const [task] = queue.create({
      kind: 'image',
      sources: [{ path: paths.source, relativeDirectory: '' }],
      outputMode: 'custom',
      outputDirectory: paths.output,
      outputSuffix: '',
      options: { ...DEFAULT_IMAGE_OPTIONS }
    })
    await waitFor(() => queue.list()[0]?.status === 'processing')

    const restored = new TaskQueue(
      1,
      async () => 1,
      new FailureLogService(paths.userData),
      history,
      30
    )
    expect(restored.list()).toEqual([
      expect.objectContaining({
        id: task.id,
        status: 'interrupted',
        progress: null,
        failure: expect.objectContaining({ message: expect.stringContaining('上次退出') })
      })
    ])
    expect(JSON.parse(readFileSync(join(paths.userData, 'tasks.json'), 'utf8')).version).toBe(1)
    release()
  })

  it('retries all failed tasks and clears completed history', async () => {
    const paths = fixture()
    let fail = true
    const queue = new TaskQueue(
      1,
      async () => {
        if (fail) throw new MediaProcessError('broken')
        return 1
      },
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
    await waitFor(() => queue.list()[0]?.status === 'failed')
    fail = false
    expect(queue.retryFailed()).toHaveLength(1)
    await waitFor(() => queue.list().some((task) => task.status === 'completed'))
    expect(queue.clearCompleted()).toBe(1)
    expect(queue.list().some((task) => task.status === 'completed')).toBe(false)
  })

  it('writes video output to the selected output directory', () => {
    const paths = fixture()
    const queue = new TaskQueue(1, async () => 1, new FailureLogService(paths.userData))
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

  it('preserves image directory structure when requested', () => {
    const paths = fixture()
    const queue = new TaskQueue(1, async () => 1, new FailureLogService(paths.userData))
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
    const queue = new TaskQueue(1, async () => 1, new FailureLogService(paths.userData))
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
})
