// Быстрый тест Google Translate TTS из Node.js
async function main() {
  const url =
    'https://translate.google.com/translate_tts?' +
    new URLSearchParams({ ie: 'UTF-8', q: 'Привет! Я Дария, твой голосовой помощник.', tl: 'ru', client: 'tw-ob' })
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Referer: 'https://translate.google.com/',
    },
  })
  console.log('status:', res.status, 'content-type:', res.headers.get('content-type'))
  const buf = Buffer.from(await res.arrayBuffer())
  console.log('bytes:', buf.length)
}
main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
