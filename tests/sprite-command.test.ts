import { describe, expect, it } from 'vitest'
import type { MediaTask, SpriteOptions } from '../src/shared/types'
import { DEFAULT_SPRITE_OPTIONS } from '../src/shared/constants'
import { buildSpriteArgs, createSpritePlan } from '../src/main/media/sprite-processor'

function task(options: Partial<SpriteOptions> = {}): MediaTask {
  return {
    id: 'sprite-task',
    kind: 'sprite',
    sourcePath: '/tmp/source video.mp4',
    outputPath: '/tmp/source_sprite',
    outputPaths: ['/tmp/source_sprite/source_sprite_1.png'],
    status: 'pending',
    progress: 0,
    options: { ...DEFAULT_SPRITE_OPTIONS, ...options },
    sourceSize: 1,
    createdAt: new Date(0).toISOString()
  }
}

const probe = {
  duration: 205,
  videoCodec: 'h264',
  width: 1920,
  height: 1080,
  format: 'mov,mp4'
}

describe('sprite command', () => {
  it('plans batches and preserves the source aspect ratio', () => {
    const plan = createSpritePlan(DEFAULT_SPRITE_OPTIONS, probe)
    expect(plan).toMatchObject({
      frameCount: 103,
      framesPerSheet: 100,
      sheetCount: 2,
      frameWidth: 240,
      frameHeight: 135,
      sheetWidth: 2452,
      sheetHeight: 1402
    })
  })

  it('supports evenly sampled single-sheet export', () => {
    const options: SpriteOptions = {
      ...DEFAULT_SPRITE_OPTIONS,
      samplingMode: 'count',
      frameCount: 24,
      exportMode: 'single',
      columns: 6
    }
    const plan = createSpritePlan(options, { ...probe, duration: 12 })
    expect(plan.intervalSeconds).toBe(0.5)
    expect(plan.sheetCount).toBe(1)
    expect(plan.sheetHeight).toBe(568)
  })

  it('supports extracting every frame or every nth frame', () => {
    const everyFrame = createSpritePlan(
      { ...DEFAULT_SPRITE_OPTIONS, samplingMode: 'frame', frameStep: 1 },
      { ...probe, duration: 10, frameCount: 300 }
    )
    const everySecondFrame = createSpritePlan(
      { ...DEFAULT_SPRITE_OPTIONS, samplingMode: 'frame', frameStep: 2 },
      { ...probe, duration: 10, frameCount: 300 }
    )
    expect(everyFrame.frameCount).toBe(300)
    expect(everySecondFrame.frameCount).toBe(150)
    expect(everySecondFrame.intervalSeconds).toBeCloseTo(1 / 15)
  })

  it('builds an FFmpeg tile filter as an argument array', () => {
    const mediaTask = task({ imageFormat: 'jpeg', quality: 80 })
    const options = mediaTask.options as SpriteOptions
    const plan = createSpritePlan(options, probe)
    const args = buildSpriteArgs(
      mediaTask,
      options,
      plan,
      1,
      '/tmp/source_sprite/source_sprite_2.jpg'
    )
    expect(args[args.indexOf('-ss') + 1]).toBe('200')
    expect(args[args.indexOf('-vf') + 1]).toContain('tile=3x1:nb_frames=3')
    expect(args).toContain('-nostdin')
    expect(args.at(-1)).toBe('/tmp/source_sprite/source_sprite_2.jpg')
  })

  it('builds an exact frame-step selection filter', () => {
    const mediaTask = task({ samplingMode: 'frame', frameStep: 2 })
    mediaTask.frameCount = 300
    const options = mediaTask.options as SpriteOptions
    const plan = createSpritePlan(options, { ...probe, duration: 10, frameCount: 300 })
    const args = buildSpriteArgs(
      mediaTask,
      options,
      plan,
      1,
      '/tmp/source_sprite/source_sprite_2.png'
    )
    expect(args[args.indexOf('-ss') + 1]).toBe('0')
    expect(args[args.indexOf('-vf') + 1]).toContain(
      "select='between(n\\,200\\,298)*not(mod(n\\,2))'"
    )
  })

  it('rejects an oversized single sheet before FFmpeg starts', () => {
    expect(() =>
      createSpritePlan(
        {
          ...DEFAULT_SPRITE_OPTIONS,
          samplingMode: 'count',
          frameCount: 10_000,
          exportMode: 'single',
          columns: 1,
          frameWidth: 4096
        },
        probe
      )
    ).toThrow('超过 32768 像素')
  })
})
