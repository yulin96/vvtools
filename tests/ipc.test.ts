import { EventEmitter } from 'events'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/shared/constants'
import { registerIpc } from '../src/main/ipc'
import type { SettingsStore } from '../src/main/services/settings-store'
import type { TaskQueue } from '../src/main/services/task-queue'
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
