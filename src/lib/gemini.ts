/**
 * Клиент Google Gemini API (бесплатный тариф Google AI Studio).
 *
 * Зачем: основной шлюз (Z.ai) периодически отдаёт 429 в волны перегрузки.
 * Если пользователь задал GEMINI_API_KEY, чат идёт через Gemini, а при любом
 * сбое (нет ключа / 429 / блокировка / сеть) — автоматически откатывается на Z.ai.
 *
 * Формат: REST v1beta, streamGenerateContent с alt=sse. Ответы конвертируются
 * в OpenAI-совместимый SSE (data: {"choices":[{"delta":{"content":...}}]}),
 * чтобы существующий парсер /api/chat не менять.
 *
 * ⚠️ Гео-ограничение Google: бесплатный тариф отклоняет запросы с серверов
 * ряда регионов (Гонконг, Россия и др.) — «User location is not supported
 * for the API use» (FAILED_PRECONDITION). Проверка по IP сервера, срабатывает
 * после проверки ключа, стабильна (не мигает). Провайдер остаётся резервом:
 * заработает автоматически при запуске в поддерживаемом регионе.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export function getGeminiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim()
  return key ? key : null
}

export interface GeminiTurn {
  role: 'user' | 'model'
  parts: Array<{ text: string }>
}

interface GeminiStreamOptions {
  apiKey: string
  /** Большой системный промпт (персона + память + стиль речи) */
  system: string
  /** История диалога в порядке от старых к новым, последняя — реплика пользователя */
  turns: GeminiTurn[]
}

interface GeminiPart {
  text?: unknown
}

/** Какие категории смягчаем: персонаж игривый/флиртующий, ложные блокировки
 * на «лёгком» контенте не нужны; жёстко опасное всё равно режет BLOCK_ONLY_HIGH */
const SAFETY_SETTINGS = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }))

/** Текстовые дельты одного события Gemini → OpenAI-совместимая SSE-строка */
function convertEvent(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, payload: string): void {
  if (!payload || payload === '[DONE]') return
  try {
    const json = JSON.parse(payload) as {
      candidates?: Array<{ content?: { parts?: GeminiPart[] } }>
    }
    const parts = json.candidates?.[0]?.content?.parts
    const text = Array.isArray(parts)
      ? parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('')
      : ''
    if (text) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
      )
    }
  } catch {
    // неполные/служебные строки пропускаем
  }
}

/**
 * Стриминговый вызов Gemini. До возврата потока дожидаемся первого события:
 * если Gemini заблокировал промпт (promptFeedback.blockReason) — бросаем
 * ошибку сразу, чтобы вызывающий код переключился на резервный провайдер,
 * а не отдавал пользователю пустой ответ.
 */
export async function createGeminiStream(options: GeminiStreamOptions): Promise<ReadableStream<Uint8Array>> {
  // gemini-2.5-flash закрыт для новых ключей («no longer available to new
  // users») — актуальная бесплатная модель по подсказке самого API.
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash'
  // У 2.5-моделей «мышление» включено по умолчанию и съедает лимит вывода —
  // для живого болтового ассистента выключаем. У других поколений параметр
  // иной, поэтому не отправляем ничего, чтобы не поймать 400.
  const generationConfig: Record<string, unknown> = {
    temperature: 0.9,
    maxOutputTokens: 2048,
  }
  if (model.startsWith('gemini-2.5')) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 }
  }

  const res = await fetch(
    `${GEMINI_BASE}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(options.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.system }] },
        contents: options.turns,
        generationConfig,
        safetySettings: SAFETY_SETTINGS,
      }),
    }
  )

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 200)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()

  // Пречтление до первого SSE-события (детекция блокировок до старта стрима)
  let buffer = ''
  let firstEvents: string[] = []
  while (firstEvents.length === 0) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    firstEvents = events
  }

  for (const event of firstEvents) {
    for (const line of event.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload) continue
      try {
        const json = JSON.parse(payload) as { promptFeedback?: { blockReason?: string } }
        const block = json.promptFeedback?.blockReason
        if (block) throw new Error(`Gemini заблокировал ответ (${block})`)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Gemini заблокировал')) {
          try {
            await reader.cancel()
          } catch {
            /* ignore */
          }
          throw error
        }
      }
    }
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const pushBlock = (block: string) => {
        for (const line of block.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          convertEvent(controller, encoder, trimmed.slice(5).trim())
        }
      }
      try {
        for (const event of firstEvents) pushBlock(event)
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''
          for (const event of events) pushBlock(event)
        }
        if (buffer) pushBlock(buffer)
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
    cancel() {
      try {
        void reader.cancel()
      } catch {
        /* ignore */
      }
    },
  })
}
