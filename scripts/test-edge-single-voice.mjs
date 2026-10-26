/* Изолированный ретрай-тест одного голоса: не сетевой ли это флак */
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

const voice = process.argv[2] ?? 'ru-RU-DariyaNeural'

for (let i = 1; i <= 3; i++) {
  try {
    const tts = new MsEdgeTTS()
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const { audioStream } = tts.toStream('Проверка голоса номер ' + i + '.', {
      rate: '+0%',
      pitch: '+0Hz',
    })
    const chunks = []
    for await (const chunk of audioStream) chunks.push(Buffer.from(chunk))
    console.log(`OK   попытка ${i}: ${Buffer.concat(chunks).length} bytes`)
  } catch (err) {
    console.log(`FAIL попытка ${i}: ${String(err?.message ?? err).slice(0, 120)}`)
  }
}
process.exit(0)
