// Rutas de los binarios incluidos y copia actualizable de yt-dlp.
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Carpeta con yt-dlp, ffmpeg, ffprobe y DLLs incluidos en la app. */
export function bundledBinDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'resources', 'bin', process.arch)
}

export const ffmpegDir = (): string => bundledBinDir()
export const ffmpegPath = (): string => join(bundledBinDir(), 'ffmpeg.exe')
export const ffprobePath = (): string => join(bundledBinDir(), 'ffprobe.exe')

const engineDir = (): string => join(app.getPath('userData'), 'engine')
const engineExe = (): string => join(engineDir(), 'yt-dlp.exe')
const engineVersionFile = (): string => join(engineDir(), 'version.txt')

function bundledVersion(): string {
  try {
    return JSON.parse(readFileSync(join(bundledBinDir(), 'versions.json'), 'utf8')).ytdlp ?? '0'
  } catch {
    return '0'
  }
}

export function engineVersion(): string {
  try {
    return readFileSync(engineVersionFile(), 'utf8').trim()
  } catch {
    return bundledVersion()
  }
}

export function setEngineVersion(version: string): void {
  writeFileSync(engineVersionFile(), version)
}

let enginePath: string | null = null

/**
 * yt-dlp se copia a userData/engine para que `yt-dlp -U` pueda actualizarlo sin permisos
 * de administrador. Si la versión incluida en la app es más nueva, reemplaza la copia.
 */
export function ensureEngine(): string {
  if (enginePath) return enginePath
  const bundled = join(bundledBinDir(), 'yt-dlp.exe')
  try {
    const target = engineExe()
    const bundledV = bundledVersion()
    // Las versiones de yt-dlp son fechas (2026.08.19), así que se comparan como texto.
    if (!existsSync(target) || engineVersion() < bundledV) {
      mkdirSync(engineDir(), { recursive: true })
      copyFileSync(bundled, target)
      setEngineVersion(bundledV)
    }
    enginePath = target
  } catch {
    enginePath = bundled
  }
  return enginePath
}

/** yt-dlp usa el propio ejecutable de la app como runtime JS (Node) para los retos de YouTube. */
export const jsRuntimePath = (): string => process.execPath

export function engineEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8'
  }
}
