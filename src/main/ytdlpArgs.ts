// Construcción de argumentos de yt-dlp. Módulo puro (sin Electron) para poder probarlo.
import { posix, win32 } from 'node:path'
import type { CookieBrowser, DownloadRequest } from '@shared/types'

export interface EngineOptions {
  ffmpegDir: string
  /** Ejecutable que yt-dlp usará como runtime JS (Electron en modo Node). */
  jsRuntimePath: string
  cookiesBrowser: CookieBrowser
}

/** Marcadores que la app busca en la salida de yt-dlp. */
export const MARK = {
  progress: '@@P',
  postprocess: '@@S',
  file: '@@F',
  formats: '@@N'
} as const

/** Extensiones de video y audio aceptadas. Un link directo a otro tipo de archivo (.exe, .lnk) se rechaza. */
const MEDIA_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'flv', '3gp', 'ts',
  'mp3', 'm4a', 'aac', 'wav', 'opus', 'ogg', 'oga', 'flac', 'weba'
])

export function isMediaFile(filePath: string): boolean {
  const m = /\.([^.\\/]+)$/.exec(filePath)
  return !!m && MEDIA_EXTENSIONS.has(m[1].toLowerCase())
}

/** `filePath` está dentro de `dir` (o en una subcarpeta). Rutas de Windows: sin distinguir mayúsculas. */
export function isInsideDir(
  filePath: string,
  dir: string,
  paths: typeof win32 = process.platform === 'win32' ? win32 : posix
): boolean {
  const rel = paths.relative(paths.resolve(dir), paths.resolve(filePath))
  return !!rel && !rel.startsWith('..') && !paths.isAbsolute(rel)
}

export function commonArgs(opts: EngineOptions): string[] {
  const args = [
    '--encoding',
    'utf-8',
    '--no-playlist',
    '--no-warnings',
    '--js-runtimes',
    `node:${opts.jsRuntimePath}`,
    '--ffmpeg-location',
    opts.ffmpegDir
  ]
  if (opts.cookiesBrowser !== 'none') args.push('--cookies-from-browser', opts.cookiesBrowser)
  return args
}

export function analyzeArgs(url: string, opts: EngineOptions): string[] {
  return ['-J', '--flat-playlist', ...commonArgs(opts), '--', url]
}

/** Selección de formato según modo y calidad. */
export function formatArgs(req: Pick<DownloadRequest, 'mode' | 'quality' | 'audioFormat' | 'editorCompatible'>): string[] {
  if (req.mode === 'audio') {
    const args = ['-f', 'ba/b', '-x', '--audio-format', req.audioFormat, '--audio-quality', '0']
    // Para M4A, preferir AAC de origen y así evitar recodificar.
    if (req.audioFormat === 'm4a') args.push('-S', 'acodec:aac')
    return args
  }

  // "res" en -S usa el lado corto del video, así que también funciona con videos verticales
  // (TikTok, Shorts). "vcodec:h264" prefiere H.264 cuando existe en esa resolución.
  const sort = [req.quality > 0 ? `res:${req.quality}` : 'res']
  if (req.editorCompatible) sort.push('hdr:SDR', 'vcodec:h264')
  sort.push('acodec:aac')
  return ['-f', 'bv*+ba/b', '-S', sort.join(','), '--merge-output-format', 'mp4']
}

/**
 * Nombre del archivo. En video incluye la calidad pedida: si no, al bajar el mismo video en otra
 * calidad, yt-dlp vería el archivo anterior como "ya descargado" y devolvería ese.
 */
export function outputTemplate(req: Pick<DownloadRequest, 'mode' | 'quality'>): string {
  const base = '%(title).150B [%(id)s]'
  if (req.mode === 'audio' || !req.quality) return `${base}.%(ext)s`
  return `${base} ${req.quality >= 2160 ? '4K' : `${req.quality}p`}.%(ext)s`
}

/**
 * `tempDir` es una carpeta propia de cada descarga para los archivos intermedios (.part, pistas sueltas):
 * así dos descargas del mismo video no chocan y cancelar es borrar esa carpeta.
 */
export function downloadArgs(req: DownloadRequest, outputDir: string, tempDir: string, opts: EngineOptions): string[] {
  return [
    ...commonArgs(opts),
    '--quiet',
    '--progress',
    '--newline',
    '--progress-template',
    `download:${MARK.progress}%(progress)j`,
    '--progress-template',
    `postprocess:${MARK.postprocess}%(progress)j`,
    '--print',
    `before_dl:${MARK.formats}%(format_id)s`,
    '--print',
    `after_move:${MARK.file}%(filepath)s`,
    ...formatArgs(req),
    '-P',
    outputDir,
    '-P',
    `temp:${tempDir}`,
    '-o',
    outputTemplate(req),
    '--windows-filenames',
    '--no-mtime',
    '--',
    req.url
  ]
}
