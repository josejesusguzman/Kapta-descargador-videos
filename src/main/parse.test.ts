import { describe, expect, it } from 'vitest'
import { availableQualities, formatQuality, friendlyError, parseLine, pickThumbnail } from './parse'
import { downloadArgs, formatArgs, isInsideDir, isMediaFile, outputTemplate } from './ytdlpArgs'
import { posix, win32 } from 'node:path'
import type { DownloadRequest } from '@shared/types'

describe('parseLine', () => {
  it('lee progreso con _percent', () => {
    const line =
      '@@P{"status": "downloading", "downloaded_bytes": 1024, "total_bytes": 433081, "tmpfilename": "C:\\\\x\\\\a.f133.mp4.part", "filename": "C:\\\\x\\\\a.f133.mp4", "eta": 3, "speed": 108838.05, "_percent": 0.2364}'
    const r = parseLine(line)
    expect(r?.kind).toBe('progress')
    if (r?.kind !== 'progress') return
    expect(r.data.percent).toBeCloseTo(0.2364)
    expect(r.data.speed).toBeCloseTo(108838.05)
    expect(r.data.eta).toBe(3)
    expect(r.data.filename).toBe('C:\\x\\a.f133.mp4')
    expect(r.data.tmpfilename).toBe('C:\\x\\a.f133.mp4.part')
  })

  it('calcula el porcentaje con bytes estimados o fragmentos', () => {
    const est = parseLine('@@P{"status":"downloading","downloaded_bytes":50,"total_bytes_estimate":200}')
    expect(est?.kind === 'progress' && est.data.percent).toBe(25)
    const frag = parseLine('@@P{"status":"downloading","fragment_index":3,"fragment_count":12}')
    expect(frag?.kind === 'progress' && frag.data.percent).toBe(25)
  })

  it('marca 100 % al terminar y acota valores raros', () => {
    const fin = parseLine('@@P{"status":"finished","downloaded_bytes":10}')
    expect(fin?.kind === 'progress' && fin.data.percent).toBe(100)
    const over = parseLine('@@P{"status":"downloading","_percent":180,"speed":null}')
    expect(over?.kind === 'progress' && over.data.percent).toBe(100)
    expect(over?.kind === 'progress' && over.data.speed).toBeUndefined()
  })

  it('lee post-procesado, archivo final y formatos', () => {
    expect(parseLine('@@S{"status": "started", "postprocessor": "Merger"}')).toEqual({
      kind: 'postprocess',
      status: 'started',
      postprocessor: 'Merger'
    })
    expect(parseLine('@@FC:\\Videos\\Clip ñandú [abc].mp4\r')).toEqual({
      kind: 'file',
      path: 'C:\\Videos\\Clip ñandú [abc].mp4'
    })
    expect(parseLine('@@N299+140')).toEqual({ kind: 'formats', formatId: '299+140' })
  })

  it('ignora líneas basura y JSON roto', () => {
    expect(parseLine('[download] Destination: x.mp4')).toBeNull()
    expect(parseLine('')).toBeNull()
    expect(parseLine('@@P{"status": "downl')).toBeNull()
  })
})

describe('calidades', () => {
  it('usa el lado corto o el equivalente 16:9', () => {
    expect(formatQuality(1920, 1080)).toBe(1080)
    expect(formatQuality(1080, 1920)).toBe(1080) // vertical
    expect(formatQuality(3840, 1608)).toBe(2160) // cinemascope 4K
    expect(formatQuality(undefined, 720)).toBe(720)
    expect(formatQuality(null, null)).toBe(0)
  })

  it('agrupa formatos en calidades estándar sin repetir y sin audio', () => {
    const q = availableQualities([
      { vcodec: 'none', width: null, height: null },
      { vcodec: 'avc1', width: 1920, height: 1036 },
      { vcodec: 'vp9', width: 1920, height: 1080 },
      { vcodec: 'vp9', width: 3840, height: 2160 },
      { vcodec: 'avc1', width: 854, height: 480 },
      { vcodec: 'avc1', width: 256, height: 144 }
    ])
    expect(q).toEqual([2160, 1080, 480, 360])
    expect(availableQualities(undefined)).toEqual([])
  })
})

