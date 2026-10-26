import { NextRequest } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'

export const maxDuration = 300

interface ChatRequestBody {
  characterId?: string
  message?: string
  search?: boolean
}

const HISTORY_LIMIT = 16
const MEMORY_LIMIT = 30

function todayDay(): string {
  // Локальная дата в формате YYYY-MM-DD (по серверному времени)
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Фоновое извлечение фактов о пользователе из его сообщения */
async function extractMemoriesInBackground(userText: string): Promise<void> {
  try {
    const zai = await ZAI.create()
    const res = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content: [
            'Извлеки из сообщения пользователя устойчивые факты о нём: имя, профессия, предпочтения, планы, обстоятельства жизни.',
            'Верни ТОЛЬКО JSON-массив коротких строк на русском языке, максимум 3 факта.',
            'Если устойчивых фактов нет, верни []. Никакого другого текста, только JSON.',
          ].join(' '),
        },
        { role: 'user', content: userText.slice(0, 800) },
      ],
      thinking: { type: 'disabled' },
    })
    const raw: string = res?.choices?.[0]?.message?.content ?? ''
    const match = raw.match(/\[[\s\S]*?\]/)
    if (!match) return
    let facts: unknown
    try {
      facts = JSON.parse(match[0])
    } catch {
      return
    }
    if (!Array.isArray(facts)) return
    for (const fact of facts.slice(0, 3)) {
      const text = String(fact).trim().slice(0, 300)
      if (!text) continue
      const exists = await db.memory.findFirst({ where: { content: text } })
      if (!exists) {
        await db.memory.create({ data: { content: text, source: 'chat' } })
      }
    }
  } catch (error) {
    console.error('extractMemoriesInBackground error:', error)
  }
}

/** Фоновое обновление дневника за сегодня */
async function updateDiaryInBackground(
  characterName: string,
  userText: string,
  assistantText: string
): Promise<void> {
  try {
    // Небольшая пауза, чтобы не создавать всплеск LLM-запросов вместе с извлечением памяти
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const day = todayDay()
    const existing = await db.diaryEntry.findUnique({ where: { day } })
    const zai = await ZAI.create()
    const res = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content: [
            'Ты ведёшь краткий дневник разговоров пользователя с голосовыми ассистентами.',
            'Обнови запись за сегодня с учётом новых реплик: 1-2 предложения на русском, сухо и информативно, о чём говорили.',
            'Верни только текст обновлённой записи, без пояснений.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            `Текущая запись за сегодня: ${existing?.content ?? '(пусто)'}`,
            `Новый фрагмент разговора — Пользователь: ${userText.slice(0, 400)}`,
            `${characterName}: ${assistantText.slice(0, 400)}`,
          ].join('\n'),
        },
      ],
      thinking: { type: 'disabled' },
    })
    const summary: string = (res?.choices?.[0]?.message?.content ?? '').trim().slice(0, 600)
    if (!summary) return
    await db.diaryEntry.upsert({
      where: { day },
      create: { day, content: summary },
      update: { content: summary },
    })
  } catch (error) {
    console.error('updateDiaryInBackground error:', error)
  }
}

