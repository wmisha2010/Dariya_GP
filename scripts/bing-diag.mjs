import { parseBingHtml, parseGoogleHtml, parseDdgHtml } from '/home/z/my-project/telegram-bot/src/brain.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const q = encodeURIComponent('курс доллара к рублю')

// Bing
const t0 = Date.now()
const res = await fetch(`https://www.bing.com/search?q=${q}&setlang=ru&count=8`, {
  headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8' },
  signal: AbortSignal.timeout(10000),
})
const body = await res.text()
console.log(`bing: HTTP ${res.status}, ${body.length} байт, ${Date.now() - t0} мс, redirect: ${res.url}`)
console.log('заголовки ответа:', JSON.stringify(Object.fromEntries(res.headers), null, 0).slice(0, 400))
const parsed = parseBingHtml(body, 5)
console.log('parseBingHtml:', parsed.length, 'результатов')
for (const x of parsed.slice(0, 3)) console.log(' -', x.title, '|', x.url)
// что за страница: первые признаки
console.log('начало тела:', body.slice(0, 300).replace(/\s+/g, ' '))
console.log('есть b_algo:', (body.match(/b_algo/g) || []).length, 'шт')
console.log('есть капча/подтверждение:', /captcha|challenge|verify|g_recaptcha/i.test(body))
