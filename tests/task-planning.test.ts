import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectTasks } from '../src/main/media/preflight'
import { probeFont } from '../src/main/media/font-processor'
import { TaskQueue, type TaskRunner } from '../src/main/services/task-queue'
import { FailureLogService } from '../src/main/services/failure-log'
import { DEFAULT_FONT_OPTIONS, DEFAULT_PDF_OPTIONS } from '../src/shared/constants'
import type { CreateTasksRequest } from '../src/shared/types'

vi.mock('../src/main/media/font-processor', () => ({
  probeFont: vi.fn(async () => ({
    format: 'ttc',
    fontCount: 3,
    fontInstances: [
      { name: 'Regular', axes: { wght: 400 } },
      { name: 'Bold', axes: { wght: 700 } }
    ]
  }))
}))
vi.mock('../src/main/media/pdf-processor', () => ({
  probePdf: async () => ({ pageCount: 2, width: 100, height: 200 })
}))

const directories: string[] = []
const runner: TaskRunner = async (task) => {
  if (task.outputPaths) {
    mkdirSync(task.outputPath, { recursive: true })
    for (const path of task.outputPaths) writeFileSync(path, 'processed')
  } else writeFileSync(task.outputPath, 'processed')
  return 9
}

function fixture(kind: 'font' | 'pdf' = 'font'): {
  source: string
  output: string
  queue: TaskQueue
} {
  const root = mkdtempSync(join(tmpdir(), 'vvtools-plan-integration-'))
  directories.push(root)
  const source = join(root, kind === 'font' ? 'collection.ttc' : 'document.pdf')
  writeFileSync(source, 'source fixture')
  return {
    source,
    output: join(root, 'output'),
    queue: new TaskQueue(
      { image: 1, video: 1, sprite: 1, audio: 1, pdf: 1, font: 1 },
      runner,
      new FailureLogService(join(root, 'user-data'))
    )
  }
}

