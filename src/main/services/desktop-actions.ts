import sharp from 'sharp'
import { randomUUID } from 'crypto'
import { extname } from 'path'
import type {
  CreateTasksRequest,
  DesktopActionRequest,
  DesktopNavigation,
  DesktopSettings,
  ImageInputFile,
  MediaTask,
  TaskStateUpdate
} from '../../shared/types'
import {
  AUDIO_EXTENSIONS,
  FONT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  PDF_EXTENSIONS,
  VIDEO_EXTENSIONS
} from '../../shared/constants'
import { inspectTasks } from '../media/preflight'
import { validateCreateRequest, validateSourcePath } from '../ipc-validation'
import type { TaskQueue } from './task-queue'
import { validateDesktopRequest } from './desktop-request'

export interface DesktopResult {
  requestId: string
  name: string
  successful: number
  skipped: number
  failed: number
  notice: string
  pendingPaths: string[]
}
interface Batch {
  result: DesktopResult
  tasks: Map<string, MediaTask['status']>
  preparing: boolean
  notified: boolean
}
export class DesktopActions {
  private readonly batches = new Map<string, Batch>()
  private serial: Promise<void> = Promise.resolve()
  private latest: DesktopResult | null = null
  private readonly changed = (update: TaskStateUpdate): void => {
    for (const task of update.tasks) {
      if (!task.desktopRequestId) continue
      const batch = this.batches.get(task.desktopRequestId)
      if (!batch) continue
      const previous = batch.tasks.get(task.id)
      batch.tasks.set(task.id, task.status)
      if (task.status === 'failed' && previous !== 'failed') {
        batch.result.notice +=
          (batch.result.notice ? '；' : '') + (task.failure?.message ?? '图片处理失败')
      }
      this.settle(batch)
    }
  }
  constructor(
    private readonly queue: TaskQueue,
    private readonly getSettings: () => DesktopSettings,
    private readonly onResult: (result: DesktopResult) => void,
    private readonly navigate: (navigation: DesktopNavigation) => void
  ) {
    queue.on('changed', this.changed)
  }

