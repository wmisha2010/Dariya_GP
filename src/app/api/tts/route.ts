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

/** Естественный женский нейроголос Microsoft Edge (класс качества Azure/Alice).
 * Единственный голос ассистента — никаких резервных движков, чтобы тембр
 * никогда не «скакал» на другой синтезатор посреди разговора */
const EDGE_VOICE = 'ru-RU-SvetlanaNeural'
/** Базовое ускорение речи — пользователь просил побыстрее */
const DEFAULT_RATE = 12

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ─── Microsoft Edge Neural TTS — единственный провайдер ───────────────────

let edgeTtsPromise: Promise<MsEdgeTTS> | null = null

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

/** Попытка Edge с переподключениями при обрыве сокета: до 3 попыток.
 * Соединение могло отвалиться по таймауту — пересоздаём и пробуем снова.
 * Если не вышло — отдаём ошибку наверх (клиент пропустит фразу молча,
 * но не станет переключаться на другой голос) */
async function tryEdge(text: string, rate: number, pitch: number): Promise<Buffer> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchEdge(text, rate, pitch)
    } catch (error) {
      lastError = error
      edgeTtsPromise = null
      await sleep(200 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Edge TTS недоступен')
}

// ─── Основная логика ────────────────────────────────────────────────────────

async function requestTts(text: string, rate: number, pitch: number): Promise<Buffer> {
  const cacheKey = `${text}|${rate}|${pitch}`
  const cached = ttsCache.get(cacheKey)
  if (cached) return cached

  // Один голос — Edge Svetlana. Резервных синтезаторов больше нет:
  // сбои лечатся повторными попытками с переподключением внутри tryEdge
  const audio = await tryEdge(text, rate, pitch)

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
    // Клиент молча пропустит фразу — голос должен оставаться всегда одним
    return new Response(JSON.stringify({ error: 'Не удалось озвучить текст' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
