// Ajustes e historial, guardados como JSON en la carpeta de datos de la app.
import { app, nativeImage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { AudioFormat, CookieBrowser, HistoryItem, Mode, Settings } from '@shared/types'
import { QUALITY_STEPS } from '@shared/types'

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Escritura atómica: primero a .tmp y luego renombrar, para no corromper el archivo si la app se cierra. */
function writeJson(file: string, data: unknown): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, file)
}

// ---------- Ajustes ----------

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

function defaults(): Settings {
  return {
    outputDir: join(app.getPath('videos'), 'Descargador'),
    defaultMode: 'video',
    defaultQuality: 1080,
    audioFormat: 'mp3',
    editorCompatible: true,
    cookiesBrowser: 'none',
    autoUpdateEngine: true,
    lastEngineCheck: 0,
    onboardingDone: false,
    menuBar: true,
    loginItem: ''
  }
}

let settings: Settings | null = null

export function getSettings(): Settings {
  if (!settings) settings = { ...defaults(), ...readJson<Partial<Settings>>(settingsFile(), {}) }
  return settings
}

const MODES: Mode[] = ['video', 'audio']
const AUDIO: AudioFormat[] = ['mp3', 'm4a', 'wav']
const BROWSERS: CookieBrowser[] = ['none', 'firefox', 'edge', 'chrome']

/** Aplica solo los campos válidos; el renderer no es de confianza total. */
export function updateSettings(patch: Partial<Settings>): Settings {
  const s = { ...getSettings() }
  if (typeof patch.outputDir === 'string' && isAbsolute(patch.outputDir)) s.outputDir = patch.outputDir
  if (patch.defaultMode && MODES.includes(patch.defaultMode)) s.defaultMode = patch.defaultMode
  if (patch.defaultQuality === 0 || QUALITY_STEPS.includes(patch.defaultQuality as never))
    s.defaultQuality = patch.defaultQuality as number
  if (patch.audioFormat && AUDIO.includes(patch.audioFormat)) s.audioFormat = patch.audioFormat
  if (typeof patch.editorCompatible === 'boolean') s.editorCompatible = patch.editorCompatible
  if (patch.cookiesBrowser && BROWSERS.includes(patch.cookiesBrowser)) s.cookiesBrowser = patch.cookiesBrowser
  if (typeof patch.autoUpdateEngine === 'boolean') s.autoUpdateEngine = patch.autoUpdateEngine
  if (typeof patch.lastEngineCheck === 'number') s.lastEngineCheck = patch.lastEngineCheck
  if (typeof patch.onboardingDone === 'boolean') s.onboardingDone = patch.onboardingDone
  if (typeof patch.menuBar === 'boolean') s.menuBar = patch.menuBar
  if (typeof patch.loginItem === 'string') s.loginItem = patch.loginItem
  settings = s
  writeJson(settingsFile(), s)
  return s
}

// ---------- Historial ----------

const MAX_HISTORY = 500
const historyFile = (): string => join(app.getPath('userData'), 'history.json')
const thumbsDir = (): string => join(app.getPath('userData'), 'thumbs')

let history: HistoryItem[] | null = null

function loadHistory(): HistoryItem[] {
  if (!history) history = readJson<HistoryItem[]>(historyFile(), [])
  return history
}

function thumbPath(id: string): string {
  return join(thumbsDir(), `${id}.jpg`)
}

/** Guarda la miniatura como JPG pequeño. Las que nativeImage no puede leer (WebP) se omiten. */
function saveThumb(id: string, dataUrl: string | undefined): boolean {
  if (!dataUrl) return false
  const img = nativeImage.createFromDataURL(dataUrl)
  if (img.isEmpty()) return false
  mkdirSync(thumbsDir(), { recursive: true })
  const small = img.getSize().width > 320 ? img.resize({ width: 320, quality: 'good' }) : img
  writeFileSync(thumbPath(id), small.toJPEG(82))
  return true
}

export function addHistory(item: Omit<HistoryItem, 'thumbnail' | 'exists'>, thumbDataUrl?: string): void {
  const list = loadHistory()
  // Si se volvió a bajar al mismo archivo, la entrada vieja apunta a lo mismo: se reemplaza.
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].filePath === item.filePath) rmSync(thumbPath(list.splice(i, 1)[0].id), { force: true })
  }
  const hasThumb = saveThumb(item.id, thumbDataUrl)
  list.unshift({ ...item, thumbnail: hasThumb ? `${item.id}.jpg` : undefined })
  for (const old of list.splice(MAX_HISTORY)) rmSync(thumbPath(old.id), { force: true })
  writeJson(historyFile(), list)
}

export function listHistory(): HistoryItem[] {
  return loadHistory().map((h) => {
    let thumbnail: string | undefined
    if (h.thumbnail) {
      try {
        thumbnail = `data:image/jpeg;base64,${readFileSync(thumbPath(h.id)).toString('base64')}`
      } catch {
        thumbnail = undefined
      }
    }
    return { ...h, thumbnail, exists: existsSync(h.filePath) }
  })
}

export function removeHistory(id: string): void {
  const list = loadHistory()
  const i = list.findIndex((h) => h.id === id)
  if (i >= 0) {
    list.splice(i, 1)
    rmSync(thumbPath(id), { force: true })
    writeJson(historyFile(), list)
  }
}

/** Últimas descargas cuyo archivo sigue en su lugar (sin leer las miniaturas, para el menú de macOS). */
export function recentHistory(limit: number): HistoryItem[] {
  const recent: HistoryItem[] = []
  for (const h of loadHistory()) {
    if (recent.length >= limit) break
    if (existsSync(h.filePath)) recent.push(h)
  }
  return recent
}

/** Miniatura de una entrada del historial como imagen nativa, o undefined si no tiene. */
export function historyThumb(item: HistoryItem): Electron.NativeImage | undefined {
  if (!item.thumbnail) return undefined
  const img = nativeImage.createFromPath(thumbPath(item.id))
  return img.isEmpty() ? undefined : img
}

export function historyHas(filePath: string): boolean {
  return loadHistory().some((h) => h.filePath === filePath)
}

/** Ícono para arrastrar un archivo: su miniatura si existe, si no el ícono de la app. */
export function dragIconFor(filePath: string, fallback: Electron.NativeImage): Electron.NativeImage {
  const h = loadHistory().find((x) => x.filePath === filePath)
  if (h?.thumbnail) {
    const img = nativeImage.createFromPath(thumbPath(h.id))
    if (!img.isEmpty()) return img.resize({ width: 96, quality: 'good' })
  }
  return fallback
}

export function fileSize(path: string): number | undefined {
  try {
    return statSync(path).size
  } catch {
    return undefined
  }
}
