/**
 * Пробинг свободных бесплатных моделей OpenRouter (у пользователя перегружен
 * дефолт gemma-4-31b). Ищем модель, которая отвечает 200 по-русски.
 *
 * Запуск: node scripts/probe-openrouter-models.mjs <sk-or-v1-key>
 */
const KEY = process.argv[2] || ''
if (!KEY) {
  console.error('Нужен ключ: node scripts/probe-openrouter-models.mjs sk-or-v1-...')
  process.exit(1)
}

const CANDIDATES = [
  'nvidia/nemotron-3.5-lightning:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'recursive/flint-v1.0:free',
  'xingchen-agi/xing4.0-29b-a4b:free',
  'dots-studio/dots-3-note-preview:free',
  'poolside/laguna-s-2.1:free',
]

for (const model of CANDIDATES) {
  const t0 = Date.now()
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'Daria Assistant',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Ты Дария, дерзкая голосовая ассистентка. Отвечай по-русски.' },
          { role: 'user', content: 'Ответь одним коротким предложением: как дела?' },
        ],
        stream: false,
        temperature: 0.9,
        max_tokens: 80,
      }),
    })
    const ms = Date.now() - t0
    const text = await res.text()
    if (res.ok) {
      const json = JSON.parse(text)
      const content = json?.choices?.[0]?.message?.content ?? '(пусто)'
      console.log(`[OK   ${res.status}] ${model} · ${ms}мс → ${String(content).replace(/\s+/g, ' ').slice(0, 140)}`)
    } else {
      console.log(`[HTTP ${res.status}] ${model} · ${ms}мс → ${text.replace(/\s+/g, ' ').slice(0, 150)}`)
    }
  } catch (e) {
    console.log(`[СЕТЬ  ] ${model} · ${String(e?.message ?? e).slice(0, 120)}`)
  }
}
