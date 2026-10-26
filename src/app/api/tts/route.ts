import { NextRequest } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const maxDuration = 120

interface TtsRequestBody {
  text?: string
}

/** Кэш озвученных фраз: экономит запросы к TTS API при повторах */
const ttsCache = new Map<string, Buffer>()
const TTS_CACHE_MAX = 60

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function requestTts(text: string): Promise<Buffer> {
  const cached = ttsCache.get(text)
  if (cached) return cached

  const zai = await ZAI.create()
  let lastError: unknown = null

  // До 3 попыток с паузой: TTS API иногда отвечает 429 при частых запросах
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await zai.audio.tts.create({
        input: text,
        response_format: 'wav',
      })
      if (!response || typeof response.arrayBuffer !== 'function') {
        throw new Error('Некорректный ответ TTS-сервиса')
      }
      const audio = Buffer.from(await response.arrayBuffer())
      if (audio.length === 0) throw new Error('Пустой аудиофайл')

      if (ttsCache.size >= TTS_CACHE_MAX) {
        const oldestKey = ttsCache.keys().next().value
        if (oldestKey !== undefined) ttsCache.delete(oldestKey)
      }
      ttsCache.set(text, audio)
      return audio
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      const isRateLimit = message.includes('429') || message.includes('Too many')
      if (!isRateLimit || attempt === 2) break
      // Пауза перед повтором: 2с, 4с
      await sleep(2000 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('TTS недоступен')
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
    if (text.length > 500) {
      return new Response(JSON.stringify({ error: 'Текст слишком длинный для озвучки' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const audio = await requestTts(text)

    return new Response(new Uint8Array(audio), {
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('POST /api/tts error:', error)
    return new Response(JSON.stringify({ error: 'Не удалось озвучить текст' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
