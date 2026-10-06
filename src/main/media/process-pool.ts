import { spawn, type ChildProcess, type Serializable } from 'child_process'
import { TaskCancelledError } from './errors'

interface Job {
  request: Serializable
  signal: AbortSignal
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  abort: () => void
}
interface ProcessSlot {
  child: ChildProcess
  job: Job | null
  idleTimer: NodeJS.Timeout | null
  stderr: string
}

export class MediaProcessPool {
  private readonly slots = new Set<ProcessSlot>()
  private readonly queue: Job[] = []
  private stopped = false

  constructor(
    private readonly modulePath: string,
    private readonly maximum: number
  ) {}

  run<T>(request: Serializable, signal = new AbortController().signal): Promise<T> {
    if (signal.aborted || this.stopped) return Promise.reject(new TaskCancelledError())
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        request,
        signal,
        resolve: (value) => resolve(value as T),
        reject,
        abort: () => {
          const index = this.queue.indexOf(job)
          if (index >= 0) {
            this.queue.splice(index, 1)
            signal.removeEventListener('abort', job.abort)
            reject(new TaskCancelledError())
          } else {
            const slot = [...this.slots].find((item) => item.job === job)
            slot?.child.kill()
          }
        }
      }
      signal.addEventListener('abort', job.abort, { once: true })
      this.queue.push(job)
      this.pump()
    })
  }

  shutdown(): void {
    this.stopped = true
    for (const job of this.queue.splice(0))
      this.settle(job, () => job.reject(new TaskCancelledError()))
    for (const slot of this.slots) {
      if (slot.idleTimer) clearTimeout(slot.idleTimer)
      slot.child.kill()
    }
  }

  private settle(job: Job, callback: () => void): void {
    job.signal.removeEventListener('abort', job.abort)
    callback()
  }

  private pump(): void {
    if (this.stopped) return
    while (this.queue.length) {
      const slot =
        [...this.slots].find((item) => !item.job) ??
        (this.slots.size < this.maximum ? this.createSlot() : null)
      if (!slot) return
      if (slot.idleTimer) clearTimeout(slot.idleTimer)
      slot.idleTimer = null
      const job = this.queue.shift()!
      slot.job = job
      slot.child.ref()
      slot.child.channel?.ref()
      slot.child.send(job.request, (error) => {
        if (error) this.removeSlot(slot, error)
      })
    }
  }

  private createSlot(): ProcessSlot {
    const child = spawn(process.execPath, [this.modulePath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', UV_THREADPOOL_SIZE: '1' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true
    })
    const slot: ProcessSlot = { child, job: null, idleTimer: null, stderr: '' }
    this.slots.add(slot)
    child.stderr?.on('data', (chunk: Buffer) => {
      slot.stderr = (slot.stderr + chunk.toString()).slice(-8192)
    })
    child.on('message', (message: unknown) => {
      const job = slot.job
      if (!job || !message || typeof message !== 'object') return
      const reply = message as { ok?: boolean; result?: unknown; error?: string }
      if (job.signal.aborted) return
      slot.job = null
      this.settle(job, () => {
        if (reply.ok) job.resolve(reply.result)
        else job.reject(new Error(reply.error || '后台处理失败'))
      })
      this.pump()
      if (!slot.job && this.slots.has(slot)) {
        child.unref()
        child.channel?.unref()
        slot.idleTimer = setTimeout(
          () => this.removeSlot(slot, new Error('后台处理进程已空闲')),
          5000
        )
        slot.idleTimer.unref()
      }
    })
    child.once('error', (error) => this.removeSlot(slot, error))
    child.once('close', (code) =>
      this.removeSlot(
        slot,
        new Error(slot.stderr.trim() || `后台处理进程异常退出（${code ?? '未知'}）`)
      )
    )
    return slot
  }

  private removeSlot(slot: ProcessSlot, error: Error): void {
    if (!this.slots.delete(slot)) return
    if (slot.idleTimer) clearTimeout(slot.idleTimer)
    const job = slot.job
    slot.job = null
    if (job)
      this.settle(job, () =>
        job.reject(job.signal.aborted || this.stopped ? new TaskCancelledError() : error)
      )
    slot.child.kill()
    this.pump()
  }
}
