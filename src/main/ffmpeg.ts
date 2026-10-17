// Recodificación "compatible con editores": convierte VP9/AV1 a H.264 para que CapCut lo importe sin problemas.
import { execFile, spawn } from 'node:child_process'
import { renameSync, rmSync } from 'node:fs'
import { ffmpegPath, ffprobePath } from './binaries'
import { killTree, UserError } from './ytdlp'

export interface ProbeResult {
  vcodec?: string
  height?: number
  width?: number
  duration?: number
}

export function probe(file: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    execFile(
      ffprobePath(),
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', file],
      { windowsHide: true, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return resolve({})
        try {
          const j = JSON.parse(stdout)
          const s = j.streams?.[0] ?? {}
          resolve({
            vcodec: s.codec_name,
            width: s.width,
            height: s.height,
            duration: Number(j.format?.duration) || undefined
          })
        } catch {
          resolve({})
        }
      }
    )
  })
}

/** H.264 y HEVC son los que CapCut y la mayoría de editores importan sin problemas. */
export function needsRecode(vcodec: string | undefined): boolean {
  return !!vcodec && !['h264', 'hevc'].includes(vcodec)
}

interface Encoder {
  name: string
  args: (height: number) => string[]
}

/** Bitrate generoso para edición, según la resolución. */
const bitrate = (h: number): string => (h >= 2000 ? '45M' : h >= 1400 ? '24M' : h >= 1000 ? '12M' : h >= 700 ? '7M' : '4M')

// En orden de preferencia: GPU NVIDIA, Intel, AMD, Media Foundation (incluye Qualcomm/ARM) y CPU.
const ENCODERS: Encoder[] = [
  { name: 'h264_nvenc', args: () => ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-pix_fmt', 'yuv420p'] },
  { name: 'h264_qsv', args: () => ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '20', '-pix_fmt', 'nv12'] },
  { name: 'h264_amf', args: () => ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20', '-pix_fmt', 'yuv420p'] },
  { name: 'h264_mf', args: (h) => ['-c:v', 'h264_mf', '-hw_encoding', '1', '-b:v', bitrate(h), '-pix_fmt', 'nv12'] },
  { name: 'libx264', args: () => ['-c:v', 'libx264', '-preset', 'faster', '-crf', '18', '-pix_fmt', 'yuv420p'] }
]
const CPU = ENCODERS[ENCODERS.length - 1]

function tryEncoder(enc: Encoder): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      ffmpegPath(),
      ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1280x720:d=0.3', '-frames:v', '5', ...enc.args(720), '-f', 'null', '-'],
      { windowsHide: true, timeout: 15000 },
      (err) => resolve(!err)
    )
  })
}

let encoderPromise: Promise<Encoder> | null = null

/** Detecta (una sola vez) el mejor encoder H.264 que funciona en este equipo. */
export function detectEncoder(): Promise<Encoder> {
  encoderPromise ??= (async () => {
    for (const enc of ENCODERS) if (await tryEncoder(enc)) return enc
    return CPU
  })()
  return encoderPromise
}

function encode(
  enc: Encoder,
  input: string,
  output: string,
  info: ProbeResult,
  onProgress: (percent: number) => void,
  signal: AbortSignal
): Promise<boolean> {
  return new Promise((resolve) => {
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-map', '0:v:0', '-map', '0:a:0?',
      ...enc.args(info.height ?? 1080),
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      '-progress', 'pipe:1', '-nostats',
      output
    ]
    const child = spawn(ffmpegPath(), args, { windowsHide: true })
    const onAbort = (): void => killTree(child)
    signal.addEventListener('abort', onAbort, { once: true })
    let buf = ''
    child.stdout.on('data', (c: Buffer) => {
      buf += c.toString()
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const l of lines) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(l)
        if (m && info.duration) onProgress(Math.min(99, (Number(m[1]) / 1e6 / info.duration) * 100))
      }
    })
    child.stderr.resume()
    child.on('error', () => resolve(false))
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort)
      resolve(code === 0)
    })
  })
}

/** Recodifica `file` a H.264 en el mismo lugar. Si el encoder de GPU falla, reintenta con CPU. */
export async function recodeForEditing(
  file: string,
  info: ProbeResult,
  onProgress: (percent: number) => void,
  signal: AbortSignal
): Promise<void> {
  const tmp = file.replace(/\.(\w+)$/, '.editando.$1')
  const enc = await detectEncoder()
  let ok = await encode(enc, file, tmp, info, onProgress, signal)
  if (!ok && !signal.aborted && enc !== CPU) {
    onProgress(0)
    ok = await encode(CPU, file, tmp, info, onProgress, signal)
  }
  if (!ok) {
    rmSync(tmp, { force: true })
    if (signal.aborted) throw new UserError('Cancelado')
    throw new UserError('No se pudo optimizar el video para edición. Desactiva "Compatible con editores" e inténtalo de nuevo.')
  }
  renameSync(tmp, file)
}