async function waitForCompleted(queue: TaskQueue): Promise<void> {
  await vi.waitFor(() =>
    expect(queue.list().every((task) => task.status === 'completed')).toBe(true)
  )
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('preflight and queue planning contract', () => {
  it.each(['splitCollection', 'variableStatic'] as const)(
    'previews and creates the same ordered %s outputs with stable batch identities',
    async (operation) => {
      const { source, output, queue } = fixture()
      const request: CreateTasksRequest = {
        kind: 'font',
        sources: [{ path: source, outputFormat: 'woff2' }],
        batchItemIds: ['font-row'],
        outputMode: 'custom',
        outputDirectory: output,
        outputSuffix: '',
        outputNameTemplate:
          operation === 'splitCollection' ? '{name}-{index}' : '{name}-{instance}',
        fontIndexes: operation === 'splitCollection' ? [0, 2] : undefined,
        options: { ...DEFAULT_FONT_OPTIONS, operation }
      }
      const [inspection] = await inspectTasks(request)
      const expectedPaths =
        operation === 'splitCollection'
          ? [join(output, 'collection-1.woff2'), join(output, 'collection-3.woff2')]
          : [join(output, 'collection-Regular.woff2'), join(output, 'collection-Bold.woff2')]
      expect(inspection.valid).toBe(true)
      expect(inspection.outputPaths).toEqual(expectedPaths)
      const tasks = queue.create({
        ...request,
        inputMetadata: [
          { path: source, fontCount: inspection.fontCount, fontInstances: inspection.fontInstances }
        ]
      })
      try {
        expect(tasks.map((task) => task.outputPath)).toEqual(expectedPaths)
        expect(tasks.map((task) => task.batchInputId)).toEqual(['font-row', 'font-row'])
        expect(tasks.map((task) => task.batchItemId)).toEqual(['font-row:1', 'font-row:2'])
        for (const task of tasks) expect(task.options).toMatchObject({ outputFormat: 'woff2' })
      } finally {
        await waitForCompleted(queue)
      }
    }
  )

  it('groups PDF pages identically using output dimensions for filename variables', async () => {
    const { source, output, queue } = fixture('pdf')
    const request: CreateTasksRequest = {
      kind: 'pdf',
      sourcePaths: [source],
      batchItemIds: ['pdf-row'],
      outputMode: 'custom',
      outputDirectory: output,
      outputSuffix: '',
      outputNameTemplate: '{name}-{width}x{height}-{page}',
      options: { ...DEFAULT_PDF_OPTIONS, operation: 'toImage', dpi: 144, imageFormat: 'png' }
    }
    const [inspection] = await inspectTasks(request)
    const folder = join(output, 'document')
    const paths = [
      join(folder, 'document-200x400-001.png'),
      join(folder, 'document-200x400-002.png')
    ]
    expect(inspection).toMatchObject({ valid: true, outputPath: folder, outputPaths: paths })
    const tasks = queue.create({
      ...request,
      inputMetadata: [
        {
          path: source,
          width: inspection.outputWidth,
          height: inspection.outputHeight,
          pageCount: inspection.pageCount
        }
      ]
    })
    try {
      expect(tasks).toHaveLength(1)
      expect(tasks[0]).toMatchObject({
        outputPath: folder,
        outputPaths: paths,
        pageNumbers: [1, 2],
        batchInputId: 'pdf-row',
        batchItemId: 'pdf-row'
      })
    } finally {
      await waitForCompleted(queue)
    }
  })

  it('rechecks conflicts at creation time and skips every unit from the affected source', async () => {
    const { source, output, queue } = fixture()
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
    const [inspection] = await inspectTasks(request)
    expect(inspection.valid).toBe(true)
    mkdirSync(output)
    const conflictingPath = join(output, 'collection-2.woff2')
    writeFileSync(conflictingPath, 'existing output')

    expect(queue.create({ ...request, inputMetadata: [{ path: source, fontCount: 3 }] })).toEqual(
      []
    )
    expect(queue.list()).toEqual([])
    expect(readFileSync(conflictingPath, 'utf8')).toBe('existing output')
    const [rechecked] = await inspectTasks(request)
    expect(rechecked).toMatchObject({
      valid: false,
      skipped: true,
      outputPath: conflictingPath,
      error: '输出文件已存在，当前冲突策略为跳过'
    })
    const [remaining] = await inspectTasks({ ...request, fontIndexes: [0] })
    expect(remaining).toMatchObject({ valid: true, outputPath: join(output, 'collection-1.woff2') })
  })

  it('leaves skipped font output names available to later sources in the same batch', async () => {
    const { source, output, queue } = fixture()
    const secondDirectory = join(output, 'inputs')
    mkdirSync(secondDirectory, { recursive: true })
    const secondSource = join(secondDirectory, 'collection.ttc')
    writeFileSync(secondSource, 'second source')
    writeFileSync(join(output, 'collection-2.woff2'), 'existing output')
    vi.mocked(probeFont)
      .mockResolvedValueOnce({ format: 'ttc', fontCount: 3, fontInstances: [] })
      .mockResolvedValueOnce({ format: 'ttc', fontCount: 1, fontInstances: [] })
    const request: CreateTasksRequest = {
      kind: 'font',
      sources: [source, secondSource].map((path) => ({ path, outputFormat: 'woff2' })),
      batchItemIds: ['skipped-row', 'created-row'],
      outputMode: 'custom',
      outputDirectory: output,
      outputSuffix: '',
      outputNameTemplate: '{name}-{index}',
      outputConflictPolicy: 'skip',
      options: { ...DEFAULT_FONT_OPTIONS, operation: 'splitCollection' }
    }
    const inspections = await inspectTasks(request)
    expect(inspections.map(({ valid, outputPath }) => ({ valid, outputPath }))).toEqual([
      { valid: false, outputPath: join(output, 'collection-2.woff2') },
      { valid: true, outputPath: join(output, 'collection-1.woff2') }
    ])
    const tasks = queue.create({
      ...request,
      inputMetadata: [
        { path: source, fontCount: 3 },
        { path: secondSource, fontCount: 1 }
      ]
    })
    try {
      expect(tasks).toHaveLength(1)
      expect(tasks[0]).toMatchObject({
        sourcePath: secondSource,
        outputPath: join(output, 'collection-1.woff2'),
        batchInputId: 'created-row',
        batchItemId: 'created-row'
      })
    } finally {
      await waitForCompleted(queue)
    }
  })
})
