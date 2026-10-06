import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { once } from 'events'
import sharp from '../src/main/media/sharp-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SPRITE_OPTIONS } from '../src/shared/constants'
import type { MediaTask } from '../src/shared/types'
import type { FailureLogService } from '../src/main/services/failure-log'
import {
  buildSpriteArgs,
  createSpritePlan,
  processSprite
} from '../src/main/media/sprite-processor'
import { getFfmpegPath } from '../src/main/media/ffmpeg-runtime'
import { probeVideo } from '../src/main/media/video-processor'

vi.mock('../src/main/media/ffmpeg-runtime', () => ({ getFfmpegPath: vi.fn(() => '/ffmpeg') }))
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

describe('single-pass frame sheets', () => {
  it.each([
    {
      format: 'png' as const,
      count: 13,
      start: 0,
      end: 0,
      perSheet: 4,
      samples: [
        [0, 2, 4, 6],
        [8, 10, 12]
      ],
      sizes: [
        [96, 64],
        [96, 32]
      ],
      vfr: true
    },
    {
      format: 'png' as const,
      count: 13,
      start: 0,
      end: 0,
      perSheet: 4,
      samples: [
        [0, 2, 4, 6],
        [8, 10, 12]
      ],
      sizes: [
        [96, 64],
        [96, 32]
      ]
    },
    {
      format: 'png' as const,
      count: 12,
      start: 0,
      end: 1.2,
      perSheet: 3,
      samples: [
        [0, 2, 4],
        [6, 8, 10]
      ],
      sizes: [
        [96, 32],
        [96, 32]
      ]
    },
    {
      format: 'png' as const,
      count: 9,
      start: 0.2,
      end: 1.1,
      perSheet: 4,
      samples: [[2, 4, 6, 8], [10]],
      sizes: [
        [96, 64],
        [32, 32]
      ]
    },
    {
      format: 'jpeg' as const,
      count: 13,
      start: 0,
      end: 0,
      perSheet: 4,
      samples: [
        [0, 2, 4, 6],
        [8, 10, 12]
      ],
      sizes: [
        [96, 64],
        [96, 32]
      ]
    },
    {
      format: 'webp' as const,
      count: 13,
      start: 0,
      end: 0,
      perSheet: 4,
      samples: [
        [0, 2, 4, 6],
        [8, 10, 12]
      ],
      sizes: [
        [96, 64],
        [96, 32]
      ]
    }
  ])(
    'keeps exact frame order, dimensions and $format encoding (start $start)',
    async (scenario) => {
      const { format, count, start, end, perSheet, samples, sizes } = scenario
      const vfr = 'vfr' in scenario && scenario.vfr
      const { spawn: actualSpawn } =
        await vi.importActual<typeof import('child_process')>('child_process')
      const executable = join(
        process.cwd(),
        '.media-bin/current',
        process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
      )
      const root = await mkdtemp(join(tmpdir(), 'vvtools-frame-sheets-'))
      roots.push(root)
      const sourcePath = join(root, 'source.mkv')
      const source = actualSpawn(executable, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'rawvideo',
        '-pixel_format',
        'rgb24',
        '-video_size',
        '32x32',
        '-framerate',
        '10',
        '-i',
        'pipe:0',
        ...(vfr ? ['-vf', 'setpts=N+gte(N\\,6)*6', '-fps_mode', 'vfr'] : []),
        '-c:v',
        'ffv1',
        sourcePath
      ])
      children.push(source)
      source.stdout.resume()
      let stderr = ''
      source.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
      for (let index = 0; index < 13; index += 1) {
        const frame = Buffer.alloc(32 * 32 * 3)
        for (let pixel = 0; pixel < frame.length; pixel += 3) frame[pixel] = index * 16
        source.stdin.write(frame)
      }
      source.stdin.end()
      const [code] = await once(source, 'close')
      expect(code, stderr).toBe(0)
      vi.mocked(spawn).mockImplementation(actualSpawn)
      vi.mocked(getFfmpegPath).mockReturnValue(executable)
      vi.mocked(probeVideo).mockResolvedValue({
        duration: vfr ? 1.9 : 1.3,
        videoCodec: 'ffv1',
        width: 32,
        height: 32
      })
      const outputPath = join(root, 'output')
      const extension = format === 'jpeg' ? 'jpg' : format
      const options = {
        ...DEFAULT_SPRITE_OPTIONS,
        samplingMode: 'frame' as const,
        exportMode: 'batch' as const,
        frameStep: 2,
        framesPerSheet: perSheet,
        columns: 3,
        frameWidth: 32,
        padding: 0,
        margin: 0,
        startTimeSeconds: start,
        endTimeSeconds: end,
        backgroundColor: '#000000',
        imageFormat: format
      }
      const task: MediaTask = {
        id: 'frame-test',
        processingThreads: 2,
        kind: 'sprite',
        sourcePath,
        outputPath,
        outputPaths: samples.map((_, index) =>
          join(outputPath, `chosen name ${index + 1}.${extension}`)
        ),
        sourceFrameCount: count,
        status: 'pending',
        progress: 0,
        options,
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
      const progress = vi.fn()
      expect(
        await processSprite(task, new AbortController().signal, progress, logs)
      ).toBeGreaterThan(0)
      expect(spawn).toHaveBeenCalledOnce()
      expect(progress).toHaveBeenLastCalledWith(100)
      for (let index = 0; index < samples.length; index += 1) {
        const path = task.outputPaths![index]
        expect(await sharp(path).metadata()).toMatchObject({
          width: sizes[index][0],
          height: sizes[index][1],
          format
        })
        const { data, info } = await sharp(path)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
        if (format === 'png') {
          for (let cell = 0; cell < samples[index].length; cell += 1) {
            const pixel = ((Math.floor(cell / 3) * 32 + 16) * info.width + (cell % 3) * 32 + 16) * 3
            expect([...data.subarray(pixel, pixel + 3)]).toEqual([samples[index][cell] * 16, 0, 0])
          }
        } else {
          const reference = join(root, `reference-${index}.${extension}`)
          const args = buildSpriteArgs(
            task,
            options,
            createSpritePlan(options, {
              duration: 1.3,
              videoCodec: 'ffv1',
              width: 32,
              height: 32,
              frameCount: count
            }),
            index,
            reference
          )
          const child = actualSpawn(executable, args)
          children.push(child)
          child.stdout.resume()
          let errors = ''
          child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()))
          const [result] = await once(child, 'close')
          expect(result, errors).toBe(0)
          expect(data).toEqual(await sharp(reference).removeAlpha().raw().toBuffer())
        }
      }
    }
  )
})
