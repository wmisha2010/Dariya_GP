/**
 * Тест клиента OpenRouter из /api/chat (src/lib/openrouter.ts).
 * Проверяем: (1) доступность эндпоинта, (2) что неверный ключ даёт 401
 * (значит путь и авторизация правильные), (3) поведение цепочки фолбэка.
 *
 * Запуск: node scripts/test-openrouter.mjs [sk-or-v1-real-key]
 */
const BASE = 'https://openrouter.ai/api/v1'

async function probe(label, key) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'Daria Assistant',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free',
        messages: [
          { role: 'system', content: 'Ты Дария, отвечай по-русски кратко.' },
          { role: 'user', content: 'Привет! Ответь одним коротким предложением.' },
        ],
        stream: false,
        temperature: 0.9,
        max_tokens: 60,
      }),
    })
    const ms = Date.now() - t0
    const text = await res.text()
    if (res.ok) {
      let content = ''
      try {
        const json = JSON.parse(text)
        content = json?.choices?.[0]?.message?.content ?? JSON.stringify(json).slice(0, 200)
      } catch {
        content = text.slice(0, 200)
      }
      console.log(`[${label}] OK ${res.status} за ${ms}мс → ${String(content).slice(0, 200)}`)
    } else {
      console.log(`[${label}] HTTP ${res.status} за ${ms}мс → ${text.slice(0, 220)}`)
    }
  } catch (error) {
    console.log(`[${label}] ОШИБКА СЕТИ: ${String(error?.message ?? error)}`)
  }
}

const realKey = process.argv[2] || ''
console.log('=== 1. Фейковый ключ (ожидаем 401 — путь и auth работают) ===')
await probe('fake-key', 'sk-or-v1-000000000000000000000000000000000000000000000000')
if (realKey) {
  console.log('=== 2. Реальный ключ (ожидаем 200 и русский ответ) ===')
  await probe('real-key', realKey)
} else {
  console.log('=== 2. Реальный ключ не передан — пропускаю ===')
}
