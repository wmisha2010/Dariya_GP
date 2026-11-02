// Диагностика Edge TTS: видно ли реальную ошибку подключения
import { MsEdgeTTS, OUTPUT_FORMAT } from '/home/z/my-project/node_modules/msedge-tts/dist/index.js'

const tts = new MsEdgeTTS({ enableLogger: true, connectionTimeoutMs: 8000, synthesisTimeoutMs: 12000 })
try {
  await tts.setMetadata('ru-RU-SvetlanaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
  console.log('METADATA OK')
  const { audioStream } = tts.toStream('Тест связи.', { rate: '+12%', pitch: '+2Hz' })
  const chunks = []
  for await (const c of audioStream) chunks.push(Buffer.from(c))
  const buf = Buffer.concat(chunks)
  console.log('AUDIO OK, bytes:', buf.length)
} catch (e) {
  console.error('EDGE ERROR:', e?.message ?? e)
  if (e?.stack) console.error(e.stack.split('\n').slice(0, 4).join('\n'))
}
process.exit(0)
