// Тест: нестриминговый ответ + роль системного промпта (skill рекомендует 'assistant')
import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  const zai = await ZAI.create()
  const res = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: 'Ты — Дария, ассистент. Отвечай одним коротким словом.' },
      { role: 'user', content: 'Как тебя зовут?' },
    ],
    thinking: { type: 'disabled' },
  })
  console.log('content:', JSON.stringify(res?.choices?.[0]?.message?.content))
  console.log('finish:', res?.choices?.[0]?.finish_reason)
}
main().catch((e) => { console.error('FAILED:', e?.message || e); process.exit(1) })
