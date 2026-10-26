// Тест SDK TTS + ASR: генерируем речь и расшифровываем обратно
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

async function main() {
  const zai = await ZAI.create()

  // 1. TTS — возвращает Response-объект
  const ttsResponse = await zai.audio.tts.create({
    input: 'Привет! Я Дария, твой голосовой ассистент. Проверка связи.',
    response_format: 'wav',
  })
  console.log('TTS content-type:', ttsResponse.headers?.get?.('content-type'))
  const buf = Buffer.from(await ttsResponse.arrayBuffer())
  fs.writeFileSync('/home/z/my-project/tmp/test-tts.wav', buf)
  console.log('TTS saved, bytes:', buf.length)

  // 2. ASR on that file
  const b64 = fs.readFileSync('/home/z/my-project/tmp/test-tts.wav').toString('base64')
  const asr = await zai.audio.asr.create({ file_base64: b64 })
  console.log('ASR result:', JSON.stringify(asr).slice(0, 500))

  // 3. Streaming chat test
  const stream = await zai.chat.completions.create({
    messages: [
      { role: 'system', content: 'Отвечай кратко на русском.' },
      { role: 'user', content: 'Скажи одно слово: тест' },
    ],
    stream: true,
    thinking: { type: 'disabled' },
  })
  let acc = ''
  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta?.content || ''
    acc += delta
  }
  console.log('Stream chat OK, accumulated:', acc)
}

main().catch((e) => {
  console.error('TEST FAILED:', e?.message || e)
  process.exit(1)
})
