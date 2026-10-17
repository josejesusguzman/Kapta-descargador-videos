// Rutas de los binarios incluidos y copia actualizable de yt-dlp.
import { app } from 'electron'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Nombre de un ejecutable en este sistema (`.exe` solo en Windows). */
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name)

/** Carpeta con yt-dlp, ffmpeg, ffprobe (y DLLs en Windows) incluidos en la app. */
export function bundledBinDir(): string {
  const os = process.platform === 'darwin' ? 'mac' : process.platform === 'linux' ? 'linux' : 'win'
  return app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'resources', 'bin', `${os}-${process.arch}`)
}

export const ffmpegDir = (): string => bundledBinDir()
export const ffmpegPath = (): string => join(bundledBinDir(), exe('ffmpeg'))
export const ffprobePath = (): string => join(bundledBinDir(), exe('ffprobe'))

const engineDir = (): string => join(app.getPath('userData'), 'engine')
const engineExe = (): string => join(engineDir(), exe('yt-dlp'))
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
 * de administrador (ni escribir dentro del .app en macOS). Si la versión incluida en la app es más nueva, reemplaza la copia.
 */
export function ensureEngine(): string {
  if (enginePath) return enginePath
  const bundled = join(bundledBinDir(), exe('yt-dlp'))
  try {
    const target = engineExe()
    const bundledV = bundledVersion()
    // Las versiones de yt-dlp son fechas (2026.08.19), así que se comparan como texto.
    if (!existsSync(target) || engineVersion() < bundledV) {
      mkdirSync(engineDir(), { recursive: true })
      copyFileSync(bundled, target)
      if (process.platform !== 'win32') chmodSync(target, 0o755)
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
