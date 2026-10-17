#!/usr/bin/env node
// Genera los íconos de la app sin dependencias: dibuja el logo (cuadro con degradado + flecha de descarga)
// con antialiasing por SDF y escribe PNG e ICO.
//   build/icon.ico            -> ejecutable e instalador
//   resources/icons/icon.png  -> ventana y notificaciones
//   resources/icons/drag.png  -> ícono al arrastrar un archivo
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

const root = path.resolve(import.meta.dirname, '..')

// ---------- Dibujo (espacio de 32×32 unidades) ----------

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r
  const qy = Math.abs(y - cy) - hh + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function sdSegment(x, y, ax, ay, bx, by) {
  const pax = x - ax
  const pay = y - ay
  const bax = bx - ax
  const bay = by - ay
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1)
  return Math.hypot(pax - bax * h, pay - bay * h)
}

const STROKE = 2.7
const SEGMENTS = [
  [16, 8, 16, 19.5], // tallo de la flecha
  [10.8, 14.6, 16, 19.8], // punta izquierda
  [21.2, 14.6, 16, 19.8], // punta derecha
  [10, 24.2, 22, 24.2] // base
]
const FROM = [0xff, 0x7a, 0x45]
const TO = [0xff, 0x3d, 0x6e]

function render(size, { margin = 1 } = {}) {
  const k = 32 / size // unidades por píxel
  const px = Buffer.alloc(size * size * 4)
  const half = 16 - margin
  const radius = 7.5 * (half / 15)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ux = (x + 0.5) * k
      const uy = (y + 0.5) * k
      const box = clamp(0.5 - sdRoundRect(ux, uy, 16, 16, half, half, radius) / k, 0, 1)
      if (box <= 0) continue
      const t = clamp((ux + uy) / 64, 0, 1)
      let r = lerp(FROM[0], TO[0], t)
      let g = lerp(FROM[1], TO[1], t)
      let b = lerp(FROM[2], TO[2], t)
      let ink = 0
      for (const s of SEGMENTS) {
        // Grosor mínimo de ~1.2 px para que se lea en 16×16.
        const w = Math.max(STROKE / 2, 0.6 * k)
        ink = Math.max(ink, clamp(0.5 - (sdSegment(ux, uy, ...s) - w) / k, 0, 1))
      }
      r = lerp(r, 255, ink)
      g = lerp(g, 255, ink)
      b = lerp(b, 255, ink)
      const i = (y * size + x) * 4
      px[i] = Math.round(r)
      px[i + 1] = Math.round(g)
      px[i + 2] = Math.round(b)
      px[i + 3] = Math.round(box * 255)
    }
  }
  return px
}

// ---------- PNG ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bits por canal
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filtro "none"
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- ICO (con imágenes PNG, válido desde Windows Vista) ----------

function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + 16 * images.length
  for (const { size, data } of images) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4) // planos
    e.writeUInt16LE(32, 6) // bits por píxel
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const images = icoSizes.map((size) => ({ size, data: png(size, render(size)) }))

mkdirSync(path.join(root, 'build'), { recursive: true })
mkdirSync(path.join(root, 'resources', 'icons'), { recursive: true })
writeFileSync(path.join(root, 'build', 'icon.ico'), ico(images))
writeFileSync(path.join(root, 'build', 'icon.png'), png(512, render(512)))
writeFileSync(path.join(root, 'resources', 'icons', 'icon.png'), png(256, render(256)))
writeFileSync(path.join(root, 'resources', 'icons', 'drag.png'), png(64, render(64, { margin: 2 })))
console.log('✓ Íconos generados: build/icon.ico, build/icon.png, resources/icons/{icon,drag}.png')
