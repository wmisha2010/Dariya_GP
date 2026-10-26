import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

export const maxDuration = 60

interface TtsRequestBody {
  text?: string
  /** Относительная скорость речи в процентах, например 12 → +12% */
  rate?: number
  /** Относительная высота тона в герцах, например 10 → +10Hz */
  pitch?: number
  /** Идентификатор голоса из белого списка (svetlana | irina) */
  voice?: string
}

/** Кэш озвученных фраз: экономит запросы при повторах и бережёт лимиты */
interface CachedAudio {
  bytes: Buffer
  contentType: string
}
const ttsCache = new Map<string, CachedAudio>()
const TTS_CACHE_MAX = 150

/** Голоса ассистента. Выбор делает пользователь вручную — в разговоре тембр
 * всегда один, автоматических переключений между движками нет и не будет.
 * - svetlana: нейроголос Microsoft Edge (самое естественное качество)
 * - irina: локальный нейродвижок Piper (офлайн, без лимитов и ключей) */
type VoiceSpec = { engine: 'edge' | 'piper'; id: string }

const VOICES: Record<string, VoiceSpec> = {
  svetlana: { engine: 'edge', id: 'ru-RU-SvetlanaNeural' },
  irina: { engine: 'piper', id: 'irina' },
}
const DEFAULT_VOICE_ID = 'svetlana'

function resolveVoiceId(id?: string): string {
  if (id && VOICES[id]) return id
  return DEFAULT_VOICE_ID
}
/** Базовое ускорение речи — пользователь просил побыстрее */
const DEFAULT_RATE = 12

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ─── Microsoft Edge Neural TTS — облачный движок ──────────────────────────

/** Отдельный сокет на голос: metadata привязана к voice при подключении,
 * поэтому переключение голоса не должно переиспользовать чужое соединение */
const edgeTtsPromises = new Map<string, Promise<MsEdgeTTS>>()

async function getEdgeTts(voice: string): Promise<MsEdgeTTS> {
  let promise = edgeTtsPromises.get(voice)
  if (!promise) {
    promise = (async () => {
      const tts = new MsEdgeTTS()
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
      return tts
    })().catch((error) => {
      // Не кэшируем неудачную инициализацию — попробуем при следующем запросе
      edgeTtsPromises.delete(voice)
      throw error
    })
    edgeTtsPromises.set(voice, promise)
  }
  return promise
}

async function fetchEdge(text: string, rate: number, pitch: number, voice: string): Promise<Buffer> {
  const tts = await getEdgeTts(voice)
  const { audioStream } = tts.toStream(text, {
    rate: `${rate >= 0 ? '+' : ''}${rate}%`,
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
async function tryEdge(text: string, rate: number, pitch: number, voice: string): Promise<Buffer> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchEdge(text, rate, pitch, voice)
    } catch (error) {
      lastError = error
      edgeTtsPromises.delete(voice)
      await sleep(200 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Edge TTS недоступен')
}

// ─── Piper — локальный нейродвижок (офлайн, без лимитов и ключей) ─────────

/** Модель русского женского голоса irina (среднее качество, 22кГц) */
const PIPER_MODEL = path.join(process.cwd(), 'models', 'piper', 'irina.onnx')
const PIPER_PYTHON = process.env.PYTHON_BIN ?? 'python3'
/** Не больше двух одновременных процессов синтеза — иначе CPU-спайки */
const PIPER_MAX_PARALLEL = 2
let piperInflight = 0
const piperWaiters: Array<() => void> = []

async function withPiperSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (piperInflight >= PIPER_MAX_PARALLEL) {
    await new Promise<void>((resolve) => piperWaiters.push(resolve))
  }
  piperInflight++
  try {
    return await fn()
  } finally {
    piperInflight--
    piperWaiters.shift()?.()
  }
}

/** Один прогон Piper: текст в stdin, WAV (22кГц mono) из stdout.
 * Длина речи регулируется length-scale: rate +12% → scale ≈ 0.893 */
function runPiperOnce(text: string, rate: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!existsSync(PIPER_MODEL)) {
      reject(new Error('Piper: модель не найдена'))
      return
    }
    const lengthScale = (100 / (100 + rate)).toFixed(3)
    const proc = spawn(
      PIPER_PYTHON,
      ['-m', 'piper', '-m', PIPER_MODEL, '--length-scale', lengthScale, '-f', '-'],
      { stdio: ['pipe', 'pipe', 'ignore'] }
    )
    const chunks: Buffer[] = []
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(killer)
      fn()
    }
    // Страховка: зависший синтез не должен висеть вечно
    const killer = setTimeout(() => {
      proc.kill('SIGKILL')
      settle(() => reject(new Error('Piper: таймаут синтеза')))
    }, 25_000)
    proc.stdout.on('data', (c: Buffer) => chunks.push(Buffer.from(c)))
    proc.stdout.on('end', () => {
      const buf = Buffer.concat(chunks)
      settle(() => {
        if (buf.length < 400) reject(new Error('Piper: пустой аудиофайл'))
        else resolve(buf)
      })
    })
    proc.on('error', (error) => settle(() => reject(error)))
    proc.on('close', (code) => {
      settle(() => {
        if (code !== 0) reject(new Error(`Piper: процесс завершён с кодом ${code}`))
      })
    })
    proc.stdin.on('error', () => {
      /* stdin может закрыться раньше — не критично */
    })
    proc.stdin.write(text)
    proc.stdin.end()
  })
}

/** Piper с одним ретраем (не критично: prefetch обычно успевает заранее) */
async function tryPiper(text: string, rate: number): Promise<Buffer> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await withPiperSlot(() => runPiperOnce(text, rate))
    } catch (error) {
      lastError = error
      await sleep(150)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Piper недоступен')
}

// ─── Основная логика ────────────────────────────────────────────────────────

async function requestTts(
  text: string,
  rate: number,
  pitch: number,
  voiceId: string
): Promise<CachedAudio> {
  const cacheKey = `${voiceId}|${text}|${rate}|${pitch}`
  const cached = ttsCache.get(cacheKey)
  if (cached) return cached

  // Движок определяется выбранным голосом; авто-переключений нет —
  // сбои лечатся повторными попытками внутри tryEdge/tryPiper
  const spec = VOICES[voiceId] ?? VOICES[DEFAULT_VOICE_ID]
  const audio: CachedAudio =
    spec.engine === 'edge'
      ? { bytes: await tryEdge(text, rate, pitch, spec.id), contentType: 'audio/mpeg' }
      : { bytes: await tryPiper(text, rate), contentType: 'audio/wav' }

  if (ttsCache.size >= TTS_CACHE_MAX) {
    const oldestKey = ttsCache.keys().next().value
    if (oldestKey !== undefined) ttsCache.delete(oldestKey)
  }
  ttsCache.set(cacheKey, audio)
  return audio
}

/** Прогрев: клиент вызывает при загрузке страницы — сокет Edge открывается
 * заранее, а Piper делает фоновый тестовый синтез (первая загрузка модели
 * ~1.5с уходит ещё до первого ответа). Неблокирующий: GET отвечает сразу */
export async function GET() {
  try {
    await getEdgeTts(VOICES[DEFAULT_VOICE_ID].id)
    void requestTts('Прогрев локального голоса.', 12, 0, 'irina').catch(() => {
      /* прогрев не критичен */
    })
    return Response.json({ ok: true, provider: 'edge+piper' })
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
    const { bytes, contentType } = await requestTts(
      text,
      rate,
      pitch,
      resolveVoiceId(body.voice)
    )

    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': contentType,
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
