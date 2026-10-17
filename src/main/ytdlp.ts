// Ejecución de yt-dlp como proceso hijo: análisis de links, descargas y actualización del motor.
import { app, net, nativeImage } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CookieBrowser, DownloadRequest, MediaInfo } from '@shared/types'
import { engineEnv, ensureEngine, ffmpegDir, jsRuntimePath, setEngineVersion } from './binaries'
import { availableQualities, friendlyError, parseLine, pickThumbnail, postprocessLabel, type ParsedLine } from './parse'
import { analyzeArgs, downloadArgs, isInsideDir, isMediaFile, type EngineOptions } from './ytdlpArgs'

export class UserError extends Error {}

function engineOptions(cookiesBrowser: CookieBrowser): EngineOptions {
  return { ffmpegDir: ffmpegDir(), jsRuntimePath: jsRuntimePath(), cookiesBrowser }
}

/**
 * Cierra yt-dlp y sus hijos (ffmpeg, el runtime JS y el proceso interno de PyInstaller).
 * En macOS se mata el grupo de procesos: yt-dlp se lanza con `detached` para tener uno propio.
 */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined)
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Ejecuta yt-dlp, entregando cada línea de salida (stdout y stderr) a `onLine`, indicando de cuál viene. */
function run(
  args: string[],
  opts: { onLine?: (line: string, source: 'out' | 'err') => void; signal?: AbortSignal; keepStdout?: boolean } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new UserError('Cancelado'))
    const child = spawn(ensureEngine(), args, { env: engineEnv(), windowsHide: true, detached: process.platform !== 'win32' })
    let stdout = ''
    let stderr = ''
    const pending = { out: '', err: '' }
    const feed = (key: 'out' | 'err', chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      if (key === 'out' && opts.keepStdout) stdout += text
      if (key === 'err') stderr = (stderr + text).slice(-20000)
      if (!opts.onLine) return
      const lines = (pending[key] + text).split(/\r?\n/)
      pending[key] = lines.pop() ?? ''
      for (const l of lines) if (l) opts.onLine(l, key)
    }
    child.stdout.on('data', (c: Buffer) => feed('out', c))
    child.stderr.on('data', (c: Buffer) => feed('err', c))
    const onAbort = (): void => killTree(child)
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (err) => reject(new UserError(`No se pudo iniciar el motor de descarga: ${err.message}`)))
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      for (const key of ['out', 'err'] as const) if (pending[key] && opts.onLine) opts.onLine(pending[key], key)
      resolve({ code, stdout, stderr })
    })
  })
}

/** Descarga la miniatura desde el proceso principal y la devuelve como data URL. */
async function fetchThumbnail(url: string | undefined): Promise<string | undefined> {
  if (!url || !/^https?:\/\//i.test(url)) return undefined
  try {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return undefined
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 4 * 1024 * 1024) return undefined
    const img = nativeImage.createFromBuffer(buf)
    if (!img.isEmpty()) {
      const resized = img.getSize().width > 640 ? img.resize({ width: 640, quality: 'good' }) : img
      return `data:image/jpeg;base64,${resized.toJPEG(85).toString('base64')}`
    }
    // WebP u otros formatos: el renderer (Chromium) sí puede mostrarlos.
    const type = res.headers.get('content-type') ?? 'image/webp'
    return type.startsWith('image/') ? `data:${type};base64,${buf.toString('base64')}` : undefined
  } catch {
    return undefined
  }
}

export async function analyze(url: string, cookiesBrowser: CookieBrowser, signal?: AbortSignal): Promise<MediaInfo> {
  const clean = url.trim()
  if (!/^https?:\/\/\S+$/i.test(clean)) throw new UserError('Pega un link válido que empiece con http:// o https://')

  const { code, stdout, stderr } = await run(analyzeArgs(clean, engineOptions(cookiesBrowser)), { keepStdout: true, signal })
  if (signal?.aborted) throw new UserError('Cancelado')
  if (code !== 0) throw new UserError(friendlyError(stderr))

  let info: Record<string, any>
  try {
    info = JSON.parse(stdout)
  } catch {
    throw new UserError('El motor de descarga devolvió una respuesta inesperada.')
  }
  if (info._type === 'playlist') {
    throw new UserError('Ese link es una lista o un perfil. Pega el link de un video en particular.')
  }

  const qualities = availableQualities(info.formats)
  return {
    url: info.webpage_url || clean,
    id: String(info.id ?? ''),
    title: String(info.title || info.fulltitle || 'Sin título'),
    platform: String(info.extractor_key || info.extractor || 'Web'),
    uploader: info.uploader || info.channel || info.creator || undefined,
    duration: typeof info.duration === 'number' ? info.duration : undefined,
    thumbnail: await fetchThumbnail(pickThumbnail(info.thumbnails, info.thumbnail)),
    qualities
  }
}

