#!/usr/bin/env node
// Descarga yt-dlp y FFmpeg (ffmpeg + ffprobe + DLLs) desde sus releases oficiales,
// verifica su SHA-256 y los deja en resources/bin/<arch>/.
//
//   node scripts/fetch-binaries.mjs            -> arquitectura de este equipo
//   node scripts/fetch-binaries.mjs --arch=x64 -> forzar x64 (o arm64)
//   node scripts/fetch-binaries.mjs --force    -> volver a descargar aunque ya existan
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
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
const force = args.includes('--force')

if (!['x64', 'arm64'].includes(arch)) {
  console.error(`Arquitectura no soportada: ${arch} (usa x64 o arm64)`)
  process.exit(1)
}

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'resources', 'bin', arch)

const YTDLP_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/'
const YTDLP_ASSET = arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe'
const FFMPEG_BASE = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/'
const FFMPEG_ASSET = `ffmpeg-master-latest-${arch === 'arm64' ? 'winarm64' : 'win64'}-gpl-shared.zip`

async function fetchOk(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`)
  return res
}

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
}

async function sha256(file) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

/** Busca el hash de `name` en un archivo de sumas ("<hash>  <archivo>" o "<hash> *<archivo>"). */
function expectedHash(sums, name) {
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

async function main() {
  const ready = ['yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe', 'versions.json'].every((f) =>
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
    const ytOut = path.join(outDir, 'yt-dlp.exe')
    copyFileSync(ytTmp, ytOut)
    const ytdlpVersion = execFileSync(ytOut, ['--version'], { encoding: 'utf8' }).trim()
    console.log(`   versión ${ytdlpVersion}`)

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

    writeFileSync(
      path.join(outDir, 'versions.json'),
      JSON.stringify({ arch, ytdlp: ytdlpVersion, ffmpeg: FFMPEG_ASSET, fetchedAt: new Date().toISOString() }, null, 2)
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
