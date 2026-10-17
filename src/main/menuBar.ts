// Solo macOS: ícono en la barra de menú (descargar el link copiado sin abrir la ventana, progreso, últimas
// descargas), menú de la app en español y abrir al iniciar sesión. Windows y Linux no usan este módulo.
import { app, clipboard, dialog, Menu, nativeImage, Notification, shell, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import { resolve } from 'node:path'
import type { AppCommand, DownloadRequest, HistoryItem, Job, Mode } from '@shared/types'
import { pickQuality } from '@shared/types'
import type { JobQueue } from './queue'
import { getSettings, historyThumb, recentHistory, updateSettings } from './store'
import { analyze, UserError } from './ytdlp'
import { isMediaFile } from './ytdlpArgs'

export interface MenuBarContext {
  queue: JobQueue
  iconPath(name: string): string
  /** Abre (o crea) la ventana y, si se indica, le pasa una orden. */
  showWindow(command?: AppCommand): void
  addJob(request: DownloadRequest): void
  openOutputDir(): void
  hasFocusedWindow(): boolean
}

const RECENT = 5
const LOGIN_ITEMS_PANE = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'
/** UUID fijo: macOS recuerda dónde puso el usuario el ícono (⌘ + arrastrar) entre sesiones. */
const TRAY_GUID = '3b0f6a52-6c1e-4a59-9a43-6f2d8c1e7b10'

let ctx: MenuBarContext
let tray: Tray | null = null
let lastTitle = ''
let lastTooltip = ''
/** El menú se arma de forma asíncrona: evita abrir dos si se hace clic dos veces seguidas. */
let building = false
/** Links que se analizan desde el menú (clave `modo url`): evita duplicarlos y se muestran mientras tanto. */
const pending = new Map<string, string>()

const isActive = (j: Job): boolean => j.status === 'downloading' || j.status === 'processing'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
/**
 * Texto variable (títulos, links, errores) para una etiqueta de menú: en una línea, recortado sin partir emojis y
 * con "&" duplicado, porque macOS borra un "&" suelto de las etiquetas.
 */
function menuText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  const parts = Array.from(graphemes.segment(clean), (g) => g.segment)
  const short = parts.length > max ? `${parts.slice(0, max - 1).join('').trimEnd()}…` : clean
  return short.replace(/&/g, '&&')
}
const shortUrl = (url: string): string => menuText(url.replace(/^https?:\/\/(www\.)?/i, ''), 42)

const [osMajor = 0] = process.getSystemVersion().split('.').map(Number)
/** Título de sección: nativo desde macOS 14; antes, una fila desactivada. */
const header = (label: string): MenuItemConstructorOptions =>
  osMajor >= 14 ? { type: 'header', label } : { label, enabled: false }

/** Miniatura recortada a 28 × 16 pt (todas las filas del mismo ancho), con versión Retina. */
const thumbCache = new Map<string, NativeImage | null>()
function thumbIcon(item: HistoryItem): NativeImage | undefined {
  if (!thumbCache.has(item.id)) {
    let icon: NativeImage | null = null
    const src = historyThumb(item)
    if (src) {
      const { width: w, height: h } = src.getSize()
      const cw = Math.min(w, Math.round((h * 28) / 16))
      const ch = Math.min(h, Math.round((w * 16) / 28))
      const box = src.crop({ x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), width: cw, height: ch })
      icon = nativeImage.createFromBuffer(box.resize({ width: 56, height: 32, quality: 'best' }).toPNG(), { scaleFactor: 2 })
      icon.addRepresentation({ scaleFactor: 1, buffer: box.resize({ width: 28, height: 16, quality: 'best' }).toPNG() })
    }
    thumbCache.set(item.id, icon)
  }
  return thumbCache.get(item.id) ?? undefined
}

function qualityName(q: number): string {
  if (q === 0) return 'mejor calidad'
  if (q >= 2160) return '4K'
  if (q === 1440) return '2K'
  return `${q}p`
}

function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, silent: true })
  if (onClick) n.on('click', onClick)
  n.show()
}

/** Mismo criterio que la ventana: el link del portapapeles, si es uno. */
async function clipboardUrl(): Promise<string | null> {
  const text = (await clipboard.readText()).trim()
  return /^https?:\/\/\S+$/i.test(text) && text.length < 2048 ? text : null
}

