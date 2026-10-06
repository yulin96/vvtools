import { randomUUID } from 'crypto'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from '../src/main/media/sharp-runtime'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopActions } from '../src/main/services/desktop-actions'
import { TaskQueue, type TaskRunner } from '../src/main/services/task-queue'
import { FailureLogService } from '../src/main/services/failure-log'
import { imageProcesses, processImage } from '../src/main/media/image-processor'
import { normalizeDesktopSettings } from '../src/shared/desktop-settings'
import type { DesktopSettings } from '../src/shared/types'

const cleanups: Array<() => void | Promise<void>> = []
afterAll(() => imageProcesses.shutdown())
async function fixture(
  settings: DesktopSettings = normalizeDesktopSettings(undefined),
  runner: TaskRunner = processImage
): Promise<{
  root: string
  queue: TaskQueue
  actions: DesktopActions
  onResult: ReturnType<typeof vi.fn>
  navigate: ReturnType<typeof vi.fn>
  image: (name: string, alpha?: boolean) => Promise<string>
}> {
  const root = await mkdtemp(join(tmpdir(), 'vvtools-desktop-actions-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const queue = new TaskQueue(
    { image: 2, video: 1, sprite: 1, audio: 1, pdf: 1, font: 1 },
    runner,
    new FailureLogService(join(root, 'logs'))
  )
  const onResult = vi.fn(),
    navigate = vi.fn()
  const actions = new DesktopActions(queue, () => settings, onResult, navigate)
  cleanups.push(() => {
    actions.dispose()
    queue.shutdown()
  })
  return {
    root,
    queue,
    actions,
    onResult,
    navigate,
    image: async (name, alpha = false) => {
      const path = join(root, name)
      await sharp({
        create: {
          width: 800,
          height: 600,
          channels: alpha ? 4 : 3,
          background: { r: 90, g: 30, b: 70, alpha: alpha ? 0.5 : 1 }
        }
      })
        .png()
        .toFile(path)
      return path
    }
  }
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
describe('desktop actions through the main task queue', () => {
  it('processes one ordered batch with transparent-image protection and preserves source files', async () => {
    const { image, actions, queue, onResult } = await fixture()
    const opaque = await image('opaque.png'),
      alpha = await image('transparent.png', true)
    const originals = await Promise.all([readFile(opaque), readFile(alpha)])
    const id = randomUUID()
    await actions.enqueue({ version: 1, id, actionId: 'image-share', paths: [opaque, alpha] })
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce())
    expect(onResult.mock.calls[0][0]).toMatchObject({
      successful: 2,
      skipped: 0,
      failed: 0,
      pendingPaths: []
    })
    const tasks = queue.snapshot().tasks
    expect(
      tasks.map((task) => ({
        source: task.sourcePath,
        output: task.outputPath,
        status: task.status,
        marker: task.desktopRequestId
      }))
    ).toEqual([
      {
        source: opaque,
        output: opaque.replace('.png', '_share.jpg'),
        status: 'completed',
        marker: id
      },
      {
        source: alpha,
        output: alpha.replace('.png', '_share.png'),
        status: 'completed',
        marker: id
      }
    ])
    const [jpeg, png] = await Promise.all(tasks.map((task) => sharp(task.outputPath).metadata()))
    expect(jpeg).toMatchObject({ format: 'jpeg', width: 300, height: 225, hasAlpha: false })
    expect(png).toMatchObject({ format: 'png', width: 300, height: 225, hasAlpha: true })
    expect(await Promise.all([readFile(opaque), readFile(alpha)])).toEqual(originals)
  })
  it('keeps conflicting files pending and reports one aggregate notification', async () => {
    const settings = normalizeDesktopSettings(undefined)
    settings.actions[0].outputConflictPolicy = 'skip'
    const { image, actions, queue, onResult, navigate } = await fixture(settings)
    const source = await image('photo.png')
    const output = source.replace('.png', '_share.jpg')
    await writeFile(output, 'keep existing')
    await actions.enqueue({
      version: 1,
      id: randomUUID(),
      actionId: 'image-share',
      paths: [source]
    })
    expect(queue.list()).toEqual([])
    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult.mock.calls[0][0]).toMatchObject({
      successful: 0,
      skipped: 1,
      failed: 0,
      pendingPaths: [source]
    })
    expect(await readFile(output, 'utf8')).toBe('keep existing')
    actions.showResult()
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: '/image', paths: [source], preserveBatch: true })
    )
  })
  it('snapshots options at invocation and aggregates multiple failures without blocking the next request', async () => {
    const settings = normalizeDesktopSettings(undefined)
    const failing: TaskRunner = async () => {
      throw new Error('encoder failure')
    }
    const { image, actions, queue, onResult } = await fixture(settings, failing)
    const first = await image('one.png'),
      second = await image('two.png')
    const preparation = actions.enqueue({
      version: 1,
      id: randomUUID(),
      actionId: 'image-share',
      paths: [first, second]
    })
    settings.actions[0].options.width = 640
    await preparation
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce())
    expect(queue.list().map((task) => task.options)).toEqual([
      expect.objectContaining({ width: 300 }),
      expect.objectContaining({ width: 300 })
    ])
    expect(onResult.mock.calls[0][0]).toMatchObject({ successful: 0, skipped: 0, failed: 2 })
    await actions.enqueue({ version: 1, id: randomUUID(), actionId: 'image-share', paths: [first] })
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledTimes(2))
    expect(queue.list()[0].options).toMatchObject({ width: 640 })
    expect(actions.result()).toMatchObject({ failed: 1 })
  })
  it('rejects unsupported and disabled actions and opens supported files in the right workspace', async () => {
    const settings = normalizeDesktopSettings(undefined)
    settings.actions[0].enabled = false
    const { actions, navigate, queue } = await fixture(settings)
    await expect(
      actions.enqueue({
        version: 1,
        id: randomUUID(),
        actionId: 'image-share',
        paths: ['/tmp/photo.png']
      })
    ).rejects.toThrow('已停用')
    await expect(
      actions.enqueue({
        version: 1,
        id: randomUUID(),
        actionId: 'open',
        paths: ['/tmp/photo.png', '/tmp/video.mp4']
      })
    ).rejects.toThrow('同一种')
    const request = {
      version: 1 as const,
      id: randomUUID(),
      actionId: 'open' as const,
      paths: ['/tmp/A.woff2', '/tmp/B.ttf']
    }
    await actions.enqueue(request)
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      id: request.id,
      path: '/font',
      paths: request.paths
    })
    expect(queue.list()).toEqual([])
  })
  it('retains animated inputs pending and counts damaged inputs without creating partial jobs', async () => {
    const { root, actions, queue, onResult } = await fixture()
    const animated = join(root, 'animated.webp')
    const frames = Buffer.alloc(80 * 160 * 4, 200)
    frames.fill(80, 80 * 80 * 4)
    await sharp(frames, { raw: { width: 80, height: 160, channels: 4, pageHeight: 80 } })
      .webp({ loop: 0, delay: [100, 100] })
      .toFile(animated)
    expect((await sharp(animated).metadata()).pages).toBe(2)
    const damaged = join(root, 'damaged.png')
    await writeFile(damaged, 'not an image')
    await actions.enqueue({
      version: 1,
      id: randomUUID(),
      actionId: 'image-share',
      paths: [animated, damaged]
    })
    expect(queue.list()).toEqual([])
    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult.mock.calls[0][0]).toMatchObject({
      successful: 0,
      skipped: 0,
      failed: 2,
      pendingPaths: [animated, damaged]
    })
    expect(onResult.mock.calls[0][0].notice).toContain('不支持动画图片')
  })
  it('clears settled rows when a new desktop batch is entirely skipped', async () => {
    const settings = normalizeDesktopSettings(undefined)
    settings.actions[0].outputConflictPolicy = 'skip'
    const { image, actions, queue, onResult } = await fixture(settings)
    const previous = await image('previous.png')
    await actions.enqueue({
      version: 1,
      id: randomUUID(),
      actionId: 'image-share',
      paths: [previous]
    })
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce())
    expect(queue.list()).toHaveLength(1)
    const next = await image('next.png')
    await writeFile(next.replace('.png', '_share.jpg'), 'existing output')
    await actions.enqueue({ version: 1, id: randomUUID(), actionId: 'image-share', paths: [next] })
    expect(queue.list()).toEqual([])
    expect(actions.result()).toMatchObject({ skipped: 1, pendingPaths: [next] })
    expect(onResult).toHaveBeenCalledTimes(2)
  })
})
