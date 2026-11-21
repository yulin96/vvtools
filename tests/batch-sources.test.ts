import { describe, expect, it } from 'vitest'
import { batchSpaceSavings, settledBatchSourceItems } from '../src/renderer/src/lib/batch-sources'
import { DEFAULT_IMAGE_OPTIONS } from '../src/shared/constants'
import type { MediaTask, TaskStatus } from '../src/shared/types'

function task(id: string, sourcePath: string, status: TaskStatus): MediaTask {
  return {
    id,
    kind: 'image',
    batchInputId: `input-${sourcePath}`,
    batchItemId: `row-${id}`,
    sourcePath,
    relativeDirectory: 'album',
    outputPath: `/output/${id}.jpg`,
    status,
    progress: status === 'completed' ? 100 : 0,
    options: { ...DEFAULT_IMAGE_OPTIONS },
    sourceSize: 10,
    createdAt: new Date().toISOString()
  }
}

describe('settled batch sources', () => {
  it('keeps settled sources in input order and removes expanded duplicates', () => {
    expect(
      settledBatchSourceItems([
        task('first', '/input/first.jpg', 'completed'),
        task('first-output-2', '/input/first.jpg', 'completed'),
        task('second', '/input/second.jpg', 'failed'),
        task('third', '/input/third.jpg', 'cancelled')
      ])
    ).toEqual([
      {
        path: '/input/first.jpg',
        batchItemId: 'input-/input/first.jpg',
        relativeDirectory: 'album'
      },
      {
        path: '/input/second.jpg',
        batchItemId: 'input-/input/second.jpg',
        relativeDirectory: 'album'
      },
      {
        path: '/input/third.jpg',
        batchItemId: 'input-/input/third.jpg',
        relativeDirectory: 'album'
      }
    ])
  })

  it('does not reuse a batch while any task is still active', () => {
    expect(
      settledBatchSourceItems([
        task('completed', '/input/completed.jpg', 'completed'),
        task('processing', '/input/processing.jpg', 'processing')
      ])
    ).toEqual([])
  })
})

it('counts each successful input once, sums distinct outputs and uses the last committed size', () => {
  const newer = {
    ...task('1', '/input/font.ttf', 'completed'),
    outputSize: 4,
    completedAt: '2026-01-02'
  }
  const older = {
    ...newer,
    sourcePath: '/input/FONT.TTF',
    outputSize: 99,
    completedAt: '2026-01-01'
  }
  const second = { ...newer, outputPath: '/output/font.woff2', outputSize: 3 }
  const pages = {
    ...task('pdf', '/input/doc.pdf', 'completed'),
    outputPath: '/output/doc',
    outputPaths: ['/output/doc/1.png', '/output/doc/2.png'],
    outputSize: 6
  }
  const skipped = { ...task('skip', '/input/skip', 'skipped'), outputSize: 200 }
  expect(batchSpaceSavings([newer, second, older, pages, skipped], 'darwin')).toEqual({
    sourceSize: 20,
    outputSize: 13,
    difference: 7,
    percentage: 35
  })
  expect(batchSpaceSavings([skipped], 'linux')).toBeNull()
})