describe('pickThumbnail', () => {
  it('prefiere el JPG más grande hasta 1280 px', () => {
    const url = pickThumbnail(
      [
        { url: 'https://i.ytimg.com/vi/x/default.jpg', width: 120 },
        { url: 'https://i.ytimg.com/vi_webp/x/maxresdefault.webp', width: 1920 },
        { url: 'https://i.ytimg.com/vi/x/hq720.jpg?sqp=abc', width: 1280 },
        { url: 'https://i.ytimg.com/vi/x/maxresdefault.jpg', width: 1920 }
      ],
      'fallback'
    )
    expect(url).toBe('https://i.ytimg.com/vi/x/hq720.jpg?sqp=abc')
  })

  it('usa el respaldo si no hay JPG', () => {
    expect(pickThumbnail([{ url: 'https://x/a.webp' }], 'https://x/b.image')).toBe('https://x/b.image')
  })
})

describe('friendlyError', () => {
  it('traduce errores comunes', () => {
    expect(friendlyError('ERROR: [youtube] abc: Private video. Sign in if you have access')).toMatch(/privado/)
    expect(friendlyError("ERROR: Unsupported URL: https://example.com")).toMatch(/no es compatible/)
    expect(friendlyError("ERROR: [youtube] x: Sign in to confirm you're not a bot.")).toMatch(/bot/)
    expect(friendlyError('ERROR: [Instagram] x: Requested content is not available, rate-limit reached or login required')).toMatch(
      /iniciar sesión/
    )
    expect(friendlyError('ERROR: [youtube] x: Video unavailable')).toMatch(/no está disponible/)
    expect(friendlyError('ERROR: [generic] nada: Unable to download webpage: HTTP Error 404: Not Found')).toMatch(/No se encontró/)
    expect(friendlyError('ERROR: [youtube:tab] @Blender: This channel does not have a videos tab')).toMatch(/canal o perfil/)
    expect(friendlyError('ERROR: Unable to rename file: [WinError 32] El proceso no tiene acceso al archivo porque está siendo utilizado por otro proceso')).toMatch(/en uso/)
  })

  it('devuelve la última línea de error si no la reconoce', () => {
    expect(friendlyError('WARNING: algo\nERROR: [generic] Something odd happened')).toBe('Something odd happened')
    expect(friendlyError('')).toBe('No se pudo completar la descarga.')
  })
})

describe('argumentos de yt-dlp', () => {
  const base: DownloadRequest = {
    url: 'https://www.youtube.com/watch?v=x',
    title: 't',
    platform: 'Youtube',
    mode: 'video',
    quality: 1080,
    audioFormat: 'mp3',
    editorCompatible: true
  }

  it('video con calidad máxima y preferencia H.264', () => {
    expect(formatArgs(base)).toEqual([
      '-f',
      'bv*+ba/b',
      '-S',
      'res:1080,hdr:SDR,vcodec:h264,acodec:aac',
      '--merge-output-format',
      'mp4'
    ])
  })

  it('video "mejor disponible" sin modo compatible', () => {
    expect(formatArgs({ ...base, quality: 0, editorCompatible: false })).toContain('res,acodec:aac')
  })

  it('audio en cada formato', () => {
    expect(formatArgs({ ...base, mode: 'audio', audioFormat: 'mp3' })).toEqual([
      '-f',
      'ba/b',
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '0'
    ])
    expect(formatArgs({ ...base, mode: 'audio', audioFormat: 'wav' })).toContain('wav')
    expect(formatArgs({ ...base, mode: 'audio', audioFormat: 'm4a' })).toContain('acodec:aac')
  })

  it('el nombre de archivo distingue la calidad en video', () => {
    expect(outputTemplate({ mode: 'video', quality: 2160 })).toBe('%(title).150B [%(id)s] 4K.%(ext)s')
    expect(outputTemplate({ mode: 'video', quality: 1080 })).toBe('%(title).150B [%(id)s] 1080p.%(ext)s')
    expect(outputTemplate({ mode: 'video', quality: 0 })).toBe('%(title).150B [%(id)s].%(ext)s')
    expect(outputTemplate({ mode: 'audio', quality: 1080 })).toBe('%(title).150B [%(id)s].%(ext)s')
  })

  it('la URL va al final, después de "--", y las cookies solo si se piden', () => {
    const opts = { ffmpegDir: 'C:\\bin', jsRuntimePath: 'C:\\app.exe', cookiesBrowser: 'none' as const }
    const args = downloadArgs({ ...base, url: '-malicioso' }, 'C:\\out', 'C:\\tmp\\job1', opts)
    expect(args.slice(-2)).toEqual(['--', '-malicioso'])
    expect(args).not.toContain('--cookies-from-browser')
    expect(args).toContain('node:C:\\app.exe')
    expect(args.join(' ')).toContain('-P C:\\out -P temp:C:\\tmp\\job1')
    const withCookies = downloadArgs(base, 'C:\\out', 'C:\\tmp', { ...opts, cookiesBrowser: 'firefox' })
    expect(withCookies.join(' ')).toContain('--cookies-from-browser firefox')
  })
})

