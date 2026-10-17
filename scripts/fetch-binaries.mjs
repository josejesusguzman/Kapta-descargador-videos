#!/usr/bin/env node
// Descarga yt-dlp y FFmpeg (ffmpeg + ffprobe, y en Windows sus DLLs) desde sus releases oficiales,
// verifica su SHA-256 y los deja en resources/bin/<win|mac|linux>-<arch>/.
//
//   node scripts/fetch-binaries.mjs                 -> sistema y arquitectura de este equipo
//   node scripts/fetch-binaries.mjs --arch=x64      -> forzar x64 (o arm64)
//   node scripts/fetch-binaries.mjs --platform=mac  -> forzar sistema (win, mac o linux)
//   node scripts/fetch-binaries.mjs --force         -> volver a descargar aunque ya existan
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import extract from 'extract-zip'

const args = process.argv.slice(2)
const arch = args.find((a) => a.startsWith('--arch='))?.split('=')[1] ?? process.arch
const hostPlatform = { darwin: 'mac', linux: 'linux' }[process.platform] ?? 'win'
const platform = args.find((a) => a.startsWith('--platform='))?.split('=')[1] ?? hostPlatform
const force = args.includes('--force')

if (!['x64', 'arm64'].includes(arch)) {
  console.error(`Arquitectura no soportada: ${arch} (usa x64 o arm64)`)
  process.exit(1)
}
if (!['win', 'mac', 'linux'].includes(platform)) {
  console.error(`Sistema no soportado: ${platform} (usa win, mac o linux)`)
  process.exit(1)
}

const isWin = platform === 'win'
const exe = (name) => (isWin ? `${name}.exe` : name)
const root = path.resolve(import.meta.dirname, '..')
// Mismo nombre que la macro ${os}-${arch} de electron-builder.
const outDir = path.join(root, 'resources', 'bin', `${platform}-${arch}`)

const YTDLP_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/'
// En macOS, yt-dlp_macos es universal (Apple Silicon + Intel).
const YTDLP_ASSET = {
  win: arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe',
  mac: 'yt-dlp_macos',
  linux: arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
}[platform]
const FFMPEG_BASE = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/'
const FFMPEG_ASSET = `ffmpeg-master-latest-${arch === 'arm64' ? 'winarm64' : 'win64'}-gpl-shared.zip`
// Linux: compilaciones estáticas GPL del mismo repositorio (sin bibliotecas compartidas).
const LINUX_FFMPEG_ASSET = `ffmpeg-master-latest-${arch === 'arm64' ? 'linuxarm64' : 'linux64'}-gpl.tar.xz`
// macOS: compilaciones estáticas GPL de Martin Riedl (ffmpeg y ffprobe por separado, cada una con su .sha256).
const MAC_FFMPEG_BASE = `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${arch === 'arm64' ? 'arm64' : 'amd64'}/release/`

