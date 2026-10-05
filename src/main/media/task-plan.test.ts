import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_FONT_OPTIONS,
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_SPRITE_OPTIONS
} from '../../shared/constants'
import type { CreateTasksRequest } from '../../shared/types'
import { planSourceOutputs, taskOutputDirectory, taskSources } from './task-plan'

const directories: string[] = []

function fixture(): { root: string; source: string; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'vvtools-plan-'))
  directories.push(root)
  const source = join(root, 'collection.ttc')
  writeFileSync(source, 'source')
  return { root, source, output: join(root, 'output') }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('task output planning', () => {
  it('does not create output directories or mutate the request and reservations', () => {
    const { source, output } = fixture()
    const request: CreateTasksRequest = {
      kind: 'font',
      sources: [{ path: source, outputFormat: 'woff2', subsetPreset: 'latin' }],
      batchItemIds: ['font-row'],
      outputMode: 'custom',
      outputDirectory: output,
      outputSuffix: '',
      outputNameTemplate: '{name}-{index}',
      options: { ...DEFAULT_FONT_OPTIONS, operation: 'splitCollection' }
    }
    const original = structuredClone(request)
    const reserved = new Set([join(output, 'collection-1.woff2')])
    const [input] = taskSources(request)
    const plan = planSourceOutputs(request, input, { fontCount: 2 }, reserved, new Set())

    expect(input).toEqual({
      path: source,
      relativeDirectory: '',
      batchItemId: 'font-row',
      fontOutputFormat: 'woff2',
      fontSubsetPreset: 'latin'
    })
    expect(plan.units).toEqual([
      { fontIndex: 0, outputPath: join(output, 'collection-1_1.woff2') },
      { fontIndex: 1, outputPath: join(output, 'collection-2.woff2') }
    ])
    expect(plan.skipped).toBe(false)
    expect(reserved).toEqual(new Set([join(output, 'collection-1.woff2')]))
    expect(request).toEqual(original)
    expect(existsSync(output)).toBe(false)
  })

  it('discards the entire font plan on a later conflict and leaves earlier names available', () => {
    const { source, output } = fixture()
    mkdirSync(output)
    const conflict = join(output, 'collection-2.woff2')
    writeFileSync(conflict, 'existing')
    const request: CreateTasksRequest = {
      kind: 'font',
      sources: [{ path: source, outputFormat: 'woff2' }],
      outputMode: 'custom',
      outputDirectory: output,
      outputSuffix: '',
      outputNameTemplate: '{name}-{index}',
      outputConflictPolicy: 'skip',
      options: { ...DEFAULT_FONT_OPTIONS, operation: 'splitCollection' }
    }
    const [input] = taskSources(request)
    const reserved = new Set<string>()
    const plan = planSourceOutputs(request, input, { fontCount: 3 }, reserved, new Set())

    expect(plan).toEqual({
      outputPath: conflict,
      outputPaths: [join(output, 'collection-1.woff2'), conflict],
      units: [],
      skipped: true,
      skippedReason: '输出文件已存在，当前冲突策略为跳过'
    })
    expect(reserved.size).toBe(0)
    const next = planSourceOutputs(
      { ...request, fontIndexes: [0] },
      input,
      undefined,
      reserved,
      new Set()
    )
    expect(next.units).toEqual([{ fontIndex: 0, outputPath: join(output, 'collection-1.woff2') }])
  })

  it('keeps sprite sheets grouped under one reserved folder', () => {
    const { root, output } = fixture()
    const source = join(root, 'clip.mp4')
    const request: CreateTasksRequest = {
      kind: 'sprite',
      sourcePaths: [source],
      outputMode: 'custom',
      outputDirectory: output,
      outputSuffix: '_sprite',
      options: { ...DEFAULT_SPRITE_OPTIONS }
    }
    const folder = join(output, 'clip_sprite')
    const paths = [join(folder, 'clip_sprite_1.png'), join(folder, 'clip_sprite_2.png')]
    const plan = planSourceOutputs(
      request,
      taskSources(request)[0],
      { sheetCount: 2 },
      new Set(),
      new Set()
    )

    expect(plan.outputPath).toBe(folder)
    expect(plan.outputPaths).toEqual(paths)
    expect(plan.units).toHaveLength(1)
    expect(plan.units[0].outputPath).toBe(folder)
    expect(plan.units[0].outputPaths).toEqual(paths)
  })

  it('uses the same source or preserved image subdirectory for both callers', () => {
    const { root, output } = fixture()
    const source = join(root, 'photo.png')
    const request: CreateTasksRequest = {
      kind: 'image',
      sources: [{ path: source, relativeDirectory: 'album/day' }],
      outputMode: 'custom',
      outputDirectory: output,
      outputSuffix: '',
      options: { ...DEFAULT_IMAGE_OPTIONS, preserveStructure: true }
    }
    const [input] = taskSources(request)

    expect(taskOutputDirectory(request, input)).toBe(join(output, 'album/day'))
    expect(taskOutputDirectory({ ...request, outputMode: 'source' }, input)).toBe(root)
    expect(
      taskOutputDirectory(
        { ...request, options: { ...request.options, preserveStructure: false } },
        input
      )
    ).toBe(output)
  })
})