/** Analiza el link y lo pone en la cola con los ajustes predeterminados, sin abrir la ventana. */
async function quickDownload(url: string, mode: Mode): Promise<void> {
  const key = `${mode} ${url}`
  if (pending.has(key)) return
  pending.set(key, url)
  refresh()
  try {
    const s = getSettings()
    const media = await analyze(url, s.cookiesBrowser)
    pending.delete(key)
    const audio = mode === 'audio' || !media.qualities.length
    ctx.addJob({
      url: media.url,
      title: media.title,
      platform: media.platform,
      thumbnail: media.thumbnail,
      mode: audio ? 'audio' : 'video',
      quality: audio ? 0 : pickQuality(media.qualities, s.defaultQuality),
      audioFormat: s.audioFormat,
      editorCompatible: s.editorCompatible,
      outputDir: s.outputDir
    })
  } catch (err) {
    const message = err instanceof UserError ? err.message : `Error inesperado: ${(err as Error).message}`
    notify('No se pudo descargar', message, () => ctx.showWindow({ type: 'analyze', url }))
  } finally {
    pending.delete(key)
    refresh()
  }
}

function jobItem(job: Job): MenuItemConstructorOptions {
  const title = menuText(job.request.title, 44)
  const cancel: MenuItemConstructorOptions = { label: 'Cancelar descarga', click: () => ctx.queue.cancel(job.id) }
  if (job.status === 'error') {
    return {
      label: `⚠︎ ${title}`,
      toolTip: job.error,
      submenu: [
        { label: menuText(job.error ?? 'Error', 70), enabled: false },
        { type: 'separator' },
        { label: 'Reintentar', click: () => ctx.queue.retry(job.id) },
        { label: 'Quitar de la lista', click: () => ctx.queue.dismiss(job.id) }
      ]
    }
  }
  if (job.status === 'queued') return { label: `En espera · ${title}`, toolTip: job.request.title, submenu: [cancel] }
  const indeterminate = job.status === 'processing' && job.stage !== 'Optimizando para edición'
  return {
    label: indeterminate ? `${job.stage} · ${title}` : `${Math.floor(job.percent)}% · ${title}`,
    toolTip: job.request.title,
    submenu: [{ label: job.stage, enabled: false }, { type: 'separator' }, cancel]
  }
}

async function buildMenu(): Promise<Menu> {
  const s = getSettings()
  const url = await clipboardUrl().catch(() => null)
  const items: MenuItemConstructorOptions[] = []

  if (url) {
    items.push(
      header(`Link copiado: ${shortUrl(url)}`),
      { label: `Descargar video (${qualityName(s.defaultQuality)})`, click: () => void quickDownload(url, 'video') },
      { label: `Descargar solo audio (${s.audioFormat.toUpperCase()})`, click: () => void quickDownload(url, 'audio') },
      { label: 'Elegir calidad y formato…', click: () => ctx.showWindow({ type: 'analyze', url }) }
    )
  } else {
    items.push({ label: 'Copia un link para descargarlo desde aquí', enabled: false })
  }

  const jobs = ctx.queue.list().filter((j) => isActive(j) || j.status === 'queued' || j.status === 'error')
  if (pending.size || jobs.length) {
    items.push({ type: 'separator' }, header('Descargas'))
    for (const u of new Set(pending.values())) items.push({ label: `Buscando ${shortUrl(u)}…`, enabled: false })
    items.push(...jobs.map(jobItem))
    if (jobs.filter((j) => j.status !== 'error').length > 1) {
      items.push({
        label: 'Cancelar todas',
        click: () => {
          for (const j of jobs) if (j.status !== 'error') ctx.queue.cancel(j.id)
        }
      })
    }
  }

  const recent = recentHistory(RECENT)
  if (recent.length) {
    items.push({ type: 'separator' }, header('Recientes'))
    for (const h of recent) {
      items.push({
        label: menuText(h.title, 44),
        toolTip: h.title,
        icon: thumbIcon(h),
        submenu: [
          { label: 'Mostrar en Finder', click: () => shell.showItemInFolder(h.filePath) },
          // Igual que en la ventana: openPath solo con video o audio, nunca ejecutables.
          { label: 'Abrir', enabled: isMediaFile(h.filePath), click: () => void shell.openPath(h.filePath) },
          { type: 'separator' },
          { role: 'shareMenu', label: 'Compartir', sharingItem: { filePaths: [h.filePath] } }
        ]
      })
    }
  }

  items.push(
    { type: 'separator' },
    { label: 'Abrir carpeta de descargas', click: () => ctx.openOutputDir() },
    { label: 'Mostrar Descargador', click: () => ctx.showWindow() },
    { type: 'separator' },
    { label: 'Abrir al iniciar sesión', type: 'checkbox', checked: getOpenAtLogin(), click: (item) => setOpenAtLogin(item.checked) },
    { label: 'Ajustes…', accelerator: 'Cmd+,', click: () => ctx.showWindow({ type: 'settings' }) },
    { type: 'separator' },
    { label: 'Salir de Descargador', accelerator: 'Cmd+Q', click: () => app.quit() }
  )
  return Menu.buildFromTemplate(items)
}

