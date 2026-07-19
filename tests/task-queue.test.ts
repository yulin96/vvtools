import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { FailureLogService } from '../src/main/services/failure-log'
import { TaskQueue, type TaskRunner } from '../src/main/services/task-queue'
import { MediaProcessError, TaskCancelledError } from '../src/main/media/errors'
import { DEFAULT_VIDEO_OPTIONS } from '../src/shared/constants'

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
      sourcePaths: [paths.source, paths.source, paths.source],
      outputDirectory: paths.output,
      options: { format: 'original', quality: 80 }
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
      sourcePaths: [paths.source, paths.source],
      outputDirectory: paths.output,
      options: { format: 'webp', quality: 80 }
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
      sourcePaths: [paths.source],
      outputDirectory: paths.output,
      options: { format: 'png', quality: 70 }
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

  it('writes video output to the selected output directory', () => {
    const paths = fixture()
    const queue = new TaskQueue(1, async () => 1, new FailureLogService(paths.userData))
    const [task] = queue.create({
      kind: 'video',
      sourcePaths: [paths.source],
      outputDirectory: paths.output,
      options: { ...DEFAULT_VIDEO_OPTIONS, format: 'mkv' }
    })
    expect(task.outputPath).toBe(join(paths.output, 'source_compressed.mkv'))
  })
})
