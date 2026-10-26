import { NextRequest } from 'next/server'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

export const maxDuration = 60

interface TtsRequestBody {
  text?: string
  /** Относительная скорость речи в процентах, например 12 → +12% */
  rate?: number
  /** Относительная высота тона в герцах, например 10 → +10Hz */
  pitch?: number
}

/** Кэш озвученных фраз: экономит запросы при повторах и бережёт лимиты */
const ttsCache = new Map<string, Buffer>()
const TTS_CACHE_MAX = 150

/** Google Translate TTS принимает до ~200 символов за запрос */
const MAX_CHUNK = 190

/** Естественный женский нейроголос Microsoft Edge (класс качества Azure/Alice) */
const EDGE_VOICE = 'ru-RU-SvetlanaNeural'
/** Базовое ускорение речи — пользователь просил побыстрее */
const DEFAULT_RATE = 12

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ─── Провайдер 1: Microsoft Edge Neural TTS ────────────────────────────────

let edgeTtsPromise: Promise<MsEdgeTTS> | null = null
let edgeFailCount = 0
let edgeCooldownUntil = 0

const EDGE_COOLDOWN_MS = 90_000
const EDGE_FAIL_THRESHOLD = 3

async function getEdgeTts(): Promise<MsEdgeTTS> {
  if (!edgeTtsPromise) {
    edgeTtsPromise = (async () => {
      const tts = new MsEdgeTTS()
      await tts.setMetadata(EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
      return tts
    })().catch((error) => {
      // Не кэшируем неудачную инициализацию — попробуем при следующем запросе
      edgeTtsPromise = null
      throw error
    })
  }
  return edgeTtsPromise
}

async function fetchEdge(text: string, rate: number, pitch: number): Promise<Buffer> {
  const tts = await getEdgeTts()
  const { audioStream } = tts.toStream(text, {
    rate: `+${rate}%`,
    pitch: `${pitch >= 0 ? '+' : ''}${pitch}Hz`,
  })
  const chunks: Buffer[] = []
  for await (const chunk of audioStream) chunks.push(Buffer.from(chunk))
  // Соединение не закрываем — переиспользуется между фразами;
  // при обрыве сокета tryEdge пересоздаст его и повторит попытку
  const buf = Buffer.concat(chunks)
  if (buf.length < 400) throw new Error('Edge TTS: пустой аудиофайл')
  return buf
}

/** Попытка Edge с одним переподключением при обрыве сокета */
async function tryEdge(text: string, rate: number, pitch: number): Promise<Buffer> {
  try {
    return await fetchEdge(text, rate, pitch)
  } catch (error) {
    // Соединение могло отвалиться по таймауту — пересоздаём и пробуем ещё раз
    edgeTtsPromise = null
    await sleep(150)
    return fetchEdge(text, rate, pitch).catch((retryError) => {
      throw retryError instanceof Error ? retryError : error
    })
  }
}

// ─── Провайдер 2 (резерв): Google Translate TTS ────────────────────────────

function splitForGoogle(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text]
  const chunks: string[] = []
  let rest = text.trim()
  while (rest.length > MAX_CHUNK) {
    let cut = rest.lastIndexOf(' ', MAX_CHUNK)
    if (cut < 80) cut = rest.lastIndexOf(',', MAX_CHUNK)
    if (cut < 40) cut = MAX_CHUNK
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

async function fetchGoogleChunk(text: string): Promise<Buffer> {
  const url =
    'https://translate.google.com/translate_tts?' +
    new URLSearchParams({ ie: 'UTF-8', q: text, tl: 'ru', client: 'tw-ob' }).toString()
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Referer: 'https://translate.google.com/',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Google TTS ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 400) throw new Error('Пустой аудиофайл')
  return buf
}

async function fetchGoogle(text: string): Promise<Buffer> {
  const chunks = splitForGoogle(text)
  const parts: Buffer[] = []
  let lastError: unknown = null
  for (const chunk of chunks) {
    let done = false
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        parts.push(await fetchGoogleChunk(chunk))
        done = true
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : String(error)
        const isRateLimit = message.includes('429') || message.includes('Too many')
        await sleep(isRateLimit ? 2500 * (attempt + 1) : 600 * (attempt + 1))
      }
    }
    if (!done) throw lastError instanceof Error ? lastError : new Error('TTS недоступен')
  }
  return Buffer.concat(parts)
}

// ─── Основная логика ────────────────────────────────────────────────────────

async function requestTts(text: string, rate: number, pitch: number): Promise<Buffer> {
  const cacheKey = `${text}|${rate}|${pitch}`
  const cached = ttsCache.get(cacheKey)
  if (cached) return cached

  let audio: Buffer | null = null

  const edgeAvailable = Date.now() >= edgeCooldownUntil
  if (edgeAvailable) {
    try {
      audio = await tryEdge(text, rate, pitch)
      edgeFailCount = 0
    } catch {
      edgeFailCount++
      if (edgeFailCount >= EDGE_FAIL_THRESHOLD) {
        edgeCooldownUntil = Date.now() + EDGE_COOLDOWN_MS
        edgeFailCount = 0
      }
    }
  }

  if (!audio) audio = await fetchGoogle(text)

  if (ttsCache.size >= TTS_CACHE_MAX) {
    const oldestKey = ttsCache.keys().next().value
    if (oldestKey !== undefined) ttsCache.delete(oldestKey)
  }
  ttsCache.set(cacheKey, audio)
  return audio
}

/** Прогрев: клиент вызывает при загрузке страницы — сокет Edge открывается
 * заранее, чтобы первая фраза ответа не ждала установку соединения */
export async function GET() {
  try {
    await getEdgeTts()
    return Response.json({ ok: true, provider: 'edge' })
  } catch {
    return Response.json({ ok: false, provider: 'unavailable' })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TtsRequestBody
    const text = body.text?.trim()
    if (!text) {
      return new Response(JSON.stringify({ error: 'Пустой текст' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (text.length > 800) {
      return new Response(JSON.stringify({ error: 'Текст слишком длинный для озвучки' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const rate = Math.min(40, Math.max(-20, Math.round(body.rate ?? DEFAULT_RATE)))
    const pitch = Math.min(30, Math.max(-30, Math.round(body.pitch ?? 0)))
    const audio = await requestTts(text, rate, pitch)

    return new Response(new Uint8Array(audio), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-cache',
      },
    })
  } catch {
    // Клиент при ошибке молча переключится на системный голос
    return new Response(JSON.stringify({ error: 'Не удалось озвучить текст' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