/** Progreso promedio junto al ícono y resumen en el tooltip. */
function refresh(): void {
  if (!tray) return
  const jobs = ctx.queue.list()
  const active = jobs.filter(isActive)
  const waiting = pending.size + jobs.filter((j) => j.status === 'queued').length
  let title = ''
  if (active.length) title = `${Math.floor(active.reduce((sum, j) => sum + j.percent, 0) / active.length)}%`
  else if (waiting) title = '…'
  if (title !== lastTitle) {
    lastTitle = title
    tray.setTitle(title && ` ${title}`, { fontType: 'monospacedDigit' })
  }
  const count = active.length + waiting
  const tooltip = count ? `Descargador · ${count} ${count === 1 ? 'descarga' : 'descargas'} en curso` : 'Descargador'
  if (tooltip !== lastTooltip) {
    lastTooltip = tooltip
    tray.setToolTip(tooltip)
  }
}

/** El menú se arma en cada clic: así refleja el portapapeles y las descargas de ese momento. */
async function openMenu(): Promise<void> {
  if (building || !tray) return
  building = true
  try {
    const menu = await buildMenu()
    if (tray && !tray.isDestroyed()) tray.popUpContextMenu(menu)
  } finally {
    building = false
  }
}

function createTray(): void {
  // trayTemplate.png carga también la versión @2x y, por el sufijo "Template", macOS la tiñe según el tema.
  const icon = nativeImage.createFromPath(ctx.iconPath('trayTemplate.png'))
  if (icon.isEmpty()) return
  tray = new Tray(icon, TRAY_GUID)
  // Sin esto, un segundo clic rápido cuenta como doble clic y el menú no se abre.
  tray.setIgnoreDoubleClickEvents(true)
  lastTitle = ''
  lastTooltip = ''
  tray.on('click', () => void openMenu())
  tray.on('right-click', () => void openMenu())
  refresh()
}

/** Crea o quita el ícono según el ajuste. */
export function syncMenuBar(): void {
  const enabled = getSettings().menuBar
  if (enabled && !tray) createTray()
  if (!enabled && tray) {
    // Solo destroy() quita el ícono; Electron lo mantiene vivo aunque no haya referencias.
    tray.destroy()
    tray = null
  }
}

/** Con el ícono activo, cerrar la ventana no cierra la app: sigue en la barra de menú. */
export function livesInMenuBar(): boolean {
  return tray !== null
}

let closeHintShown = false

/** Sin el ícono del Dock no es obvio que la app siga abierta: se avisa una vez por sesión si hay descargas. */
export function windowClosedToMenuBar(): void {
  const busy = ctx.queue.list().some((j) => isActive(j) || j.status === 'queued')
  if (closeHintShown || !busy) return
  closeHintShown = true
  notify('Descargador sigue en la barra de menú', 'Tus descargas continúan. Ábrelo desde el ícono de arriba.')
}

/** /Applications/Descargador.app */
const bundlePath = (): string => resolve(process.execPath, '..', '..', '..')
const loginItemId = (): string => `${bundlePath()}@${app.getVersion()}`

function ask(message: string, detail: string, action: string): boolean {
  app.focus({ steal: true })
  return dialog.showMessageBoxSync({ type: 'info', buttons: [action, 'Ahora no'], defaultId: 0, cancelId: 1, message, detail }) === 0
}

