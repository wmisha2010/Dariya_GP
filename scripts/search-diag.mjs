import { webSearch } from '/home/z/my-project/telegram-bot/src/brain.js'

const q = 'курс доллара к рублю'
console.log('--- webSearch с таймингом ---')
const t0 = Date.now()
const r = await webSearch(q)
console.log('webSearch:', r.length, 'результатов за', Date.now() - t0, 'мс')

// --- грубая проверка каждого движка напрямую ---
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const targets = [
  ['ddg-html', 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q)],
  ['ddg-lite', 'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q)],
  ['bing', 'https://www.bing.com/search?q=' + encodeURIComponent(q) + '&setlang=ru&count=8'],
  ['google', 'https://www.google.com/search?q=' + encodeURIComponent(q) + '&num=8&hl=ru'],
  ['mojeek', 'https://www.mojeek.com/search?q=' + encodeURIComponent(q)],
  ['wikipedia', 'https://ru.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&format=json&srsearch=' + encodeURIComponent(q)],
]
for (const [name, url] of targets) {
  const t = Date.now()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': name === 'wikipedia' ? 'DariaBot/0.3 (personal assistant bot)' : UA, 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8' },
      signal: AbortSignal.timeout(8000),
    })
    const body = await res.text()
    console.log(`${name}: HTTP ${res.status}, ${body.length} байт, ${Date.now() - t} мс`)
  } catch (e) {
    console.log(`${name}: ОШИБКА ${e?.message || e} (${Date.now() - t} мс)`)
  }
}
