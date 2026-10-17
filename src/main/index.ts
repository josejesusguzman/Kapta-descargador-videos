import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, session, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { DownloadRequest, Settings } from '@shared/types'
import { engineVersion, ensureEngine } from './binaries'
import { JobQueue } from './queue'
import { dragIconFor, getSettings, historyHas, listHistory, removeHistory, updateSettings } from './store'
import { analyze, cleanTempRoot, updateEngine, UserError } from './ytdlp'
import { isMediaFile } from './ytdlpArgs'

const APP_ID = 'com.descargador.app'
const WEEK = 7 * 24 * 60 * 60 * 1000

let win: BrowserWindow | null = null
const queue = new JobQueue()
let engineUpdating = false

function iconPath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, 'icons', name) : join(app.getAppPath(), 'resources', 'icons', name)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: '#0d0e12',
    title: 'Descargador',
    icon: iconPath('icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d0e12', symbolColor: '#c9cbd1', height: 44 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win?.show())
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win?.webContents.toggleDevTools()
    })
  }
  win.on('closed', () => (win = null))
  win.on('close', (e) => {
    if (!win || queue.activeCount() === 0) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Salir y cancelar', 'Seguir descargando'],
      defaultId: 1,
      cancelId: 1,
      title: 'Descargas en curso',
      message: 'Hay descargas en curso.',
      detail: 'Si sales ahora, se cancelarán y se borrarán los archivos incompletos.'
    })
    if (choice === 1) e.preventDefault()
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Endurecimiento: sin ventanas nuevas, sin navegación y sin permisos del navegador. */
function hardenSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (e, url) => {
      if (url !== contents.getURL()) e.preventDefault()
    })
    contents.on('will-attach-webview', (e) => e.preventDefault())
  })
}

/** Solo se aceptan rutas de archivos que la app descargó (historial o cola), nunca rutas arbitrarias. */
function isKnownFile(filePath: unknown): filePath is string {
  if (typeof filePath !== 'string' || !filePath) return false
  const p = resolve(filePath)
  return historyHas(p) || queue.list().some((j) => j.filePath === p)
}

function updateTaskbar(): void {
  if (!win) return
  const active = queue.list().filter((j) => j.status === 'downloading' || j.status === 'processing')
  if (!active.length) return win.setProgressBar(-1)
  const avg = active.reduce((s, j) => s + j.percent, 0) / active.length / 100
  win.setProgressBar(Math.max(0.01, avg))
}

function sanitizeRequest(r: DownloadRequest): DownloadRequest {
  if (!r || typeof r.url !== 'string' || !/^https?:\/\//i.test(r.url)) throw new UserError('Link no válido')
  return {
    url: r.url,
    title: String(r.title ?? 'Sin título').slice(0, 300),
    platform: String(r.platform ?? 'Web').slice(0, 60),
    thumbnail: typeof r.thumbnail === 'string' && r.thumbnail.startsWith('data:image/') ? r.thumbnail : undefined,
    mode: r.mode === 'audio' ? 'audio' : 'video',
    quality: Number.isInteger(r.quality) && r.quality >= 0 && r.quality <= 4320 ? r.quality : 0,
    audioFormat: ['mp3', 'm4a', 'wav'].includes(r.audioFormat) ? r.audioFormat : 'mp3',
    editorCompatible: r.editorCompatible !== false,
    outputDir: typeof r.outputDir === 'string' && isAbsolute(r.outputDir) ? r.outputDir : undefined
  }
}

/** Los errores de usuario viajan al renderer con un mensaje limpio, sin la traza de Electron. */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...(args as A)) }
    } catch (err) {
      const message = err instanceof UserError ? err.message : `Error inesperado: ${(err as Error).message}`
      return { ok: false, error: message }
    }
  })
}