export function getOpenAtLogin(): boolean {
  return app.getLoginItemSettings().openAtLogin
}

export function setOpenAtLogin(enabled: boolean): boolean {
  // Registrarla desde el DMG o desde una copia temporal de macOS apuntaría a una ruta que luego desaparece.
  if (enabled && !app.isInApplicationsFolder()) {
    ask(
      'Primero mueve Descargador a Aplicaciones',
      'Para abrirse al iniciar sesión, la app tiene que estar en la carpeta Aplicaciones. Arrástrala ahí desde el DMG y ábrela desde Aplicaciones.',
      'Entendido'
    )
    return getOpenAtLogin()
  }
  app.setLoginItemSettings({ openAtLogin: enabled })
  const on = getOpenAtLogin()
  updateSettings({ loginItem: on ? loginItemId() : '' })
  // macOS no da error al fallar: si no quedó activa, el usuario la desactivó antes en Ajustes del Sistema
  // (o el sistema pide aprobarla) y solo se puede activar ahí.
  if (enabled && !on) {
    const open = ask(
      'Permite que Descargador se abra al iniciar sesión',
      'Actívalo en Ajustes del Sistema → General → Ítems de inicio.',
      'Abrir Ajustes del Sistema'
    )
    if (open) void shell.openExternal(LOGIN_ITEMS_PANE)
  }
  return on
}

/**
 * Con firma ad-hoc cada versión tiene otra firma y macOS puede dejar de abrir la nueva al iniciar sesión: tras
 * actualizar (o mover la app) se vuelve a registrar. Si el usuario la desactivó en Ajustes del Sistema, se respeta.
 */
function refreshLoginItem(): void {
  const saved = getSettings().loginItem
  if (!saved || saved === loginItemId()) return
  if (!getOpenAtLogin()) return void updateSettings({ loginItem: '' })
  app.setLoginItemSettings({ openAtLogin: false })
  app.setLoginItemSettings({ openAtLogin: true })
  updateSettings({ loginItem: getOpenAtLogin() ? loginItemId() : '' })
}

/** La app se abrió sola al iniciar sesión: arranca solo en la barra de menú. */
export function openedAtLogin(): boolean {
  return app.getLoginItemSettings().wasOpenedAtLogin
}

/** Menú de la app en español, con Ajustes (⌘,) y Cerrar ventana (⌘W). */
function appMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about', label: `Acerca de ${app.name}` },
        { type: 'separator' },
        { label: 'Ajustes…', accelerator: 'Cmd+,', click: () => ctx.showWindow({ type: 'settings' }) },
        { type: 'separator' },
        { role: 'services', label: 'Servicios' },
        { type: 'separator' },
        { role: 'hide', label: `Ocultar ${app.name}` },
        { role: 'hideOthers', label: 'Ocultar otros' },
        { role: 'unhide', label: 'Mostrar todo' },
        { type: 'separator' },
        { role: 'quit', label: `Salir de ${app.name}` }
      ]
    },
    {
      label: 'Archivo',
      submenu: [
        { label: 'Abrir carpeta de descargas', accelerator: 'Cmd+Shift+O', click: () => ctx.openOutputDir() },
        { type: 'separator' },
        { role: 'close', label: 'Cerrar ventana' }
      ]
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'pasteAndMatchStyle', label: 'Pegar y adaptar estilo' },
        { role: 'delete', label: 'Eliminar' },
        { role: 'selectAll', label: 'Seleccionar todo' }
      ]
    },
    {
      role: 'windowMenu',
      label: 'Ventana',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        { type: 'separator' },
        { role: 'front', label: 'Traer todo al frente' }
      ]
    }
  ])
}

export function initMenuBar(context: MenuBarContext): void {
  ctx = context
  Menu.setApplicationMenu(appMenu())
  refreshLoginItem()
  ctx.queue.on('update', refresh)
  // Con la ventana cerrada, un error no se vería: se avisa.
  ctx.queue.on('failed', (job) => {
    if (!ctx.hasFocusedWindow()) notify('No se pudo descargar', `${job.request.title}: ${job.error ?? 'Error'}`, () => ctx.showWindow())
  })
  syncMenuBar()
}
