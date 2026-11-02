/**
 * Генерация PWA-иконок «Дария» в стиле HUD-орбиса (тёмный фон + cyan неон).
 * Выход: public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png
 *
 * Запуск: node scripts/make-pwa-icons.mjs
 */
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const OUT = 'public/icons'
mkdirSync(OUT, { recursive: true })

/**
 * SVG орбиса. scale — во сколько раз орбис меньше холста:
 * 2.8 для обычных иконок, 3.6 для maskable (безопасная зона 80%).
 */
function orbSvg(size, scale) {
  const c = size / 2
  const r = size / scale // радиус орбиса
  const ringR = r * 1.28
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="#0c1626"/>
      <stop offset="60%" stop-color="#070b12"/>
      <stop offset="100%" stop-color="#04070c"/>
    </radialGradient>
    <radialGradient id="orb" cx="38%" cy="32%" r="80%">
      <stop offset="0%" stop-color="#a5f3fc"/>
      <stop offset="30%" stop-color="#22d3ee"/>
      <stop offset="68%" stop-color="#0e7490"/>
      <stop offset="100%" stop-color="#083344"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.55"/>
      <stop offset="55%" stop-color="#22d3ee" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ring" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#67e8f9"/>
      <stop offset="100%" stop-color="#155e75" stop-opacity="0.4"/>
    </linearGradient>
  </defs>

  <rect width="${size}" height="${size}" fill="url(#bg)"/>
  <circle cx="${c}" cy="${c}" r="${r * 1.9}" fill="url(#glow)"/>

  <!-- внешнее кольцо HUD -->
  <circle cx="${c}" cy="${c}" r="${ringR}" fill="none" stroke="url(#ring)"
          stroke-width="${size * 0.012}" opacity="0.85"/>
  <!-- дуги-акценты на кольце -->
  <path d="${arc(c, c, ringR, -205, -155)}" fill="none" stroke="#7deafc"
        stroke-width="${size * 0.02}" stroke-linecap="round" opacity="0.95"/>
  <path d="${arc(c, c, ringR, 25, 75)}" fill="none" stroke="#38bdf8"
        stroke-width="${size * 0.02}" stroke-linecap="round" opacity="0.8"/>

  <!-- орбис -->
  <circle cx="${c}" cy="${c}" r="${r}" fill="url(#orb)"/>
  <!-- блик -->
  <ellipse cx="${c - r * 0.32}" cy="${c - r * 0.38}" rx="${r * 0.34}" ry="${r * 0.22}"
           fill="#e0feff" opacity="0.5" transform="rotate(-25 ${c - r * 0.32} ${c - r * 0.38})"/>
  <!-- нижняя подсветка -->
  <ellipse cx="${c}" cy="${c + r * 0.55}" rx="${r * 0.62}" ry="${r * 0.16}"
           fill="#164e63" opacity="0.55"/>
</svg>`
}

/** Дуга окружности как SVG path (углы в градусах, 0 = вправо, по часовой) */
function arc(cx, cy, r, a1, a2) {
  const rad = (a) => (a * Math.PI) / 180
  const x1 = cx + r * Math.cos(rad(a1))
  const y1 = cy + r * Math.sin(rad(a1))
  const x2 = cx + r * Math.cos(rad(a2))
  const y2 = cy + r * Math.sin(rad(a2))
  const large = Math.abs(a2 - a1) > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

const jobs = [
  { file: 'icon-192.png', size: 192, scale: 2.8 },
  { file: 'icon-512.png', size: 512, scale: 2.8 },
  { file: 'maskable-512.png', size: 512, scale: 3.7 },
  { file: 'apple-touch-icon.png', size: 180, scale: 2.8 },
]

for (const job of jobs) {
  const svg = Buffer.from(orbSvg(job.size, job.scale))
  await sharp(svg).png().toFile(`${OUT}/${job.file}`)
  console.log(`✓ ${OUT}/${job.file}`)
}
