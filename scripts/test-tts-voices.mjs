/**
 * Тест TTS: проверяем, какой язык/голос выдаёт z-ai TTS для русского текста.
 * Стратегия: TTS -> WAV файл -> ASR (распознавание) -> сравниваем текст.
 */
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const TEXT = 'Привет! Меня зовут Дария, я твой голосовой помощник.'

async function ttsToFile(text, voice, out) {
  const zai = await ZAI.create()
  const response = await zai.audio.tts.create({
    input: text,
    ...(voice ? { voice } : {}),
    response_format: 'wav',
  })
  if (!response || typeof response.arrayBuffer !== 'function') {
    throw new Error('bad response')
  }
  const buf = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(out, buf)
  console.log(`[tts] voice=${voice ?? '(default)'} -> ${out} (${buf.length} bytes)`)
  return buf
}

async function asrFile(file) {
  const zai = await ZAI.create()
  const result = await zai.audio.asr.create({ file_base64: fs.readFileSync(file).toString('base64') })
  return result
}

async function main() {
  const voices = [undefined, 'tongtong', 'female', 'female-shaonv', 'male', 'xiaochen']
  for (const voice of voices) {
    const out = `/home/z/my-project/scripts/tts-test-${voice ?? 'default'}.wav`
    try {
      await ttsToFile(TEXT, voice, out)
      try {
        const asr = await asrFile(out)
        console.log(`[asr] voice=${voice ?? '(default)'} ->`, JSON.stringify(asr).slice(0, 300))
      } catch (e) {
        console.log(`[asr] voice=${voice ?? '(default)'} FAILED:`, e instanceof Error ? e.message : e)
      }
    } catch (e) {
      console.log(`[tts] voice=${voice ?? '(default)'} FAILED:`, e instanceof Error ? e.message.slice(0, 200) : e)
    }
  }
}

main()