  result(): DesktopResult | null {
    return this.latest ? structuredClone(this.latest) : null
  }
  enqueue(input: DesktopActionRequest): Promise<void> {
    const request = validateDesktopRequest(input)
    const settings = structuredClone(this.getSettings())
    const next = this.serial.then(() => this.process(request, settings))
    this.serial = next.catch(() => undefined)
    return next
  }
  showResult(): void {
    if (this.latest)
      this.navigate({
        id: this.latest.requestId,
        path: '/image',
        paths: [...this.latest.pendingPaths],
        notice: this.latest.notice,
        preserveBatch: true
      })
  }
  reportError(message: string): void {
    this.latest = {
      requestId: randomUUID(),
      name: '快捷处理',
      successful: 0,
      skipped: 0,
      failed: 1,
      notice: message,
      pendingPaths: []
    }
    this.onResult(this.latest)
  }
  dispose(): void {
    this.queue.off('changed', this.changed)
  }
  private async process(request: DesktopActionRequest, settings: DesktopSettings): Promise<void> {
    if (request.actionId === 'open') {
      const path = workspaceForPaths(request.paths)
      if (!path) throw new Error('请选择同一种受支持的文件类型')
      this.navigate({ id: request.id, path, paths: request.paths })
      return
    }
    const action = settings.actions.find((item) => item.id === request.actionId && item.enabled)
    if (!action) throw new Error('该快捷动作已停用，请在设置中启用')
    this.queue.clearSettledBatch('image')
    const result: DesktopResult = {
      requestId: request.id,
      name: action.name,
      successful: 0,
      skipped: 0,
      failed: 0,
      notice: '',
      pendingPaths: []
    }
    const batch: Batch = { result, tasks: new Map(), preparing: true, notified: false }
    this.batches.set(request.id, batch)
    try {
      const sources: ImageInputFile[] = []
      for (const path of request.paths) {
        try {
          validateSourcePath(path, 'image')
          const metadata = await sharp(path, { failOn: 'error' }).metadata()
          if ((metadata.pages ?? 1) > 1) throw new Error('快捷处理暂不支持动画图片')
          const preserveAlpha = metadata.hasAlpha && action.options.format === 'jpeg'
          sources.push({
            path,
            relativeDirectory: '',
            ...(preserveAlpha ? { outputFormat: 'png' as const } : {})
          })
        } catch (error) {
          result.failed += 1
          result.notice +=
            (result.notice ? '；' : '') + String(error instanceof Error ? error.message : error)
          if (IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) result.pendingPaths.push(path)
        }
      }
      if (sources.length) {
        const requestData: Extract<CreateTasksRequest, { kind: 'image' }> = {
          kind: 'image',
          sources,
          batchItemIds: sources.map((_, index) => request.id + ':' + index),
          outputMode: action.outputMode,
          outputDirectory: action.outputDirectory,
          outputSuffix: action.outputSuffix,
          outputConflictPolicy: action.outputConflictPolicy,
          outputNameTemplate: '{name}{suffix}',
          presetName: action.name,
          options: structuredClone(action.options)
        }
        const active = this.queue
          .list()
          .filter((task) => task.status === 'pending' || task.status === 'processing')
        const inspections = await inspectTasks(
          validateCreateRequest(requestData),
          new Set(active.map((task) => task.outputPath)),
          new Set(active.map((task) => task.sourcePath))
        )
        requestData.sources = sources.filter((source, index) => {
          const inspection = inspections[index]
          if (inspection.valid) return true
          if (inspection.skipped) result.skipped += 1
          else result.failed += 1
          result.pendingPaths.push(source.path)
          result.notice +=
            (result.notice ? '；' : '') + (inspection.error ?? '输出已存在，已保留在待处理列表')
          return false
        })
        requestData.batchItemIds = requestData.batchItemIds!.filter(
          (_, index) => inspections[index].valid
        )
        requestData.inputMetadata = inspections
          .filter((item) => item.valid)
          .map((item) => ({
            path: item.sourcePath,
            width: item.outputWidth ?? item.width,
            height: item.outputHeight ?? item.height
          }))
        if (requestData.sources.length) {
          const created = this.queue.create(requestData, request.id)
          const started = new Set(created.map((task) => task.batchInputId))
          requestData.sources.forEach((source, index) => {
            if (started.has(requestData.batchItemIds![index])) return
            result.skipped += 1
            result.pendingPaths.push(source.path)
            result.notice +=
              (result.notice ? '；' : '') + '输出在提交时发生冲突，已保留在待处理列表'
          })
          for (const task of created) batch.tasks.set(task.id, task.status)
        }
      }
    } catch (error) {
      result.failed += request.paths.length - result.failed - result.skipped - batch.tasks.size
      result.notice +=
        (result.notice ? '；' : '') + String(error instanceof Error ? error.message : error)
      result.pendingPaths = [...new Set([...result.pendingPaths, ...request.paths])]
    } finally {
      const pending = new Set(result.pendingPaths)
      result.pendingPaths = request.paths.filter((path) => pending.has(path))
      batch.preparing = false
      this.latest = result
      this.settle(batch)
    }
  }
  private settle(batch: Batch): void {
    if (
      batch.preparing ||
      batch.notified ||
      [...batch.tasks.values()].some((status) => status === 'pending' || status === 'processing')
    )
      return
    batch.result.successful = [...batch.tasks.values()].filter(
      (status) => status === 'completed'
    ).length
    batch.result.skipped += [...batch.tasks.values()].filter(
      (status) => status === 'skipped' || status === 'cancelled'
    ).length
    batch.result.failed += [...batch.tasks.values()].filter((status) => status === 'failed').length
    batch.notified = true
    if (this.latest?.requestId === batch.result.requestId) this.latest = batch.result
    this.onResult(structuredClone(batch.result))
    this.batches.delete(batch.result.requestId)
  }
}
export function workspaceForPaths(paths: string[]): DesktopNavigation['path'] | null {
  const groups = [
    { path: '/image' as const, extensions: IMAGE_EXTENSIONS },
    { path: '/video' as const, extensions: VIDEO_EXTENSIONS },
    { path: '/audio' as const, extensions: AUDIO_EXTENSIONS },
    { path: '/pdf' as const, extensions: PDF_EXTENSIONS },
    { path: '/font' as const, extensions: FONT_EXTENSIONS }
  ]
  return (
    groups.find(
      (group) =>
        paths.length > 0 && paths.every((path) => group.extensions.has(extname(path).toLowerCase()))
    )?.path ?? null
  )
}