async function runEngineUpdate(): Promise<{ ok: boolean; message: string; version?: string }> {
  if (engineUpdating) return { ok: false, message: 'Ya se está actualizando el motor.' }
  if (queue.activeCount() > 0) {
    return { ok: false, message: 'Espera a que terminen las descargas en curso para actualizar el motor.' }
  }
  engineUpdating = true
  try {
    const result = await updateEngine()
    updateSettings({ lastEngineCheck: Date.now() })
    return result
  } finally {
    engineUpdating = false
  }
}

function registerIpc(): void {
  handle('media:analyze', (url: string) => analyze(String(url ?? ''), getSettings().cookiesBrowser))
  handle('jobs:add', (req: DownloadRequest) => queue.add(sanitizeRequest(req)))
  handle('jobs:cancel', (id: string) => queue.cancel(id))
  handle('jobs:retry', (id: string) => queue.retry(id))
  handle('jobs:dismiss', (id: string) => queue.dismiss(id))
  handle('jobs:list', () => queue.list())

  handle('history:list', () => listHistory())
  handle('history:remove', (id: string) => removeHistory(String(id)))

  handle('settings:get', () => getSettings())
  handle('settings:set', (patch: Partial<Settings>) => updateSettings(patch ?? {}))
  handle('dialog:chooseFolder', async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, {
      title: 'Elige dónde guardar tus descargas',
      defaultPath: getSettings().outputDir,
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  handle('file:show', (p: string) => {
    if (isKnownFile(p)) shell.showItemInFolder(resolve(p))
  })
  handle('file:open', async (p: string) => {
    // openPath ejecuta el archivo con su programa asociado: solo video o audio, nunca ejecutables.
    if (isKnownFile(p) && isMediaFile(p)) await shell.openPath(resolve(p))
  })
  handle('file:openOutputDir', async () => {
    const dir = getSettings().outputDir
    mkdirSync(dir, { recursive: true })
    await shell.openPath(dir)
  })

  // Arrastre nativo de Windows: CapCut, Premiere, DaVinci o el Explorador reciben el archivo real.
  const fallbackIcon = nativeImage.createFromPath(iconPath('drag.png'))
  ipcMain.on('file:drag', (e, p: unknown) => {
    if (!isKnownFile(p) || !existsSync(p)) return
    e.sender.startDrag({ file: resolve(p), icon: dragIconFor(resolve(p), fallbackIcon) })
  })

  handle('clipboard:url', async () => {
    const text = (await clipboard.readText()).trim()
    return /^https?:\/\/\S+$/i.test(text) && text.length < 2048 ? text : null
  })
  handle('engine:info', () => ({ version: engineVersion(), updating: engineUpdating }))
  handle('engine:update', () => runEngineUpdate())
  handle('app:version', () => app.getVersion())
}

function wireQueueEvents(): void {
  queue.on('update', (job) => {
    win?.webContents.send('jobs:update', job)
    updateTaskbar()
  })
  queue.on('history', () => win?.webContents.send('history:changed'))
  queue.on('done', (job) => {
    if (win?.isFocused() || !Notification.isSupported()) return
    const n = new Notification({
      title: 'Descarga lista',
      body: job.request.title,
      icon: iconPath('icon.png'),
      silent: true
    })
    n.on('click', () => {
      win?.show()
      win?.focus()
    })
    n.show()
  })
}

/** Revisión semanal del motor (si está activada), en segundo plano y sin molestar. */
function scheduleEngineCheck(): void {
  const s = getSettings()
  if (!s.autoUpdateEngine || Date.now() - s.lastEngineCheck < WEEK) return
  setTimeout(() => {
    if (queue.activeCount() === 0) void runEngineUpdate().catch(() => undefined)
  }, 15000)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID)
    // Sin menú de aplicación: la ventana usa su propia barra de título.
    Menu.setApplicationMenu(null)
    hardenSecurity()
    ensureEngine()
    cleanTempRoot()
    registerIpc()
    wireQueueEvents()
    createWindow()
    scheduleEngineCheck()
  })

  app.on('window-all-closed', () => {
    for (const job of queue.list()) queue.cancel(job.id)
    app.quit()
  })
}
