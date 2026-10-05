import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeVideo } from './video-processor'
import { getFfprobePath } from './ffmpeg-runtime'
import { MediaProcessError, TaskCancelledError } from './errors'

vi.mock('child_process', () => ({ spawn: vi.fn() }))
vi.mock('./ffmpeg-runtime', () => ({
  getFfprobePath: vi.fn(() => '/ffprobe'),
  getFfmpegPath: () => '/ffmpeg',
  resolveHardwareVideoEncoder: vi.fn(),
  createTaskCommand: (executable: string, args: string[]) => ({
    executable,
    args,
    display: args.join(' ')
  })
}))

class ProbeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  closed = false
  kill = vi.fn(() => {
    if (!this.closed) this.finish('', null)
    return true
  })

  finish(output: string, code: number | null = 0): void {
    if (this.closed) return
    this.closed = true
    this.stdout.once('end', () => queueMicrotask(() => this.emit('close', code)))
    this.stdout.end(output)
    this.stderr.end()
  }
}

const metadata = JSON.stringify({
  format: { duration: '6', format_name: 'mov,mp4' },
  streams: [{ codec_type: 'video', codec_name: 'h264', width: 160, height: 90 }]
})
let children: ProbeChild[] = []

beforeEach(() => {
  children = []
  vi.mocked(getFfprobePath).mockReturnValue('/ffprobe')
  vi.mocked(spawn).mockImplementation(() => {
    const child = new ProbeChild()
    children.push(child)
    if (children.length === 1) queueMicrotask(() => child.finish(metadata))
    return child as unknown as ChildProcessWithoutNullStreams
  })
})
afterEach(() => vi.clearAllMocks())

describe('video frame probing', () => {
  it('keeps metadata-only probes fast and preserves metadata values', async () => {
    await expect(probeVideo('/video.mp4', new AbortController().signal)).resolves.toEqual({
      duration: 6,
      videoCodec: 'h264',
      width: 160,
      height: 90,
      format: 'mov'
    })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(spawn).mock.calls[0][1]).not.toContain('frame=best_effort_timestamp_time')
  })

  it('counts streamed timestamps across chunk boundaries and stops after the last reordered frame before end', async () => {
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const probing = probeVideo('/video.mp4', controller.signal, { start: 1.1, end: 1.6 })
    await vi.waitFor(() => expect(children).toHaveLength(2))
    const child = children[1]
    child.stdout.write(
      'frame|best_effort_timestamp_time=1.099998\nframe|best_effort_timestamp_time=1.100000\nframe|best_effort_timestamp_time=1.533333\nframe|best_effort_timestamp_time=1.56'
    )
    child.stdout.write(
      '6667\nframe|best_effort_timestamp_time=1.600000\nframe|best_effort_timestamp_time=5.000000\n'
    )

    await expect(probing).resolves.toMatchObject({ frameCount: 3, duration: 6 })
    expect(child.kill).toHaveBeenCalledOnce()
    const args = vi.mocked(spawn).mock.calls[1][1] as string[]
    expect(args[args.indexOf('-read_intervals') + 1]).toBe('1.1%')
    expect(args[args.indexOf('-of') + 1]).toBe('compact')
    expect(removeListener).toHaveBeenCalledTimes(2)
  })

  it('uses the video duration when end is omitted and excludes timestamps at end', async () => {
    const probing = probeVideo('/video.mp4', new AbortController().signal, { start: 5 })
    await vi.waitFor(() => expect(children).toHaveLength(2))
    children[1].stdout.write(
      'frame|best_effort_timestamp_time=N/A\nframe|best_effort_timestamp_time=4.900000\nframe|best_effort_timestamp_time=5.000000\nframe|best_effort_timestamp_time=5.966667\nframe|best_effort_timestamp_time=6.000000\n'
    )
    await expect(probing).resolves.toMatchObject({ frameCount: 2 })
    expect(children[1].kill).toHaveBeenCalledOnce()
  })

  it('accepts a successful EOF when the requested end exceeds the video duration', async () => {
    const probing = probeVideo('/video.mp4', new AbortController().signal, { start: 5, end: 10 })
    await vi.waitFor(() => expect(children).toHaveLength(2))
    children[1].finish(
      'frame|best_effort_timestamp_time=5.000000\nframe|best_effort_timestamp_time=5.966667'
    )
    await expect(probing).resolves.toMatchObject({ frameCount: 2 })
    expect(children[1].kill).not.toHaveBeenCalled()
  })

  it('keeps explicit cancellation distinct from stopping at the time boundary', async () => {
    const controller = new AbortController()
    const probing = probeVideo('/video.mp4', controller.signal, { start: 1, end: 2 })
    const rejection = expect(probing).rejects.toBeInstanceOf(TaskCancelledError)
    await vi.waitFor(() => expect(children).toHaveLength(2))
    controller.abort()
    await rejection
    expect(children[1].kill).toHaveBeenCalledOnce()
  })

  it('does not start a subprocess when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      probeVideo('/video.mp4', controller.signal, { start: 1, end: 2 })
    ).rejects.toBeInstanceOf(TaskCancelledError)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('retains probe errors when exit was not caused by reaching the requested end', async () => {
    const probing = probeVideo('/video.mp4', new AbortController().signal, { start: 1, end: 2 })
    const rejection = expect(probing).rejects.toMatchObject({
      details: { exitCode: 1, stderrTail: 'decoder error' }
    })
    await vi.waitFor(() => expect(children).toHaveLength(2))
    children[1].stderr.write('decoder error')
    children[1].finish('frame|best_effort_timestamp_time=1.200000\n', 1)
    await rejection
  })

  it('rejects an interval containing no readable frames', async () => {
    const probing = probeVideo('/video.mp4', new AbortController().signal, { start: 1, end: 2 })
    const rejection = expect(probing).rejects.toBeInstanceOf(MediaProcessError)
    await vi.waitFor(() => expect(children).toHaveLength(2))
    children[1].finish('frame|best_effort_timestamp_time=N/A\n')
    await rejection
  })

  it('preserves exact frame counts in a real H.264 video with B frames and narrow intervals', async () => {
    const actual = await vi.importActual<typeof import('child_process')>('child_process')
    vi.mocked(spawn).mockImplementation(actual.spawn)
    const binaryDirectory = join(process.cwd(), '.media-bin/current')
    const extension = process.platform === 'win32' ? '.exe' : ''
    vi.mocked(getFfprobePath).mockReturnValue(join(binaryDirectory, `ffprobe${extension}`))
    const root = await mkdtemp(join(tmpdir(), 'vvtools-real-probe-'))
    try {
      const source = join(root, 'bframes.mp4')
      await new Promise<void>((resolve, reject) => {
        const child = actual.spawn(
          join(binaryDirectory, `ffmpeg${extension}`),
          [
            '-v',
            'error',
            '-f',
            'lavfi',
            '-i',
            'testsrc2=size=160x90:rate=30:duration=6',
            '-c:v',
            'libx264',
            '-g',
            '90',
            '-bf',
            '3',
            source
          ],
          { windowsHide: true }
        )
        let stderr = ''
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
        child.once('error', reject)
        child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr))))
      })
      const counts: number[] = []
      for (const [start, end] of [
        [0, 0.5],
        [1.1, 1.6],
        [2.95, 3.05],
        [4.8, 5.13]
      ]) {
        const probe = await probeVideo(source, new AbortController().signal, { start, end })
        counts.push(probe.frameCount!)
        expect(probe).toMatchObject({ duration: 6, videoCodec: 'h264', width: 160, height: 90 })
      }
      expect(counts).toEqual([15, 15, 3, 10])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
