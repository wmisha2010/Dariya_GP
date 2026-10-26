import { NextRequest } from 'next/server'

export const maxDuration = 60

interface TtsRequestBody {
  text?: string
}

/** Кэш озвученных фраз: экономит запросы при повторах и бережёт лимиты */
const ttsCache = new Map<string, Buffer>()
const TTS_CACHE_MAX = 150

/** Google Translate TTS принимает до ~200 символов за запрос */
const MAX_CHUNK = 190

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

async function requestTts(text: string): Promise<Buffer> {
  const cached = ttsCache.get(text)
  if (cached) return cached

  const chunks = splitForGoogle(text)
  const parts: Buffer[] = []
  let lastError: unknown = null

  for (const chunk of chunks) {
    let done = false
    // До 3 попыток с паузами: иногда Google отдаёт 429 при частых запросах
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

  // MP3-поток корректно склеивается последовательным объединением
  const audio = Buffer.concat(parts)
  if (ttsCache.size >= TTS_CACHE_MAX) {
    const oldestKey = ttsCache.keys().next().value
    if (oldestKey !== undefined) ttsCache.delete(oldestKey)
  }
  ttsCache.set(text, audio)
  return audio
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

    const audio = await requestTts(text)

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