/** Поиск в интернете через встроенную функцию SDK */
async function webSearchContext(query: string): Promise<string | null> {
  try {
    const zai = await ZAI.create()
    const results = await zai.functions.invoke('web_search', {
      query: query.slice(0, 200),
      num: 5,
    })
    if (!Array.isArray(results) || results.length === 0) return null
    const lines = results.map(
      (r: { name?: string; snippet?: string; host_name?: string }, i: number) =>
        `[${i + 1}] ${r.name ?? ''} (${r.host_name ?? ''}): ${r.snippet ?? ''}`
    )
    return lines.join('\n')
  } catch (error) {
    console.error('webSearchContext error:', error)
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequestBody
    const { characterId, message, search } = body
    const userText = message?.trim()
    if (!characterId || !userText) {
      return new Response(JSON.stringify({ error: 'Нужны characterId и message' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (userText.length > 4000) {
      return new Response(JSON.stringify({ error: 'Сообщение слишком длинное' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const character = await db.character.findUnique({ where: { id: characterId } })
    if (!character) {
      return new Response(JSON.stringify({ error: 'Персонаж не найден' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Сохраняем сообщение пользователя
    await db.message.create({
      data: { characterId: character.id, role: 'user', content: userText },
    })

    // Контекст: история + память + поиск
    const [history, memories] = await Promise.all([
      db.message.findMany({
        where: { characterId: character.id },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
        select: { role: true, content: true },
      }),
      db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: MEMORY_LIMIT }),
    ])

    const systemParts: string[] = [character.persona]
    if (memories.length > 0) {
      systemParts.push(
        'Память о пользователе (используй естественно, не перечисляй вслух): ' +
          memories.map((m) => `- ${m.content}`).join('; ')
      )
    }
    if (search) {
      const searchCtx = await webSearchContext(userText)
      if (searchCtx) {
        systemParts.push(
          'Результаты свежего поиска в интернете (опирайся на них, упомяни, что смотрел в интернете):\n' +
            searchCtx
        )
      } else {
        systemParts.push('Поиск в интернете не дал результатов — ответь из своих знаний и скажи об этом.')
      }
    }
    systemParts.push(
      'Стиль речи для озвучивания: говори живым разговорным языком, короткими фразами; эмоции передавай словами и восклицаниями (междометия вроде «Ой», «Ух ты», «Хм» — умеренно); никаких markdown, эмодзи, списков и символов — всё будет произнесено вслух.'
    )
    systemParts.push(
      'Сегодняшняя дата: ' +
        new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    )

    // История: от старых к новым (последнее сообщение — текущее, уже в БД)
    const chatMessages: Array<{ role: 'assistant' | 'user'; content: string }> = [
      { role: 'assistant', content: systemParts.join('\n\n') },
      ...history
        .slice()
        .reverse()
        .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.content })),
    ]

    const zai = await ZAI.create()
    const upstream = await zai.chat.completions.create({
      messages: chatMessages,
      stream: true,
      thinking: { type: 'disabled' },
    })

    // Если SDK вернул готовый JSON (нет SSE) — отдаём одним куском
    if (!upstream || typeof upstream.getReader !== 'function') {
      const full: string = upstream?.choices?.[0]?.message?.content ?? ''
      await db.message.create({
        data: { characterId: character.id, role: 'assistant', content: full },
      })
      void extractMemoriesInBackground(userText)
      void updateDiaryInBackground(character.name, userText, full)
      const encoder = new TextEncoder()
      return new Response(encoder.encode(full), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
      })
    }

    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    const reader = upstream.getReader()
    let assistantText = ''
    let saved = false

    const saveAssistant = async () => {
      if (saved) return
      saved = true
      const text = assistantText.trim()
      if (text) {
        try {
          await db.message.create({
            data: { characterId: character.id, role: 'assistant', content: text },
          })
          void extractMemoriesInBackground(userText)
          void updateDiaryInBackground(character.name, userText, text)
        } catch (error) {
          console.error('saveAssistant error:', error)
        }
      }
    }

    const sseStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          let buffer = ''
          const parseEvents = (chunk: string, flush = false) => {
            buffer += chunk
            const events = buffer.split('\n\n')
            buffer = flush ? '' : (events.pop() ?? '')
            for (const event of events) {
              for (const line of event.split('\n')) {
                const trimmed = line.trim()
                if (!trimmed.startsWith('data:')) continue
                const payload = trimmed.slice(5).trim()
                if (!payload || payload === '[DONE]') continue
                try {
                  const json = JSON.parse(payload)
                  const delta = json?.choices?.[0]?.delta?.content
                  if (typeof delta === 'string' && delta) {
                    assistantText += delta
                    controller.enqueue(encoder.encode(delta))
                  }
                } catch {
                  // игнорируем неполные/служебные строки
                }
              }
            }
          }

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            parseEvents(decoder.decode(value, { stream: true }))
          }
          parseEvents('', true)
          controller.close()
        } catch (error) {
          console.error('chat stream error:', error)
          if (assistantText) {
            try {
              controller.enqueue(encoder.encode(''))
            } catch {
              // поток уже закрыт
            }
          }
          controller.close()
        } finally {
          await saveAssistant()
        }
      },
      async cancel() {
        // Клиент прервал соединение — сохраняем то, что успели
        await saveAssistant()
        try {
          await reader.cancel()
        } catch {
          // не критично
        }
      },
    })

    return new Response(sseStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error) {
    console.error('POST /api/chat error:', error)
    return new Response(JSON.stringify({ error: 'Ассистент не смог ответить. Попробуйте ещё раз.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
