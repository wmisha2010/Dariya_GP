/**
 * Тесты мозга Дарии-бота: node test-brain.mjs
 * Тот же подход, что в scripts/test-wake.mjs веб-версии (v2.4).
 */
import {
  levenshtein,
  isTriggerToken,
  extractCommand,
  resolveCommand,
  askLLM,
  needsWebSearch,
  buildSearchQuery,
  parseDdgHtml,
  parseDdgLiteHtml,
  parseBingHtml,
  parseGoogleHtml,
  formatSearchContext,
  webSearch,
} from './src/brain.js'

let passed = 0
let failed = 0

function check(name, cond, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

console.log('── Триггеры ──')
check('levenshtein(кот, код)=1', levenshtein('кот', 'код') === 1)
check('«дария» — триггер', isTriggerToken('дария'))
check('«Дария» в любом регистре', isTriggerToken('ДаРиЯ'))
check('«далее» → «дария» (опечатка из v2.4)', isTriggerToken('далее'))
check('«даря» → нечётко совпадает', isTriggerToken('даря'))
check('«даша» — триггер', isTriggerToken('даша'))
check('«алиса» — триггер', isTriggerToken('алиса'))
check('«малина» — НЕ триггер (первая буква)', !isTriggerToken('малина'))
check('«дорога» — НЕ триггер (слишком далеко)', !isTriggerToken('дорога'))
check('«погода» — НЕ триггер', !isTriggerToken('погода'))

console.log('── Обращение ──')
{
  const r = extractCommand('Дария, привет')
  check('«Дария, привет» → привет', r.found && r.command === 'привет')
}
{
  const r = extractCommand('дарья включи радио')
  check('«дарья включи радио» → включи радио', r.found && r.command === 'включи радио')
}
{
  const r = extractCommand('далее, как дела?')
  check('«далее, как дела?» → как дела', r.found && r.command === 'как дела')
}
{
  const r = extractCommand('Дария,как дела')
  check('без пробела после имени', r.found && r.command === 'как дела')
}
{
  const r = extractCommand('привет')
  check('без имени — не обращение', !r.found)
}
{
  const r = extractCommand('дорога, привет')
  check('«дорога» — не обращение', !r.found)
}
{
  const r = extractCommand('ну даша, привет')
  check('«ну даша, привет» → привет', r.found && r.command === 'привет')
}

console.log('── Быстрые ответы ──')
const W = 'https://daria.example.workers.dev'
{
  const r = resolveCommand('', { webAppUrl: W })
  check('пустая команда → приветствие', r.handled && /привет/i.test(r.text))
}
{
  const r = resolveCommand('помощь')
  check('«помощь» → список умений', r.handled && r.text.includes('умею'))
}
{
  const r = resolveCommand('/start')
  check('«/start» → список умений', r.handled && r.text.includes('умею'))
}
{
  const r = resolveCommand('привет')
  check('«привет» → приветствие', r.handled && /привет/i.test(r.text))
}
{
  const r = resolveCommand('как дела')
  check('«как дела» → ответ', r.handled && r.text.length > 5)
}
{
  const r = resolveCommand('кто ты')
  check('«кто ты» → представление', r.handled && /Дария/i.test(r.text))
}
{
  const r = resolveCommand('спасибо')
  check('«спасибо» → ответ', r.handled && r.text.length > 3)
}
{
  const r = resolveCommand('сколько времени')
  check('«сколько времени» → часы ЧЧ:ММ', r.handled && /\d{1,2}:\d{2}/.test(r.text))
}
{
  const r = resolveCommand('какое сегодня число')
  check('«какое сегодня число» → дата', r.handled && /Сегодня/i.test(r.text))
}

console.log('── Медиа-команды ──')
{
  const r = resolveCommand('включи радио', { webAppUrl: W })
  check('«включи радио» → ссылка на веб-версию', r.handled && r.text.includes(W) && /радио/i.test(r.text))
}
{
  const r = resolveCommand('включи музыку', { webAppUrl: W })
  check('«включи музыку» → ссылка на веб-версию', r.handled && r.text.includes(W))
}
{
  const r = resolveCommand('выключи музыку', { webAppUrl: W })
  check('«выключи музыку» → стоп-ответ без переключения', r.handled && r.text.includes(W))
}
{
  const r = resolveCommand('выключи ютуб')
  check('«выключи ютуб» → стоп-ответ', r.handled && /выключать нечего|не включаю/i.test(r.text))
}
{
  const r = resolveCommand('выключила музыку вчера')
  check('«выключила» не ловится как стоп', !r.handled)
}
{
  const r = resolveCommand('включи ютуб')
  check('«включи ютуб» → просит ссылку', r.handled && /ссылк/i.test(r.text))
}
{
  const r = resolveCommand('глянь https://www.youtube.com/watch?v=abc123')
  check('ютуб-ссылка → «Лови ▶»', r.handled && r.text.includes('youtube.com/watch?v=abc123'))
}
{
  const r = resolveCommand('youtu.be/dQw4w9WgXcQ')
  check('короткая youtu.be-ссылка → https', r.handled && r.text.includes('https://youtu.be/dQw4w9WgXcQ'))
}

console.log('── Веб-поиск: когда искать ──')
check('погода → искать', needsWebSearch('погода в Красноярске'))
check('погугли котиков → искать', needsWebSearch('погугли котиков'))
check('курс доллара → искать', needsWebSearch('какой сейчас курс доллара'))
check('новости → искать', needsWebSearch('расскажи последние новости'))
check('сколько стоит айфон → искать', needsWebSearch('сколько стоит айфон 17'))
check('кто победил → искать', needsWebSearch('кто победил вчера в финале'))
check('когда выйдет фильм → искать', needsWebSearch('когда выйдет второй сезон'))
check('«как дела» → НЕ искать', !needsWebSearch('как дела'))
check('«расскажи анекдот» → НЕ искать', !needsWebSearch('расскажи анекдот'))
check('«ты кто» → НЕ искать', !needsWebSearch('ты кто'))
check('пустая строка → НЕ искать', !needsWebSearch(''))

console.log('── Веб-поиск: запрос и формат ──')
check('«погугли котиков» → запрос «котиков»', buildSearchQuery('погугли котиков') === 'котиков')
check('«поищи в интернете погоду» → «погоду»', buildSearchQuery('поищи в интернете погоду') === 'погоду')
check('обычный текст не режется', buildSearchQuery('погода в Москве') === 'погода в Москве')
{
  const ctx = formatSearchContext(
    [{ title: 'Погода', url: 'https://pogoda.ru', snippet: 'Сегодня солнечно' }],
    'погода в Москве',
  )
  check('контекст: есть запрос', ctx.includes('погода в Москве'))
  check('контекст: есть заголовок', ctx.includes('Погода'))
  check('контекст: есть сниппет', ctx.includes('Сегодня солнечно'))
  check('контекст: пустая выдача → пустая строка', formatSearchContext([], 'тест') === '')
}

console.log('── Веб-поиск: парсеры выдачи ──')
{
  const html = [
    '<div class="result results_links">',
    '<a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fpogoda.ru%2Fmsk&amp;rut=abc" class="result__a">Погода в <b>Москве</b></a>',
    '<a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fpogoda.ru%2Fmsk&amp;rut=abc">Сегодня +20, &amp;солнечно</a>',
    '</div>',
    '<a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fy.js%3Fad_provider%3Dx" class="result__a">Реклама</a>',
  ].join('')
  const out = parseDdgHtml(html, 5)
  check('html-выдача: 1 результат (реклама отфильтрована)', out.length === 1)
  check('html-выдача: чистый url из uddg', out[0]?.url === 'https://pogoda.ru/msk')
  check('html-выдача: теги вырезаны', out[0]?.title === 'Погода в Москве')
  check('html-выдача: сущности декодированы', out[0]?.snippet.includes('солнечно'))
}
{
  const lite = [
    "<a rel=\"nofollow\" href='https://lite.example.ru/1' class='result-link'>Курс доллара</a>",
    "<td class='result-snippet'>Доллар — 80 рублей</td>",
  ].join('')
  const out = parseDdgLiteHtml(lite, 5)
  check('lite-выдача: результат найден', out.length === 1 && out[0].url === 'https://lite.example.ru/1')
  check('lite-выдача: сниппет на месте', out[0]?.snippet === 'Доллар — 80 рублей')
}
{
  const bing = [
    '<li class="b_algo"><h2><a href="https://news.ru/1">Новости <b>сегодня</b></a></h2>',
    '<div class="b_caption"><p>Что произошло в мире</p></div></li>',
    '<li class="b_algo"><h2><a href="/relative">Относительная ссылка — пропустить</a></h2></li>',
  ].join('')
  const out = parseBingHtml(bing, 5)
  check('bing-выдача: 1 результат', out.length === 1)
  check('bing-выдача: url и заголовок', out[0]?.url === 'https://news.ru/1' && out[0]?.title === 'Новости сегодня')
  check('bing-выдача: сниппет', out[0]?.snippet === 'Что произошло в мире')
}
{
  const dirty = '<li class="b_algo"><h2><a href="https://ria.ru/">ria.ruhttps://ria.ru</a></h2><p>Лента новостей</p></li>'
  const out = parseBingHtml(dirty, 5)
  check('bing-выдача: адрес вычищен из заголовка', out[0]?.title === 'ria.ru')
}
{
  const google = [
    '<a href="/url?q=https://example.ru/a&sa=U&ved=x">Пример <b>новость</b></a>',
    '<a href="/url?q=https://www.google.com/search%3Fq%3Dx&sa=U">Внутренний — пропустить</a>',
  ].join('')
  const out = parseGoogleHtml(google, 5)
  check('google-выдача: 1 результат (внутренние отфильтрованы)', out.length === 1)
  check('google-выдача: url и заголовок', out[0]?.url === 'https://example.ru/a' && out[0]?.title === 'Пример новость')
}

console.log('── Без ИИ-ключей ──')
{
  const r = await askLLM([{ role: 'user', content: 'тест' }], {})
  check('askLLM без ключей → null', r === null)
  const quick = resolveCommand('что такое звезда', {})
  check('свободная тема без ключей → ушла бы в LLM', !quick.handled)
}

console.log('── Веб-поиск: регрессия вызова движков ──')
{
  const realFetch = globalThis.fetch
  const bingHtml =
    '<li class="b_algo"><h2><a href="https://regress.ru/x">Регресс результат</a></h2><p>Сниппет регрессии</p></li>'
  globalThis.fetch = async (url) => {
    if (/bing\.com/.test(String(url))) return new Response(bingHtml, { status: 200 })
    return new Response('blocked', { status: 500 })
  }
  try {
    const r = await webSearch('регрессия движков ' + Date.now())
    check('webSearch вернул массив, а не функцию', Array.isArray(r) && typeof r !== 'function')
    check('webSearch: победил bing', r[0]?.engine === 'bing')
    check('webSearch: результат распарсен', r[0]?.url === 'https://regress.ru/x' && r[0]?.title === 'Регресс результат')
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log('── Валюты: приоритет ЦБ РФ ──')
{
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (/cbr-xml-daily/.test(String(url))) {
      return new Response(
        JSON.stringify({
          Date: '2026-10-31T11:30:00+03:00',
          Valute: {
            USD: { Name: 'Доллар США', Value: 80.5573, Previous: 80.6761 },
            EUR: { Name: 'Евро', Value: 89.6603, Previous: 89.8167 },
          },
        }),
        { status: 200 },
      )
    }
    return new Response('blocked', { status: 500 })
  }
  try {
    const r = await webSearch('курс доллара к рублю тест ' + Date.now())
    check('валюта: источник — ЦБ РФ', r[0]?.engine === 'цб-рф')
    check('валюта: точное значение в сниппете', r[0]?.snippet.includes('80,56'))
    check('валюта: дата курса указана', r[0]?.title.includes('31.10.2026'))
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log('── Bing: раскодировка редиректов и фильтр мусора ──')
{
  const dirty = [
    '<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;u=a1aHR0cHM6Ly9leGFtcGxlLnJ1Lw==">Пример сайта</a></h2><p>Сниппет примера</p></li>',
    '<li class="b_algo"><h2><a href="https://www.bing.com/set/search">Bing</a></h2></li>',
  ].join('')
  const out = parseBingHtml(dirty, 5)
  check('bing: редирект /ck/a раскодирован', out[0]?.url === 'https://example.ru/')
  check('bing: ссылка бинга на себя отброшена', out.length === 1)
}

console.log('── Контекст поиска: честность ──')
{
  const ctx = formatSearchContext([{ title: 'Т', url: 'https://x.ru', snippet: 'С' }], 'тест')
  check('контекст: предупреждение о старых сниппетах', ctx.includes('старые данные'))
  check('контекст: запрет выдумывать цифры', ctx.includes('не выдумывай цифры'))
}

console.log(`\nИтого: ${passed} прошло, ${failed} упало`)
process.exit(failed ? 1 : 0)
