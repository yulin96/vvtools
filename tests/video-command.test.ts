import { describe, expect, it } from 'vitest'
import type { MediaTask, VideoOptions } from '../src/shared/types'
import { DEFAULT_VIDEO_OPTIONS } from '../src/shared/constants'
import { buildVideoArgs } from '../src/main/media/video-processor'
import { createTaskCommand } from '../src/main/media/ffmpeg-runtime'

function task(options: Partial<VideoOptions>): MediaTask {
  return {
    id: 'task',
    kind: 'video',
    sourcePath: '/tmp/source file.mov',
    outputPath: '/tmp/output file.mp4',
    status: 'pending',
    progress: 0,
    options: { ...DEFAULT_VIDEO_OPTIONS, ...options },
    sourceSize: 1,
    createdAt: new Date(0).toISOString()
  }
}

describe('video command', () => {
  it('builds the compatibility-first default command as argument array', () => {
    const args = buildVideoArgs(task({ quality: 'balanced', resolution: 'source' }))
    expect(args).toContain('libx264')
    expect(args).toContain('yuv420p')
    expect(args).toContain('aac')
    expect(args).toContain('+faststart')
    expect(args[args.indexOf('-crf') + 1]).toBe('23')
    expect(args).not.toContain('-vf')
    expect(args.at(-1)).toBe('/tmp/output file.mp4')
  })

  it('adds a no-upscale resolution filter and quotes display-only command text', () => {
    const args = buildVideoArgs(task({ quality: 'high', resolution: '1080p' }))
    expect(args[args.indexOf('-crf') + 1]).toBe('20')
    expect(args[args.indexOf('-vf') + 1]).toContain('min(1920\\,iw)')
    const command = createTaskCommand('/opt/VVTools/ffmpeg', args)
    expect(command.args).toEqual(args)
    expect(command.display).toContain('"/tmp/source file.mov"')
  })

  it('supports H.265, target bitrate, frame rate and audio removal', () => {
    const args = buildVideoArgs(
      task({
        codec: 'h265',
        rateControl: 'bitrate',
        bitrateMbps: 8,
        frameRate: '30',
        audioMode: 'none',
        format: 'mkv'
      })
    )
    expect(args).toContain('libx265')
    expect(args[args.indexOf('-b:v') + 1]).toBe('8M')
    expect(args[args.indexOf('-r') + 1]).toBe('30')
    expect(args).toContain('-an')
    expect(args).not.toContain('+faststart')
  })
})
