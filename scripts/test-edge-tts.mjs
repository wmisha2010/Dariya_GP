// Тест Microsoft Edge Neural TTS — ru-RU-SvetlanaNeural (естественный женский)
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { writeFile } from 'fs/promises'

const TEXT = 'Привет! Я Дария. Какое чудесное настроение сегодня, правда? Давай поболтаем.'

async function test(voice, rate, pitch, out) {
  try {
    const started = Date.now()
    const tts = new MsEdgeTTS()
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const { audioStream } = tts.toStream(TEXT, { rate, pitch })
    const chunks = []
    for await (const chunk of audioStream) chunks.push(chunk)
    tts.close()
    const buf = Buffer.concat(chunks)
    const ms = Date.now() - started
    await writeFile(out, buf)
    console.log(`✓ ${voice} rate=${rate} pitch=${pitch}: ${buf.length} байт за ${ms}мс → ${out}`)
  } catch (error) {
    console.log(`✗ ${voice} rate=${rate}: ${error.message}`)
  }
}

await test('ru-RU-SvetlanaNeural', '+0%', '+0Hz', '/tmp/edge-svetlana.mp3')
await test('ru-RU-SvetlanaNeural', '+12%', '+10Hz', '/tmp/edge-svetlana-fast.mp3')
await test('ru-RU-DariinaNeural', '+0%', '+0Hz', '/tmp/edge-dariina.mp3').catch(() => {})
