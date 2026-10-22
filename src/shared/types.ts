export type Mode = 'video' | 'audio'
export type AudioFormat = 'mp3' | 'm4a' | 'wav'
export type CookieBrowser = 'none' | 'firefox' | 'edge' | 'chrome'

/** Calidades estándar que se ofrecen como chips (en "p", lado corto equivalente a 16:9). */
export const QUALITY_STEPS = [2160, 1440, 1080, 720, 480, 360] as const

/** Calidad inicial: la predeterminada si existe; si no, la más alta por debajo; si no, la más baja. */
export function pickQuality(available: number[], preferred: number): number {
  if (!available.length) return 0
  if (preferred === 0) return available[0]
  return available.find((q) => q <= preferred) ?? available[available.length - 1]
}

export interface MediaInfo {
  url: string
  id: string
  title: string
  platform: string
  uploader?: string
  duration?: number
  /** Miniatura ya descargada por el proceso principal, como data URL. */
  thumbnail?: string
  /** Calidades disponibles (de QUALITY_STEPS), de mayor a menor. Vacío si solo hay audio. */
  qualities: number[]
}

export interface DownloadRequest {
  url: string
  title: string
  platform: string
  thumbnail?: string
  mode: Mode
  /** Calidad máxima en "p" (2160, 1080…). 0 = la mejor disponible. */
  quality: number
  audioFormat: AudioFormat
  editorCompatible: boolean
  /** Carpeta de destino elegida al poner la descarga en la cola. */
  outputDir?: string
}

export type JobStatus = 'queued' | 'downloading' | 'processing' | 'done' | 'error' | 'canceled'

export interface Job {
  id: string
  request: DownloadRequest
  status: JobStatus
  /** 0–100 de la etapa actual. */
  percent: number
  /** Texto corto de la etapa: "Descargando video", "Optimizando para edición"… */
  stage: string
  speed?: number
  eta?: number
  filePath?: string
  error?: string
  /** Solo Android: el sitio pidió iniciar sesión (clave como 'youtube'); la UI ofrece hacerlo y reintentar. */
  loginSite?: string
  createdAt: number
}

export interface HistoryItem {
  id: string
  title: string
  platform: string
  mode: Mode
  filePath: string
  thumbnail?: string
  size?: number
  createdAt: number
  /** Calculado al listar: false si el archivo se movió o se borró. */
  exists?: boolean
}

export interface Settings {
  outputDir: string
  defaultMode: Mode
  defaultQuality: number
  audioFormat: AudioFormat
  editorCompatible: boolean
  cookiesBrowser: CookieBrowser
  autoUpdateEngine: boolean
  lastEngineCheck: number
  onboardingDone: boolean
  /** Solo macOS: ícono en la barra de menú; al cerrar la ventana la app sigue ahí. */
  menuBar: boolean
  /** Solo macOS: "ruta@versión" con la que se registró el ítem de inicio ('' si no). */
  loginItem: string
}

/** Órdenes que el menú de macOS (barra de menú o menú de la app) envía a la ventana. */
export type AppCommand = { type: 'settings' } | { type: 'analyze'; url: string }

export interface EngineInfo {
  version: string
  updating: boolean
}

export interface EngineUpdateResult {
  ok: boolean
  message: string
  version?: string
}

/** Error de `analyze` cuando el sitio pide iniciar sesión (solo Android). */
export interface LoginRequiredError extends Error {
  loginSite?: string
}

/**
 * API expuesta al renderer: el preload en escritorio (window.api) y src/mobile/api.ts en Android.
 * Los métodos opcionales solo existen donde tienen sentido (en Android no hay carpetas ni arrastre).
 */
export interface KaptaDescargadorApi {
  /** Sistema operativo (process.platform): 'win32', 'darwin'…, o 'android'. */
  platform: string
  analyze(url: string): Promise<MediaInfo>
  addJob(request: DownloadRequest): Promise<Job>
  cancelJob(id: string): Promise<void>
  retryJob(id: string): Promise<void>
  dismissJob(id: string): Promise<void>
  listJobs(): Promise<Job[]>
  onJobUpdate(callback: (job: Job) => void): () => void
  onJobRemoved(callback: (id: string) => void): () => void

  listHistory(): Promise<HistoryItem[]>
  removeHistory(id: string): Promise<void>
  onHistoryChange(callback: () => void): () => void

  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  chooseFolder?(): Promise<string | null>

  showInFolder?(filePath: string): Promise<void>
  openFile(filePath: string): Promise<void>
  openOutputDir?(): Promise<void>
  startDrag?(filePath: string): void

  readClipboardUrl(): Promise<string | null>
  onCommand(callback: (command: AppCommand) => void): () => void
  /** Solo macOS: abrir la app al iniciar sesión. */
  getOpenAtLogin(): Promise<boolean>
  setOpenAtLogin(enabled: boolean): Promise<boolean>
  engineInfo(): Promise<EngineInfo>
  updateEngine(): Promise<EngineUpdateResult>
  appVersion(): Promise<string>

  /** Solo Android: abre el inicio de sesión del sitio; true si quedó una sesión guardada. */
  login?(site: string): Promise<boolean>
  logout?(site: string): Promise<void>
  /** Sitios con sesión guardada. */
  listLogins?(): Promise<string[]>
}
