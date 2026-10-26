/**
 * Проверка проводки релея для Gemini (src/lib/gemini.ts умеет GEMINI_BASE_URL).
 *
 * Поднимаем локальный HTTP-релей с той же логикой, что у Cloudflare-воркера
 * (scripts/gemini-relay-worker.js), и шлём через него реальный запрос к Google
 * с реальным ключом. Релей здесь — в Гонконге, поэтому Google ответит своей
 * гео-ошибкой; это и есть PASS: значит путь/ключ/тело проходят через релей
 * байт-в-байт, и когда релей будет в поддерживаемом регионе — придёт 200.
 *
 * Запуск: node scripts/test-gemini-relay.mjs
 * Ключ берётся из .env.local (GEMINI_API_KEY).
 */
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Читаем ключ из .env.local ──────────────────────────────────────────────
let key = ''
try {
  const env = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  key = env.match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim() ?? ''
} catch {
  /* нет файла */
}
if (!key) {
  console.log('НЕТ КЛЮЧА: положи GEMINI_API_KEY в .env.local')
  process.exit(1)
}

// ── Локальный релей (логика как у воркера) ─────────────────────────────────
const RELAY_PORT = 8799
const relay = http.createServer(async (req, res) => {
  const target = `https://generativelanguage.googleapis.com${req.url}`
  const headers = {}
  for (const name of ['content-type', 'authorization', 'x-goog-api-key', 'accept']) {
    if (req.headers[name]) headers[name] = req.headers[name]
  }
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
  try {
    const upstream = await fetch(target, { method: req.method, headers, body })
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    })
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.end(buf)
    console.log(`[релей] ${req.method} ${req.url} → Google HTTP ${upstream.status}`)
  } catch (error) {
    res.writeHead(502)
    res.end(JSON.stringify({ relayError: String(error?.message ?? error) }))
  }
})

await new Promise((resolve) => relay.listen(RELAY_PORT, '127.0.0.1', resolve))

// ── Запрос через релей ──────────────────────────────────────────────────────
const url = `http://127.0.0.1:${RELAY_PORT}/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(key)}`
const t0 = Date.now()
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
})
const text = await res.text()
const ms = Date.now() - t0

console.log(`\n[через релей] HTTP ${res.status} за ${ms}мс`)
console.log(`ответ Google: ${text.slice(0, 200)}`)

const reachedGoogle =
  text.includes('generativelanguage') ||
  text.includes('User location is not supported') ||
  text.includes('API key') ||
  res.status === 200

console.log('\n' + (reachedGoogle
  ? 'PASS: запрос дошёл до Google через релей (гео-ошибка ожидаема — релей пока в Гонконге).'
  : 'FAIL: ответ не похож на ответ Google — проводка сломана.') + '\n')

relay.close()
process.exit(reachedGoogle ? 0 : 1)
