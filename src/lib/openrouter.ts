/**
 * Клиент OpenRouter (openrouter.ai) — агрегатор LLM с OpenAI-совместимым API.
 *
 * Зачем: у Google Gemini бесплатный тариф закрыт для запросов с серверов
 * ряда регионов (Гонконг, Россия и др. — гео-проверка по IP), а у OpenRouter
 * таких ограничений нет, и там есть бесплатные модели (суффикс :free).
 * Если задан OPENROUTER_API_KEY, чат идёт через OpenRouter; при любом сбое
 * вызывающий код откатывается на следующий провайдер (Gemini → Z.ai).
 *
 * Формат: POST /api/v1/chat/completions с stream: true — ответ приходит
 * сразу в OpenAI-SSE (data: {"choices":[{"delta":{"content":...}}]}),
 * поэтому тело ответа отдаём как есть: существующий парсер /api/chat
 * понимает его без изменений. Строки-комментарии «: OPENROUTER …» и
 * завершающий «data: [DONE]» парсер игнорирует сам.
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

export function getOpenRouterKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  return key ? key : null
}

/** Тот же формат хода диалога, что и у Gemini-клиента (user/model строгое чередование) */
export interface OpenRouterTurn {
  role: 'user' | 'model'
  parts: Array<{ text: string }>
}

interface OpenRouterStreamOptions {
  apiKey: string
  /** Большой системный промпт (персона + память + стиль речи) */
  system: string
  /** История диалога в порядке от старых к новым, последняя — реплика пользователя */
  turns: OpenRouterTurn[]
}

/**
 * Стриминговый вызов OpenRouter. Ошибки (401 неверный ключ, 429 лимит
 * бесплатного тарифа, 502 у модели) ловим до возврата потока: если !res.ok —
 * бросаем ошибку, чтобы вызывающий код переключился на следующий провайдер,
 * а не отдавал пользователю пустой ответ.
 */
export async function createOpenRouterStream(options: OpenRouterStreamOptions): Promise<ReadableStream<Uint8Array>> {
  // Бесплатные модели меняются со временем — список: openrouter.ai/models?max_price=0
  const model = process.env.OPENROUTER_MODEL?.trim() || 'google/gemma-4-31b-it:free'

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: options.system },
    ...options.turns.map((turn) => ({
      role: turn.role === 'model' ? 'assistant' : 'user',
      content: turn.parts.map((p) => p.text).join('\n'),
    })),
  ]

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      // Служебная атрибуция OpenRouter (необязательна, но рекомендована)
      'X-Title': 'Daria Assistant',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.9,
      max_tokens: 1024,
    }),
  })

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '')
    throw new Error(`OpenRouter HTTP ${res.status}: ${errText.slice(0, 200)}`)
  }

  return res.body
}