async function fetchOk(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`)
  return res
}

/** Descarga `url` en `dest` y devuelve la URL final (tras las redirecciones). */
async function download(url, dest) {
  const res = await fetchOk(url)
  const total = Number(res.headers.get('content-length')) || 0
  let done = 0
  let lastLog = 0
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      done += chunk.length
      const now = Date.now()
      if (now - lastLog > 1000) {
        lastLog = now
        const pct = total ? ` (${Math.round((done / total) * 100)}%)` : ''
        process.stdout.write(`   ${(done / 1048576).toFixed(1)} MB${pct}\r`)
      }
      cb(null, chunk)
    }
  })
  await pipeline(Readable.fromWeb(res.body), counter, createWriteStream(dest))
  process.stdout.write(`   ${(done / 1048576).toFixed(1)} MB listo          \n`)
  return res.url
}

async function sha256(file) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

/** Busca el hash de `name` en un archivo de sumas ("<hash>  <archivo>", "<hash> *<archivo>" o solo "<hash>"). */
function expectedHash(sums, name) {
  const only = sums.trim()
  if (/^[0-9a-f]{64}$/i.test(only)) return only.toLowerCase()
  for (const line of sums.split(/\r?\n/)) {
    const [hash, file] = line.trim().split(/\s+/)
    if (file && path.basename(file.replace(/^\*/, '')) === name) return hash.toLowerCase()
  }
  throw new Error(`No se encontró la suma SHA-256 de ${name}`)
}

async function verify(file, sumsUrl, name) {
  const sums = await (await fetchOk(sumsUrl)).text()
  const expected = expectedHash(sums, name)
  const actual = await sha256(file)
  if (actual !== expected) {
    throw new Error(`SHA-256 no coincide para ${name}\n  esperado: ${expected}\n  obtenido: ${actual}`)
  }
  console.log(`   SHA-256 verificado (${actual.slice(0, 16)}…)`)
}

/** Versión de yt-dlp: ejecutándolo si se puede; si no (binario de otro sistema), por el tag del último release. */
async function ytdlpVersionOf(file) {
  try {
    return execFileSync(file, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    const res = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest', { redirect: 'manual' })
    const tag = /\/tag\/([^/?#]+)/.exec(res.headers.get('location') ?? '')?.[1]
    if (!tag) throw new Error('No se pudo determinar la versión de yt-dlp')
    return tag
  }
}

async function fetchWindowsFfmpeg(tmp) {
  console.log(`→ FFmpeg (${FFMPEG_ASSET})`)
  const ffZip = path.join(tmp, FFMPEG_ASSET)
  await download(FFMPEG_BASE + FFMPEG_ASSET, ffZip)
  await verify(ffZip, FFMPEG_BASE + 'checksums.sha256', FFMPEG_ASSET)
  const ffDir = path.join(tmp, 'ffmpeg')
  await extract(ffZip, { dir: ffDir })
  const top = readdirSync(ffDir)[0]
  const binDir = path.join(ffDir, top, 'bin')
  for (const f of readdirSync(binDir)) {
    // ffplay no hace falta; ffmpeg + ffprobe + DLLs compartidas sí.
    if (f === 'ffmpeg.exe' || f === 'ffprobe.exe' || f.endsWith('.dll')) {
      copyFileSync(path.join(binDir, f), path.join(outDir, f))
    }
  }
  const license = path.join(ffDir, top, 'LICENSE.txt')
  if (existsSync(license)) copyFileSync(license, path.join(outDir, 'FFMPEG_LICENSE.txt'))
  return FFMPEG_ASSET
}

async function fetchMacFfmpeg(tmp) {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    console.log(`→ ${tool} (macOS ${arch})`)
    const zip = path.join(tmp, `${tool}.zip`)
    const url = `${MAC_FFMPEG_BASE}${tool}.zip`
    // /redirect/latest/ no sirve el .sha256: está junto al archivo real al que redirige.
    const finalUrl = await download(url, zip)
    await verify(zip, `${finalUrl}.sha256`, `${tool}.zip`)
    const dir = path.join(tmp, tool)
    await extract(zip, { dir })
    const bin = readdirSync(dir, { recursive: true }).find((f) => path.basename(f) === tool)
    if (!bin) throw new Error(`${tool}.zip no contiene ${tool}`)
    copyFileSync(path.join(dir, bin), path.join(outDir, tool))
    chmodSync(path.join(outDir, tool), 0o755)
  }
  return `martin-riedl-latest-macos-${arch}`
}

async function fetchLinuxFfmpeg(tmp) {
  console.log(`→ FFmpeg (${LINUX_FFMPEG_ASSET})`)
  const archive = path.join(tmp, LINUX_FFMPEG_ASSET)
  await download(FFMPEG_BASE + LINUX_FFMPEG_ASSET, archive)
  await verify(archive, FFMPEG_BASE + 'checksums.sha256', LINUX_FFMPEG_ASSET)
  const ffDir = path.join(tmp, 'ffmpeg')
  mkdirSync(ffDir)
  // extract-zip no abre .tar.xz; tar viene en cualquier Linux.
  execFileSync('tar', ['-xJf', archive, '-C', ffDir])
  const top = readdirSync(ffDir)[0]
  for (const tool of ['ffmpeg', 'ffprobe']) {
    copyFileSync(path.join(ffDir, top, 'bin', tool), path.join(outDir, tool))
    chmodSync(path.join(outDir, tool), 0o755)
  }
  const license = path.join(ffDir, top, 'LICENSE.txt')
  if (existsSync(license)) copyFileSync(license, path.join(outDir, 'FFMPEG_LICENSE.txt'))
  return LINUX_FFMPEG_ASSET
}

async function main() {
  const ready = [exe('yt-dlp'), exe('ffmpeg'), exe('ffprobe'), 'versions.json'].every((f) =>
    existsSync(path.join(outDir, f))
  )
  if (ready && !force) {
    console.log(`Binarios ya presentes en ${path.relative(root, outDir)} (usa --force para actualizar).`)
    return
  }

  const tmp = path.join(os.tmpdir(), `descargador-bin-${randomBytes(4).toString('hex')}`)
  mkdirSync(tmp, { recursive: true })
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  try {
    console.log(`→ yt-dlp (${YTDLP_ASSET})`)
    const ytTmp = path.join(tmp, YTDLP_ASSET)
    await download(YTDLP_BASE + YTDLP_ASSET, ytTmp)
    await verify(ytTmp, YTDLP_BASE + 'SHA2-256SUMS', YTDLP_ASSET)
    const ytOut = path.join(outDir, exe('yt-dlp'))
    copyFileSync(ytTmp, ytOut)
    if (!isWin) chmodSync(ytOut, 0o755)
    const ytdlpVersion = await ytdlpVersionOf(ytOut)
    console.log(`   versión ${ytdlpVersion}`)

    const ffmpeg = { win: fetchWindowsFfmpeg, mac: fetchMacFfmpeg, linux: fetchLinuxFfmpeg }[platform]
    const ffmpegVersion = await ffmpeg(tmp)

    writeFileSync(
      path.join(outDir, 'versions.json'),
      JSON.stringify({ platform, arch, ytdlp: ytdlpVersion, ffmpeg: ffmpegVersion, fetchedAt: new Date().toISOString() }, null, 2)
    )
    console.log(`✓ Binarios listos en ${path.relative(root, outDir)}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(`✗ ${err.message}`)
  process.exit(1)
})
