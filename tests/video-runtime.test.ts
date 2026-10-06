import { spawn } from 'child_process'
import { mkdtemp, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIDEO_OPTIONS } from '../src/shared/constants'
import type { MediaTask } from '../src/shared/types'
import { probeAudio } from '../src/main/media/audio-processor'
import { getFfmpegPath } from '../src/main/media/ffmpeg-runtime'
import { probeVideo, processVideo } from '../src/main/media/video-processor'
import { FailureLogService } from '../src/main/services/failure-log'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function createVideoFixture(path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      getFfmpegPath(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-n',
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=160x120:r=10:d=1',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100:duration=1',
        '-threads',
        '1',
        '-c:v',
        'ffv1',
        '-c:a',
        'pcm_s16le',
        '-shortest',
        path
      ],
      { windowsHide: true }
    )
    child.stdout.resume()
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`视频样例创建失败（${code}）：${stderr}`))
    })
  })
}

describe('bundled video runtime', () => {
  it.each([
    { codec: 'h264' as const, expectedCodec: 'h264' },
    { codec: 'h265' as const, expectedCodec: 'hevc' }
  ])(
    'converts $codec with resizing, frame-rate conversion and AAC audio',
    async (scenario) => {
      const root = await mkdtemp(join(tmpdir(), 'vvtools-video-runtime-'))
      roots.push(root)
      const sourcePath = join(root, '源 文件.mkv')
      const outputPath = join(root, '输出 文件.mp4')
      await createVideoFixture(sourcePath)
      const task: MediaTask = {
        id: scenario.codec,
        kind: 'video',
        sourcePath,
        outputPath,
        status: 'processing',
        progress: 0,
        processingThreads: 2,
        options: {
          ...DEFAULT_VIDEO_OPTIONS,
          encoderMode: 'software',
          codec: scenario.codec,
          resolution: 'custom',
          customResolutionHeight: 60,
          frameRate: 'custom',
          customFrameRate: 5
        },
        sourceSize: (await stat(sourcePath)).size,
        createdAt: new Date(0).toISOString()
      }
      const signal = new AbortController().signal
      const progress = vi.fn()

      const size = await processVideo(task, signal, progress, new FailureLogService(root))

      expect(size).toBeGreaterThan(0)
      expect(size).toBe((await stat(outputPath)).size)
      expect(progress).toHaveBeenLastCalledWith(100)
      await expect(probeVideo(outputPath, signal, { start: 0, end: 0.8 })).resolves.toMatchObject({
        videoCodec: scenario.expectedCodec,
        width: 80,
        height: 60,
        frameCount: 4
      })
      await expect(probeAudio(outputPath, signal)).resolves.toMatchObject({
        audioCodec: 'aac',
        channels: 1,
        sampleRate: 44100
      })
    },
    30_000
  )
})
