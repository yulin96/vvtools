import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '../shared/constants'
import type { MediaTask, VVToolsApi } from '../shared/types'

const api: VVToolsApi = {
  selectFiles: (kind) => ipcRenderer.invoke(IPC_CHANNELS.selectFiles, kind),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  selectOutputDirectory: (current) =>
    ipcRenderer.invoke(IPC_CHANNELS.selectOutputDirectory, current),
  selectImageDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectImageDirectory),
  expandImageInputs: (paths) => ipcRenderer.invoke(IPC_CHANNELS.expandImageInputs, paths),
  openOutputDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.openOutputDirectory),
  createTasks: (request) => ipcRenderer.invoke(IPC_CHANNELS.createTasks, request),
  inspectTasks: (request) => ipcRenderer.invoke(IPC_CHANNELS.inspectTasks, request),
  getTasks: () => ipcRenderer.invoke(IPC_CHANNELS.getTasks),
  cancelTask: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.cancelTask, taskId),
  retryTask: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.retryTask, taskId),
  retryFailedTasks: () => ipcRenderer.invoke(IPC_CHANNELS.retryFailedTasks),
  clearFinishedTasks: () => ipcRenderer.invoke(IPC_CHANNELS.clearFinishedTasks),
  cancelPendingTasks: () => ipcRenderer.invoke(IPC_CHANNELS.cancelPendingTasks),
  getQueuePaused: () => ipcRenderer.invoke(IPC_CHANNELS.getQueuePaused),
  setQueuePaused: (paused) => ipcRenderer.invoke(IPC_CHANNELS.setQueuePaused, paused),
  openTaskOutput: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.openTaskOutput, taskId),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  updateSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, settings),
  getCapabilities: () => ipcRenderer.invoke(IPC_CHANNELS.getCapabilities),
  onTasksChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, tasks: MediaTask[]): void =>
      callback(tasks)
    ipcRenderer.on(IPC_CHANNELS.tasksChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.tasksChanged, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
