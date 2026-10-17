import { contextBridge, ipcRenderer } from 'electron'
import type { AppCommand, KaptaDescargadorApi, Job } from '@shared/types'

type Envelope<T> = { ok: true; value: T } | { ok: false; error: string }

/** Desempaqueta la respuesta del proceso principal y convierte los errores en Error con mensaje limpio. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (!res.ok) throw new Error(res.error)
  return res.value
}

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Órdenes del menú de macOS. Al abrir la ventana desde el menú llegan antes de que React se suscriba: se guardan.
const pendingCommands: AppCommand[] = []
let commandListener: ((command: AppCommand) => void) | null = null
ipcRenderer.on('app:command', (_e, command: AppCommand) => {
  if (commandListener) commandListener(command)
  else pendingCommands.push(command)
})

const api: KaptaDescargadorApi = {
  platform: process.platform,
  analyze: (url) => call('media:analyze', url),
  addJob: (request) => call('jobs:add', request),
  cancelJob: (id) => call('jobs:cancel', id),
  retryJob: (id) => call('jobs:retry', id),
  dismissJob: (id) => call('jobs:dismiss', id),
  listJobs: () => call('jobs:list'),
  onJobUpdate: (cb) => subscribe<[Job]>('jobs:update', cb),
  onJobRemoved: (cb) => subscribe<[string]>('jobs:removed', cb),

  listHistory: () => call('history:list'),
  removeHistory: (id) => call('history:remove', id),
  onHistoryChange: (cb) => subscribe<[]>('history:changed', cb),

  getSettings: () => call('settings:get'),
  setSettings: (patch) => call('settings:set', patch),
  chooseFolder: () => call('dialog:chooseFolder'),

  showInFolder: (p) => call('file:show', p),
  openFile: (p) => call('file:open', p),
  openOutputDir: () => call('file:openOutputDir'),
  startDrag: (p) => ipcRenderer.send('file:drag', p),

  readClipboardUrl: () => call('clipboard:url'),
  onCommand: (cb) => {
    commandListener = cb
    for (const command of pendingCommands.splice(0)) cb(command)
    return () => {
      if (commandListener === cb) commandListener = null
    }
  },
  getOpenAtLogin: () => call('app:getOpenAtLogin'),
  setOpenAtLogin: (enabled) => call('app:setOpenAtLogin', enabled),
  engineInfo: () => call('engine:info'),
  updateEngine: () => call('engine:update'),
  appVersion: () => call('app:version')
}

contextBridge.exposeInMainWorld('api', api)
