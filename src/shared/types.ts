export type Mode = 'video' | 'audio'
export type AudioFormat = 'mp3' | 'm4a' | 'wav'
export type CookieBrowser = 'none' | 'firefox' | 'edge' | 'chrome'

/** Calidades estándar que se ofrecen como chips (en "p", lado corto equivalente a 16:9). */
export const QUALITY_STEPS = [2160, 1440, 1080, 720, 480, 360] as const

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
}

export interface EngineInfo {
  version: string
  updating: boolean
}

export interface EngineUpdateResult {
  ok: boolean
  message: string
  version?: string
}

/** API expuesta al renderer por el preload (window.api). */
export interface DescargadorApi {
  /** Sistema operativo (process.platform): 'win32', 'darwin'… */
  platform: string
  analyze(url: string): Promise<MediaInfo>
  addJob(request: DownloadRequest): Promise<Job>
  cancelJob(id: string): Promise<void>
  retryJob(id: string): Promise<void>
  dismissJob(id: string): Promise<void>
  listJobs(): Promise<Job[]>
  onJobUpdate(callback: (job: Job) => void): () => void

  listHistory(): Promise<HistoryItem[]>
  removeHistory(id: string): Promise<void>
  onHistoryChange(callback: () => void): () => void

  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  chooseFolder(): Promise<string | null>

  showInFolder(filePath: string): Promise<void>
  openFile(filePath: string): Promise<void>
  openOutputDir(): Promise<void>
  startDrag(filePath: string): void

  readClipboardUrl(): Promise<string | null>
  engineInfo(): Promise<EngineInfo>
  updateEngine(): Promise<EngineUpdateResult>
  appVersion(): Promise<string>
}
