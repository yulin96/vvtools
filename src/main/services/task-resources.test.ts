import { describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_OPTIONS, DEFAULT_VIDEO_OPTIONS } from '../../shared/constants'
import type { MediaTask } from '../../shared/types'
import { deviceTaskBudget, taskResources } from './task-resources'

const MIB = 1024 * 1024
const image: MediaTask = {
  id: 'image',
  kind: 'image',
  sourcePath: '/source.png',
  outputPath: '/output.png',
  status: 'pending',
  progress: 0,
  sourceSize: 100,
  createdAt: '',
  options: DEFAULT_IMAGE_OPTIONS
}

describe('task resource estimates', () => {
  it('reserves device resources for the interface and scales the memory budget with the device', () => {
    expect(deviceTaskBudget(10, 16 * 1024 * MIB)).toEqual({ cpu: 8, memoryBytes: 4096 * MIB })
    expect(deviceTaskBudget(32, 64 * 1024 * MIB)).toEqual({ cpu: 25, memoryBytes: 16384 * MIB })
    expect(deviceTaskBudget(1, 1024 * MIB)).toEqual({ cpu: 1, memoryBytes: 256 * MIB })
  })

  it('gives a single job the available threads and divides them across active jobs', () => {
    const budget = { cpu: 8, memoryBytes: 4096 * MIB }
    expect(taskResources(image, budget, 1)).toMatchObject({ cpu: 8, threads: 8 })
    expect(taskResources(image, budget, 4)).toMatchObject({ cpu: 2, threads: 2 })
    expect(taskResources(image, budget, 1, 3)).toMatchObject({ cpu: 3, threads: 3 })
    expect(
      taskResources({ ...image, options: { ...DEFAULT_IMAGE_OPTIONS, format: 'avif' } }, budget, 8)
    ).toMatchObject({ cpu: 4, threads: 1 })
    expect(
      taskResources(
        {
          ...image,
          kind: 'video',
          options: {
            ...DEFAULT_VIDEO_OPTIONS,
            codec: 'source',
            resolution: 'source',
            frameRate: 'source'
          }
        },
        budget,
        1
      )
    ).toEqual({ cpu: 1, threads: 1, memoryBytes: 64 * MIB })
  })

  it('accounts for original pixels when resizing and reserves oversized jobs exclusively', () => {
    const budget = { cpu: 4, memoryBytes: 4096 * MIB }
    expect(
      taskResources(
        { ...image, inputWidth: 8000, inputHeight: 6000, sourceWidth: 1000, sourceHeight: 750 },
        budget,
        4
      ).memoryBytes
    ).toBe(128 * MIB + 8000 * 6000 * 4 + 1000 * 750 * 8)
    expect(
      taskResources({ ...image, inputWidth: 32768, inputHeight: 32768 }, budget, 4).memoryBytes
    ).toBe(4096 * MIB)
  })
})
