// Отладка формата стриминговых чанков
import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  const zai = await ZAI.create()
  const stream = await zai.chat.completions.create({
    messages: [
      { role: 'system', content: 'Отвечай кратко на русском.' },
      { role: 'user', content: 'Скажи «привет мир»' },
    ],
    stream: true,
    thinking: { type: 'disabled' },
  })
  let i = 0
  for await (const chunk of stream) {
    if (i < 3) console.log('CHUNK', i, JSON.stringify(chunk).slice(0, 300))
    i++
  }
  console.log('total chunks:', i)
}
main().catch((e) => { console.error('FAILED:', e?.message || e); process.exit(1) })
