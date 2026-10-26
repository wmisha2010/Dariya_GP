/**
 * Финальный тест 2 финалистов в СТРИМИНГЕ (как реальный /api/chat):
 * полностью собираем SSE и показываем, что реально увидит парсер Дарии.
 *
 * Запуск: node scripts/test-openrouter-stream.mjs <sk-or-v1-key>
 */
const KEY = process.argv[2] || ''
const MODELS = ['recursive/flint-v1.0:free', 'dots-studio/dots-3-note-preview:free', 'liquid/lfm-2.5-2.6b:free']

for (const model of MODELS) {
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
          { role: 'system', content: 'Ты Дария — дерзкая, остроумная голосовая ассистентка. Отвечай по-русски, коротко, живо.' },
          { role: 'user', content: 'Привет! Расскажи, что умеешь, парой фраз.' },
        ],
        stream: true,
        temperature: 0.9,
        max_tokens: 300,
      }),
    })
    if (!res.ok) {
      console.log(`[HTTP ${res.status}] ${model} → ${(await res.text()).slice(0, 160)}`)
      continue
    }
    let full = ''
    let firstTokenMs = 0
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    outer: while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const s = line.trim()
        if (!s.startsWith('data:')) continue
        const payload = s.slice(5).trim()
        if (payload === '[DONE]') break outer
        try {
          const j = JSON.parse(payload)
          const delta = j?.choices?.[0]?.delta
          const piece = delta?.content ?? ''
          if (piece) {
            if (!firstTokenMs) firstTokenMs = Date.now() - t0
            full += piece
          }
        } catch { /* comments/ping */ }
      }
    }
    console.log(`[OK] ${model}`)
    console.log(`     первый токен: ${firstTokenMs}мс · всего: ${Date.now() - t0}мс · длина: ${full.length}`)
    console.log(`     ответ: ${full.replace(/\s+/g, ' ').slice(0, 220)}`)
  } catch (e) {
    console.log(`[СЕТЬ] ${model} → ${String(e?.message ?? e).slice(0, 140)}`)
  }
}
