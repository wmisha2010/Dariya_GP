// Тест парсинга SSE-стрима из SDK
import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  const zai = await ZAI.create()
  const upstream = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: 'Отвечай кратко на русском.' },
      { role: 'user', content: 'Посчитай от 1 до 5 через запятую' },
    ],
    stream: true,
    thinking: { type: 'disabled' },
  })

  // upstream — ReadableStream
  const reader = upstream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let out = ''
  let events = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const event of parts) {
      for (const line of event.split('\n')) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const payload = t.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const delta = json?.choices?.[0]?.delta?.content
          if (typeof delta === 'string') { out += delta; events++ }
        } catch { /* ignore */ }
      }
    }
  }
  console.log('deltas:', events, '| text:', out)
}
main().catch((e) => { console.error('FAILED:', e?.message || e); process.exit(1) })
