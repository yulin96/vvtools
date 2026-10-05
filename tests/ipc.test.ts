import { EventEmitter } from 'events'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/shared/constants'
import { registerIpc } from '../src/main/ipc'
import type { SettingsStore } from '../src/main/services/settings-store'
import { TaskQueue } from '../src/main/services/task-queue'
import type { FailureLogService } from '../src/main/services/failure-log'
import type { TaskProgressUpdate, TaskStateUpdate } from '../src/shared/types'
import type { UpdateService } from '../src/main/services/update-service'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  app: {},
  dialog: {},
  shell: {},
  ipcMain: {
    handle: (
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    ) => handlers.set(channel, listener),
    removeHandler: (channel: string) => handlers.delete(channel)
  }
}))

afterEach(() => handlers.clear())

describe('IPC authentication boundary', () => {
  it('authenticates and validates icon appearance before invoking the native icon service', () => {
    const webContents = { mainFrame: {}, send: vi.fn() }
    const window = { webContents, isDestroyed: () => false } as unknown as BrowserWindow
    const queue = new EventEmitter() as TaskQueue
    const setIconTheme = vi.fn()
    const dispose = registerIpc(
      () => window,
      queue,
      {} as SettingsStore,
      {} as UpdateService,
      undefined,
      setIconTheme
    )
    try {
      const handle = handlers.get(IPC_CHANNELS.setAppIconTheme)!
      expect(() =>
        handle({ sender: {}, senderFrame: webContents.mainFrame } as IpcMainInvokeEvent, 'dark')
      ).toThrow('拒绝来自未知页面的请求')
      expect(() =>
        handle({ sender: webContents, senderFrame: {} } as IpcMainInvokeEvent, 'dark')
      ).toThrow('拒绝来自未知页面的请求')
      const trusted = {
        sender: webContents,
        senderFrame: webContents.mainFrame
      } as IpcMainInvokeEvent
      for (const input of [null, {}, true, 'auto', '']) {
        expect(() => handle(trusted, input)).toThrow('图标主题无效')
      }
      expect(setIconTheme).not.toHaveBeenCalled()
      for (const mode of ['system', 'light', 'dark']) handle(trusted, mode)
      expect(setIconTheme.mock.calls).toEqual([['system'], ['light'], ['dark']])
    } finally {
      dispose()
    }
    expect(handlers.size).toBe(0)
  })

  it('serves an ordered initial snapshot and forwards state/progress deltas without fetching the full list', () => {
    const webContents = { mainFrame: {}, send: vi.fn() }
    const window = { webContents, isDestroyed: () => false } as unknown as BrowserWindow
    const queue = new TaskQueue(
      { image: 1, video: 1, sprite: 1, audio: 1, pdf: 1, font: 1 },
      vi.fn(),
      { writeFailure: vi.fn() } as unknown as FailureLogService
    )
    const list = vi.spyOn(queue, 'list')
    const dispose = registerIpc(() => window, queue, {} as SettingsStore, {} as UpdateService)
    try {
      const trusted = {
        sender: webContents,
        senderFrame: webContents.mainFrame
      } as IpcMainInvokeEvent
      expect(handlers.get(IPC_CHANNELS.getTasks)!(trusted)).toEqual({ sequence: 0, tasks: [] })
      expect(list).toHaveBeenCalledOnce()
      list.mockClear()
      const state: TaskStateUpdate = { sequence: 1, tasks: [], removedTaskIds: ['settled-task'] }
      const progress: TaskProgressUpdate = { sequence: 2, id: 'active-task', progress: 35 }
      queue.emit('changed', state)
      queue.emit('progress', progress)
      expect(webContents.send.mock.calls).toEqual([
        [IPC_CHANNELS.tasksChanged, state],
        [IPC_CHANNELS.taskProgressChanged, progress]
      ])
      expect(list).not.toHaveBeenCalled()
      expect(() =>
        handlers.get(IPC_CHANNELS.getTasks)!({
          sender: {},
          senderFrame: webContents.mainFrame
        } as IpcMainInvokeEvent)
      ).toThrow('拒绝来自未知页面的请求')
    } finally {
      dispose()
      list.mockRestore()
    }
  })

  it('authenticates sender and frame before validating payloads or calling task/settings services', () => {
    const webContents = { mainFrame: {}, send: vi.fn() }
    const window = { webContents, isDestroyed: () => false } as unknown as BrowserWindow
    const queue = Object.assign(new EventEmitter(), { create: vi.fn(), list: vi.fn(() => []) })
    const settings = { update: vi.fn() }
    const dispose = registerIpc(
      () => window,
      queue as unknown as TaskQueue,
      settings as unknown as SettingsStore,
      {} as UpdateService
    )
    try {
      for (const channel of [IPC_CHANNELS.createTasks, IPC_CHANNELS.updateSettings]) {
        const handle = handlers.get(channel)!
        expect(() =>
          handle({ sender: {}, senderFrame: webContents.mainFrame } as IpcMainInvokeEvent, null)
        ).toThrow('拒绝来自未知页面的请求')
        expect(() =>
          handle({ sender: webContents, senderFrame: {} } as IpcMainInvokeEvent, null)
        ).toThrow('拒绝来自未知页面的请求')
      }
      const trusted = {
        sender: webContents,
        senderFrame: webContents.mainFrame
      } as IpcMainInvokeEvent
      expect(() => handlers.get(IPC_CHANNELS.createTasks)!(trusted, null)).toThrow('任务参数无效')
      expect(() => handlers.get(IPC_CHANNELS.updateSettings)!(trusted, null)).toThrow(
        '设置参数无效'
      )
      expect(queue.create).not.toHaveBeenCalled()
      expect(queue.list).not.toHaveBeenCalled()
      expect(settings.update).not.toHaveBeenCalled()
    } finally {
      dispose()
    }
    expect(handlers.size).toBe(0)
    expect(queue.listenerCount('changed')).toBe(0)
    expect(queue.listenerCount('progress')).toBe(0)
  })
})
