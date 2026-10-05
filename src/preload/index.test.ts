import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../shared/constants'
import type { TaskProgressUpdate, TaskStateUpdate, VVToolsApi } from '../shared/types'

const bridge = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: bridge.expose },
  ipcRenderer: { invoke: bridge.invoke, on: bridge.on, removeListener: bridge.removeListener },
  webUtils: { getPathForFile: vi.fn() }
}))

let api: VVToolsApi
beforeAll(async () => {
  await import('./index')
  api = bridge.expose.mock.calls[0][1] as VVToolsApi
})
beforeEach(() => {
  bridge.invoke.mockReset()
  bridge.on.mockClear()
  bridge.removeListener.mockClear()
})

describe('task notification bridge', () => {
  it('preserves snapshot versions and delta payloads and removes only its own listeners', async () => {
    bridge.invoke.mockResolvedValue({ sequence: 12, tasks: [] })
    await expect(api.getTasks()).resolves.toEqual({ sequence: 12, tasks: [] })
    expect(bridge.invoke).toHaveBeenCalledWith(IPC_CHANNELS.getTasks)
    const onState = vi.fn()
    const onProgress = vi.fn()
    const disposeState = api.onTasksChanged(onState)
    const disposeProgress = api.onTaskProgressChanged(onProgress)
    const stateListener = bridge.on.mock.calls[0][1]
    const progressListener = bridge.on.mock.calls[1][1]
    const state: TaskStateUpdate = { sequence: 13, tasks: [], removedTaskIds: ['old-task'] }
    const progress: TaskProgressUpdate = { sequence: 14, id: 'task', progress: 30 }
    stateListener({}, state)
    progressListener({}, progress)
    expect(onState.mock.calls).toEqual([[state]])
    expect(onProgress.mock.calls).toEqual([[progress]])
    disposeState()
    disposeProgress()
    expect(bridge.removeListener.mock.calls).toEqual([
      [IPC_CHANNELS.tasksChanged, stateListener],
      [IPC_CHANNELS.taskProgressChanged, progressListener]
    ])
  })
})

describe('desktop bridge', () => {
  it('exposes only specific integration and navigation operations and cleans up its listener', async () => {
    const state = { platform: 'darwin', status: 'installed', message: 'ready' }
    bridge.invoke.mockResolvedValue(state)
    await expect(api.getDesktopIntegration()).resolves.toEqual(state)
    await api.repairDesktopIntegration()
    await api.openDesktopSystemSettings()
    await api.getDesktopNavigation()
    await api.acknowledgeDesktopNavigation('navigation-id')
    expect(bridge.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.getDesktopIntegration],
      [IPC_CHANNELS.repairDesktopIntegration],
      [IPC_CHANNELS.openDesktopSystemSettings],
      [IPC_CHANNELS.getDesktopNavigation],
      [IPC_CHANNELS.acknowledgeDesktopNavigation, 'navigation-id']
    ])
    const receive = vi.fn()
    const dispose = api.onDesktopNavigation(receive)
    const listener = bridge.on.mock.calls[0][1]
    const request = { id: 'navigation-id', path: '/image', paths: ['/tmp/photo.png'] }
    listener({}, request)
    expect(receive).toHaveBeenCalledExactlyOnceWith(request)
    dispose()
    expect(bridge.removeListener).toHaveBeenCalledExactlyOnceWith(
      IPC_CHANNELS.desktopNavigation,
      listener
    )
    expect(api).not.toHaveProperty('registerContextMenu')
    expect(api).not.toHaveProperty('runCommand')
  })
})