describe('isMediaFile', () => {
  it('acepta video y audio', () => {
    expect(isMediaFile('C:\\Videos\\clip [abc] 1080p.mp4')).toBe(true)
    expect(isMediaFile('C:\\Musica\\tema.M4A')).toBe(true)
  })
  it('rechaza ejecutables y archivos sin extensión', () => {
    expect(isMediaFile('C:\\Descargas\\setup.exe')).toBe(false)
    expect(isMediaFile('C:\\Descargas\\acceso.lnk')).toBe(false)
    expect(isMediaFile('C:\\Descargas\\video.mp4.exe')).toBe(false)
    expect(isMediaFile('C:\\Descargas.mp4\\archivo')).toBe(false)
  })
})

describe('isInsideDir', () => {
  // Windows
  it('acepta archivos dentro de la carpeta, sin distinguir mayúsculas', () => {
    expect(isInsideDir('C:\\Videos\\Descargador\\clip.mp4', 'C:\\Videos\\Descargador', win32)).toBe(true)
    expect(isInsideDir('c:\\videos\\descargador\\sub\\clip.mp4', 'C:\\Videos\\Descargador\\', win32)).toBe(true)
  })
  it('rechaza rutas fuera de la carpeta', () => {
    expect(isInsideDir('C:\\Users\\yo\\Documents\\tesis.docx', 'C:\\Videos\\Descargador', win32)).toBe(false)
    expect(isInsideDir('C:\\Videos\\Descargador\\..\\otro.mp4', 'C:\\Videos\\Descargador', win32)).toBe(false)
    expect(isInsideDir('C:\\Videos\\Descargador2\\clip.mp4', 'C:\\Videos\\Descargador', win32)).toBe(false)
    expect(isInsideDir('D:\\clip.mp4', 'C:\\Videos\\Descargador', win32)).toBe(false)
    expect(isInsideDir('C:\\Videos\\Descargador', 'C:\\Videos\\Descargador', win32)).toBe(false)
  })
  it('macOS: acepta solo rutas dentro de la carpeta', () => {
    expect(isInsideDir('/Users/yo/Movies/Descargador/clip.mp4', '/Users/yo/Movies/Descargador', posix)).toBe(true)
    expect(isInsideDir('/Users/yo/Movies/Descargador/sub/clip.mp4', '/Users/yo/Movies/Descargador/', posix)).toBe(true)
    expect(isInsideDir('/Users/yo/Movies/Descargador/../otro.mp4', '/Users/yo/Movies/Descargador', posix)).toBe(false)
    expect(isInsideDir('/Users/yo/Movies/Descargador2/clip.mp4', '/Users/yo/Movies/Descargador', posix)).toBe(false)
    expect(isInsideDir('/Users/yo/Movies/Descargador', '/Users/yo/Movies/Descargador', posix)).toBe(false)
  })
})
