import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SPRITE_OPTIONS } from '../src/shared/constants'
import type { MediaTask } from '../src/shared/types'
import type { FailureLogService } from '../src/main/services/failure-log'
import { processSprite } from '../src/main/media/sprite-processor'

vi.mock('../src/main/media/ffmpeg-runtime', () => ({ getFfmpegPath: () => '/ffmpeg' }))
vi.mock('../src/main/media/video-processor', () => ({
  probeVideo: vi.fn(async () => ({ duration: 2, videoCodec: 'h264', width: 32, height: 32 }))
}))
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn: vi.fn()
}))

const children: ChildProcessWithoutNullStreams[] = []
const roots: string[] = []
afterEach(async () => {
  for (const child of children.splice(0)) child.kill()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.resetAllMocks()
})

describe('sprite process output streams', () => {
  it('drains large progress output so a child can finish writing its sheet', async () => {
    const { spawn: actualSpawn } =
      await vi.importActual<typeof import('child_process')>('child_process')
    vi.mocked(spawn).mockImplementation((_executable, args, options) => {
      const child = actualSpawn(
        process.execPath,
        [
          '-e',
          `
        const fs = require('node:fs')
        process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 120), () => {
          fs.writeFileSync(process.argv[1], 'sheet')
        })
      `,
          (args as string[]).at(-1)!
        ],
        options
      ) as ChildProcessWithoutNullStreams
      children.push(child)
      return child
    })
    const root = await mkdtemp(join(tmpdir(), 'vvtools-sprite-'))
    roots.push(root)
    const outputPath = join(root, 'output')
    const task: MediaTask = {
      id: 'sprite-test',
      kind: 'sprite',
      sourcePath: '/source.mp4',
      outputPath,
      outputPaths: [join(outputPath, 'sheet.png')],
      status: 'pending',
      progress: 0,
      options: {
        ...DEFAULT_SPRITE_OPTIONS,
        samplingMode: 'count',
        frameCount: 2,
        exportMode: 'single',
        frameWidth: 32
      },
      sourceSize: 1,
      createdAt: new Date(0).toISOString()
    }
    const logs = {
      create: () => ({
        stream: { write: vi.fn(), end: vi.fn() },
        appendTail: vi.fn(),
        getTail: () => '',
        discard: vi.fn()
      })
    } as unknown as FailureLogService
    const controller = new AbortController()
    const settled = processSprite(task, controller.signal, vi.fn(), logs).then(
      (outputSize) => ({ outputSize }),
      (error: unknown) => ({ error })
    )
    try {
      await vi.waitFor(() => expect(children[0]?.stdout.readableFlowing).toBe(true))
      expect(await settled).toEqual({ outputSize: 5 })
      expect(await readFile(task.outputPaths![0], 'utf8')).toBe('sheet')
    } finally {
      controller.abort()
      await settled
    }
  })
})
