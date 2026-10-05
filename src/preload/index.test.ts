import { beforeAll, describe, expect, it, vi } from 'vitest'
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
