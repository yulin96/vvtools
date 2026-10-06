import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaProcessError, TaskCancelledError } from './errors'
import { runQpdfProcess, shutdownQpdfProcesses } from './qpdf-process'

vi.mock('child_process', () => ({ spawn: vi.fn() }))

let root: string
let child: EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  kill: ReturnType<typeof vi.fn>
}
let task: { sourcePath: string; outputPath: string }

beforeEach(async () => {
  vi.clearAllMocks()
  root = await mkdtemp(join(tmpdir(), 'vvtools-qpdf-'))
  task = { sourcePath: join(root, '源 文件 $(echo).pdf'), outputPath: join(root, '输出 文件.pdf') }
  child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn()
  })
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcessWithoutNullStreams)
})

afterEach(async () => {
  shutdownQpdfProcesses()
  await rm(root, { recursive: true, force: true })
})

describe('native qpdf process', () => {
  it.each([0, 3])('accepts exit %i only after a nonempty output is written', async (code) => {
    await writeFile(task.outputPath, '%PDF-1.4\n')
    const progress = vi.fn()
    const processing = runQpdfProcess('/bundled/qpdf', task, new AbortController().signal, progress)
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      '/bundled/qpdf',
      [
        '--stream-data=compress',
        '--recompress-flate',
        '--object-streams=generate',
        '--compression-level=9',
        task.sourcePath,
        task.outputPath
      ],
      { windowsHide: true }
    )
    child.emit('close', code)
    await expect(processing).resolves.toBe(9)
    expect(progress).toHaveBeenLastCalledWith(100)
  })

  it('preserves native failure diagnostics and does not report completion', async () => {
    const progress = vi.fn()
    const processing = runQpdfProcess('/bundled/qpdf', task, new AbortController().signal, progress)
    child.stderr.write('qpdf: invalid password\n')
    child.emit('close', 2)
    await expect(processing).rejects.toMatchObject({
      name: 'MediaProcessError',
      details: {
        exitCode: 2,
        stderrTail: 'qpdf: invalid password',
        command: { executable: '/bundled/qpdf' }
      }
    })
    expect(progress).not.toHaveBeenCalledWith(100)
  })

  it('rejects a successful exit that produced no output', async () => {
    const processing = runQpdfProcess('/bundled/qpdf', task, new AbortController().signal, vi.fn())
    child.emit('close', 0)
    await expect(processing).rejects.toBeInstanceOf(MediaProcessError)
  })

  it('kills the native process on cancellation and ignores a subsequent close', async () => {
    const controller = new AbortController()
    const progress = vi.fn()
    const processing = runQpdfProcess('/bundled/qpdf', task, controller.signal, progress)
    controller.abort()
    child.emit('close', 0)
    await expect(processing).rejects.toBeInstanceOf(TaskCancelledError)
    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(progress).not.toHaveBeenCalledWith(100)
  })

  it('does not start an already cancelled task', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      runQpdfProcess('/bundled/qpdf', task, controller.signal, vi.fn())
    ).rejects.toBeInstanceOf(TaskCancelledError)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('terminates an active native PDF task when PDF processes are shut down', async () => {
    const processing = runQpdfProcess('/bundled/qpdf', task, new AbortController().signal, vi.fn())
    shutdownQpdfProcesses()
    await expect(processing).rejects.toBeInstanceOf(TaskCancelledError)
    expect(child.kill).toHaveBeenCalledTimes(1)
  })
})
