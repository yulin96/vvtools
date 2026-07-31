import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '../shared/constants'
import type { MediaTask, UpdateState, VVToolsApi } from '../shared/types'

const api: VVToolsApi = {
  platform: process.platform as VVToolsApi['platform'],
  selectFiles: (kind) => ipcRenderer.invoke(IPC_CHANNELS.selectFiles, kind),
  selectTextFile: () => ipcRenderer.invoke(IPC_CHANNELS.selectTextFile),
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
  openTaskOutput: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.openTaskOutput, taskId),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  updateSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, settings),
  getCapabilities: () => ipcRenderer.invoke(IPC_CHANNELS.getCapabilities),
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getVersion),
  getReleaseNotes: () => ipcRenderer.invoke(IPC_CHANNELS.getReleaseNotes),
  getUpdateState: () => ipcRenderer.invoke(IPC_CHANNELS.getUpdateState),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.downloadUpdate),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.installUpdate),
  openReleasePage: () => ipcRenderer.invoke(IPC_CHANNELS.openReleasePage),
  onTasksChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, tasks: MediaTask[]): void =>
      callback(tasks)
    ipcRenderer.on(IPC_CHANNELS.tasksChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.tasksChanged, listener)
  },
  onUpdateChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState): void =>
      callback(state)
    ipcRenderer.on(IPC_CHANNELS.updatesChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.updatesChanged, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
