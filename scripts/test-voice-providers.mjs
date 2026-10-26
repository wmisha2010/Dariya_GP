// Тест доступных TTS-провайдеров с русскими женскими голосами
// Цель: найти самый естественный голос (уровень Алисы Яндекса)

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const TEXT = 'Привет! Я Дария. Какое чудесное настроение сегодня, правда? Давай поболтаем.'

async function testProvider(name, url, headers = {}) {
  try {
    const started = Date.now()
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) })
    const ms = Date.now() - started
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.log(`✗ ${name}: HTTP ${res.status} (${ms}мс) ${body.slice(0, 120)}`)
      return
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const head = buf.subarray(0, 4).toString('hex')
    const isMp3 = head.startsWith('fff3') || head.startsWith('fffb') || head.startsWith('fff2') || buf.subarray(0,3).toString('ascii') === 'ID3'
    const isOgg = buf.subarray(0, 4).toString('ascii') === 'OggS'
    const isWav = buf.subarray(0, 4).toString('ascii') === 'RIFF'
    console.log(
      `${isMp3 || isOgg || isWav ? '✓' : '?'} ${name}: ${buf.length} байт (${ms}мс) ` +
        `формат: ${isMp3 ? 'mp3' : isOgg ? 'ogg' : isWav ? 'wav' : head} ` +
        `скорость: ${(buf.length / 1024 / (ms / 1000)).toFixed(1)} КБ/с`
    )
    const fs = await import('fs')
    fs.writeFileSync(`/tmp/tts-${name.replace(/\W+/g, '_')}.${isOgg ? 'ogg' : isMp3 ? 'mp3' : 'bin'}`, buf)
  } catch (error) {
    console.log(`✗ ${name}: ${error.message}`)
  }
}

// 1. Яндекс TTS (голоса как у Алисы: alyona/omazh/jane/oksana)
for (const [speaker, emotion, speed] of [
  ['alyona', 'good', '1.1'],
  ['alyona', 'neutral', '1.0'],
  ['oksana', 'good', '1.05'],
  ['jane', 'good', '1.0'],
]) {
  const url =
    'https://tts.voicetech.yandex.net/tts?' +
    new URLSearchParams({
      text: TEXT,
      format: 'mp3',
      lang: 'ru_RU',
      speaker,
      emotion,
      speed,
    }).toString()
  await testProvider(`Яндекс ${speaker}/${emotion}/x${speed}`, url)
}

// 2. StreamElements (Amazon Polly): Tatyana — русский женский
await testProvider(
  'Polly Tatyana (StreamElements)',
  'https://api.streamelements.com/kappa/v2/speech?voice=' + encodeURIComponent('Tatyana') + '&text=' + encodeURIComponent(TEXT)
)
// Maximo/Maxim на всякий случай для сравнения пола
await testProvider(
  'Polly Tatyana v2 (StreamElements)',
  'https://api.streamelements.com/kappa/v2/speech?voice=Tatyana&text=' + encodeURIComponent(TEXT)
)

// 3. Текущий Google Translate TTS — базовая линия
await testProvider(
  'Google Translate (текущий)',
  'https://translate.google.com/translate_tts?' +
    new URLSearchParams({ ie: 'UTF-8', q: TEXT, tl: 'ru', client: 'tw-ob' }).toString(),
  { 'User-Agent': UA, Referer: 'https://translate.google.com/' }
)

console.log('\nФайлы сохранены в /tmp/tts-*.mp3 — можно прослушать/проверить через ASR')
