/* Диагностика: какие русские голоса реально доступны через msedge-tts */
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

const candidates = [
  'ru-RU-DariyaNeural',
  'ru-RU-PavelNeural',
  'ru-RU-SvetlanaNeural',
  'ru-RU-DariyaNeuralDragonHDLatestNeural',
]

for (const voice of candidates) {
  try {
    const tts = new MsEdgeTTS()
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const { audioStream } = tts.toStream('Проверка голоса.', { rate: '+0%', pitch: '+0Hz' })
    const chunks = []
    for await (const chunk of audioStream) chunks.push(Buffer.from(chunk))
    const total = Buffer.concat(chunks).length
    console.log(`OK    ${voice}  (${total} bytes)`)
  } catch (err) {
    console.log(`FAIL  ${voice}  → ${String(err?.message ?? err).slice(0, 160)}`)
  }
}
process.exit(0)