export interface DownloadCallbacks {
  onProgress(percent: number, stage: string, speed?: number, eta?: number): void
  onStage(stage: string): void
}

/** Carpeta raíz de temporales de descarga (una subcarpeta por descarga). */
const tempRoot = (): string => join(app.getPath('temp'), 'Kapta Descargador')

/** Al iniciar no hay descargas activas: lo que quede en temporales es de una sesión interrumpida. */
export function cleanTempRoot(): void {
  rmSync(tempRoot(), { recursive: true, force: true, maxRetries: 3 })
}

export async function download(
  jobId: string,
  req: DownloadRequest,
  outputDir: string,
  cookiesBrowser: CookieBrowser,
  cb: DownloadCallbacks,
  signal: AbortSignal
): Promise<string> {
  mkdirSync(outputDir, { recursive: true })
  const tempDir = join(tempRoot(), jobId)
  mkdirSync(tempDir, { recursive: true })

  let parts = 1
  let partIndex = -1
  let currentFile = ''
  let finalPath = ''

  const partLabel = (): string => {
    if (req.mode === 'audio') return 'Descargando audio'
    if (parts > 1) return partIndex === 0 ? 'Descargando video' : 'Descargando audio'
    return 'Descargando'
  }
  // El video pesa mucho más que el audio: se reparte la barra 85 / 15.
  const overall = (p: number): number => {
    if (parts < 2) return p
    return partIndex === 0 ? p * 0.85 : 85 + p * 0.15
  }

  const handle = (parsed: ParsedLine): void => {
    switch (parsed.kind) {
      case 'formats':
        parts = parsed.formatId.split('+').length
        break
      case 'progress': {
        const { filename } = parsed.data
        if (filename && filename !== currentFile) {
          currentFile = filename
          partIndex = Math.min(partIndex + 1, parts - 1)
        }
        cb.onProgress(overall(parsed.data.percent), partLabel(), parsed.data.speed, parsed.data.eta)
        break
      }
      case 'postprocess':
        if (parsed.status === 'started' && parsed.postprocessor !== 'MoveFiles') {
          cb.onStage(postprocessLabel(parsed.postprocessor))
        }
        break
      case 'file':
        finalPath = parsed.path.trim()
        break
    }
  }

  try {
    const { code, stderr } = await run(downloadArgs(req, outputDir, tempDir, engineOptions(cookiesBrowser)), {
      signal,
      onLine: (line, source) => {
        const parsed = parseLine(line)
        // La ruta final solo vale si viene de --print (stdout): stderr puede traer texto del sitio.
        if (parsed && !(parsed.kind === 'file' && source !== 'out')) handle(parsed)
      }
    })
    if (signal.aborted) throw new UserError('Cancelado')
    if (code !== 0) throw new UserError(friendlyError(stderr))
    // Nunca se usa (ni se borra) una ruta fuera de la carpeta de descargas.
    if (finalPath && !isInsideDir(finalPath, outputDir)) throw new UserError('La descarga terminó fuera de la carpeta elegida.')
    if (!finalPath || !existsSync(finalPath)) throw new UserError('La descarga terminó pero no se encontró el archivo.')
    if (!isMediaFile(finalPath)) {
      rmSync(finalPath, { force: true })
      throw new UserError('Ese link no es un video ni un audio.')
    }
    return finalPath
  } finally {
    // Pistas sueltas, .part y fragmentos: se van todos con la carpeta de la descarga.
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

/** `yt-dlp -U` sobre la copia en userData. */
export async function updateEngine(): Promise<{ ok: boolean; message: string; version?: string }> {
  const { code, stdout, stderr } = await run(['-U'], { keepStdout: true })
  const out = `${stdout}\n${stderr}`
  const version = await currentVersion()
  if (version) setEngineVersion(version)
  if (code !== 0) {
    return { ok: false, message: 'No se pudo actualizar el motor. Revisa tu conexión e inténtalo de nuevo.', version }
  }
  if (/up to date/i.test(out)) return { ok: true, message: 'El motor ya está en la última versión.', version }
  return { ok: true, message: `Motor actualizado a la versión ${version ?? 'más reciente'}.`, version }
}

async function currentVersion(): Promise<string | undefined> {
  const { code, stdout } = await run(['--version'], { keepStdout: true })
  const v = stdout.trim()
  return code === 0 && v ? v : undefined
}
