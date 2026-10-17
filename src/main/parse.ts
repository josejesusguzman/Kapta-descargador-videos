// Interpretación de la salida de yt-dlp. Módulo puro (sin Electron) para poder probarlo.
import { QUALITY_STEPS } from '@shared/types'
import { MARK } from './ytdlpArgs'

export interface ProgressData {
  status: string
  percent: number
  speed?: number
  eta?: number
  filename?: string
  tmpfilename?: string
}

export type ParsedLine =
  | { kind: 'progress'; data: ProgressData }
  | { kind: 'postprocess'; status: string; postprocessor: string }
  | { kind: 'file'; path: string }
  | { kind: 'formats'; formatId: string }

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export function parseLine(raw: string): ParsedLine | null {
  const line = raw.trim()
  try {
    if (line.startsWith(MARK.progress)) {
      const p = JSON.parse(line.slice(MARK.progress.length))
      const total = num(p.total_bytes) ?? num(p.total_bytes_estimate)
      const done = num(p.downloaded_bytes)
      let percent = num(p._percent)
      if (percent === undefined && total && done !== undefined) percent = (done / total) * 100
      if (percent === undefined && num(p.fragment_count)) {
        percent = ((num(p.fragment_index) ?? 0) / p.fragment_count) * 100
      }
      if (p.status === 'finished') percent = 100
      return {
        kind: 'progress',
        data: {
          status: String(p.status ?? 'downloading'),
          percent: Math.max(0, Math.min(100, percent ?? 0)),
          speed: num(p.speed),
          eta: num(p.eta),
          filename: typeof p.filename === 'string' ? p.filename : undefined,
          tmpfilename: typeof p.tmpfilename === 'string' ? p.tmpfilename : undefined
        }
      }
    }
    if (line.startsWith(MARK.postprocess)) {
      const p = JSON.parse(line.slice(MARK.postprocess.length))
      return { kind: 'postprocess', status: String(p.status ?? ''), postprocessor: String(p.postprocessor ?? '') }
    }
  } catch {
    return null
  }
  if (line.startsWith(MARK.file)) return { kind: 'file', path: line.slice(MARK.file.length) }
  if (line.startsWith(MARK.formats)) return { kind: 'formats', formatId: line.slice(MARK.formats.length) }
  return null
}

/** Nombre amigable de cada post-procesador de yt-dlp. */
export function postprocessLabel(name: string): string {
  switch (name) {
    case 'Merger':
      return 'Uniendo video y audio'
    case 'ExtractAudio':
      return 'Convirtiendo audio'
    case 'FixupM3u8':
    case 'FixupM4a':
    case 'FixupStretched':
    case 'FixupDuplicateMoov':
    case 'FixupTimestamp':
      return 'Reparando archivo'
    default:
      return 'Procesando'
  }
}

interface RawFormat {
  vcodec?: string | null
  width?: number | null
  height?: number | null
}

/** Calidad "p" de un formato: lado corto, o el equivalente 16:9 del lado largo si es mayor (3840×1608 → 2160). */
export function formatQuality(width: number | null | undefined, height: number | null | undefined): number {
  const w = width ?? 0
  const h = height ?? 0
  if (!w && !h) return 0
  if (!w) return h
  if (!h) return Math.round((w * 9) / 16)
  const short = Math.min(w, h)
  const long = Math.max(w, h)
  return Math.max(short, Math.round((long * 9) / 16))
}

/** Calidades estándar disponibles a partir de la lista de formatos de yt-dlp, de mayor a menor. */
export function availableQualities(formats: RawFormat[] | undefined): number[] {
  const found = new Set<number>()
  for (const f of formats ?? []) {
    if (!f || f.vcodec === 'none') continue
    const q = formatQuality(f.width, f.height)
    if (!q) continue
    const step = QUALITY_STEPS.find((s) => q >= s * 0.95)
    if (step) found.add(step)
    else found.add(QUALITY_STEPS[QUALITY_STEPS.length - 1])
  }
  return [...found].sort((a, b) => b - a)
}

interface RawThumb {
  url?: string
  width?: number
  preference?: number
}

/** Elige una miniatura JPG de tamaño razonable (las WebP no se pueden redimensionar con nativeImage). */
export function pickThumbnail(thumbnails: RawThumb[] | undefined, fallback?: string): string | undefined {
  const jpgs = (thumbnails ?? []).filter(
    (t) => t.url && /\.jpe?g(\?|$)/i.test(t.url) && (t.width === undefined || t.width <= 1280)
  )
  if (jpgs.length) {
    jpgs.sort((a, b) => (b.width ?? 0) - (a.width ?? 0) || (b.preference ?? 0) - (a.preference ?? 0))
    return jpgs[0].url
  }
  return fallback
}

const ERRORS: [RegExp, string][] = [
  [/Unsupported URL|is not a valid URL|No video formats found/i, 'Este link o sitio no es compatible.'],
  [/This channel|does not have a \w+ tab|is not a video/i, 'Ese link es de un canal o perfil. Pega el link de un video en particular.'],
  [/HTTP Error 404|HTTP Error 410/i, 'No se encontró nada en ese link. Revisa que esté completo y que el contenido sea público.'],
  [/Private video|This video is private|private account/i, 'Este contenido es privado.'],
  [/not a bot|confirm you.re not a robot/i, 'La plataforma pide verificar que no eres un bot. Activa "Usar cookies de mi navegador" en Ajustes o inténtalo más tarde.'],
  [/age.restricted|Sign in to confirm your age|inappropriate for some users/i, 'Contenido con restricción de edad. Activa "Usar cookies de mi navegador" en Ajustes.'],
  [/login required|log in|requires authentication|cookies|empty media response|rate-limit reached/i, 'La plataforma pide iniciar sesión. Activa "Usar cookies de mi navegador" en Ajustes.'],
  [/Video unavailable|has been removed|no longer available|not available in your country|geo.?restrict/i, 'El video no está disponible (eliminado o bloqueado en tu región).'],
  [/live event will begin|Premieres in|is_live|This live event/i, 'Las transmisiones en vivo o estrenos no se pueden descargar hasta que terminen.'],
  [/getaddrinfo|Failed to resolve|Unable to connect|timed out|Connection reset|Network is unreachable|No connection/i, 'Sin conexión a internet o la plataforma no responde.'],
  [/No space left|Errno 28/i, 'No hay espacio suficiente en el disco.'],
  [/WinError 32|being used by another process|siendo utilizado por otro proceso/i, 'El archivo está en uso por otro programa (¿lo tienes abierto en tu editor?). Ciérralo e inténtalo de nuevo.'],
  [/Permission denied|Errno 13/i, 'No se puede escribir en la carpeta de descargas. Elige otra en Ajustes.'],
  [/Unable to extract|Signature extraction failed|nsig|n challenge|HTTP Error 403|Requested format is not available|ExtractorError/i, 'La plataforma cambió algo. Actualiza el motor de descarga en Ajustes y vuelve a intentar.']
]

/** Convierte la salida de error de yt-dlp en un mensaje claro en español. */
export function friendlyError(stderr: string): string {
  const errorLines = stderr
    .split(/\r?\n/)
    .filter((l) => l.startsWith('ERROR:'))
    .join('\n')
  const text = errorLines || stderr
  for (const [re, msg] of ERRORS) if (re.test(text)) return msg
  const last = errorLines.split('\n').pop()?.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '').trim()
  return last || 'No se pudo completar la descarga.'
}
