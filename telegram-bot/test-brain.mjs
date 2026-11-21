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
  newsSearch,
  parseNewsRss,
  splitTelegramMessage,
  extractImageIntent,
  geminiImage,
  parseDdgHtml,
  parseDdgLiteHtml,
  parseBingHtml,
  parseGoogleHtml,
  formatSearchContext,
  webSearch,
  extractWeatherCity,
  cityCandidates,
  fixFalseGoogled,
  stripToolCallMarkup,
  withCityContext,
  timeLookup,
  weatherLookup,
  resetGeminiBreaker,
  resetCoarenaBreaker,
  withImageParts,
  VISION_OPENROUTER,
  transcribeAudio,
  speakText,
  speakTextWeb,
  generateImage,
  workersAiImage,
  translateImagePrompt,
  extractPageText,
  readPage,
  readPagesContext,
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
  check('контекст: запрет выдумывать цифры', ctx.includes('ДОСЛОВНО'))
}

console.log('── Погода: город и приоритет open-meteo ──')
{
  check('город: «погода в Красноярске»', extractWeatherCity('какая погода в Красноярске') === 'Красноярске')
  check('город: «в Нижнем Новгороде завтра»', extractWeatherCity('погода в Нижнем Новгороде завтра') === 'Нижнем Новгороде')
  check('город: без города → пусто', extractWeatherCity('какая погода') === '')
  check('город: «на улице» не город', extractWeatherCity('что на улице, холодно?') === '')
  check('город: «А погода? Ачинске» (приклейка с «?»)', extractWeatherCity('А погода? Ачинске') === 'Ачинске')
  check('город: «А погода? в Ачинске»', extractWeatherCity('А погода? в Ачинске') === 'Ачинске')
  check('кандидаты: «Красноярске» → «Красноярск»', cityCandidates('Красноярске').includes('Красноярск'))
  check('кандидаты: «Тюмени» → «Тюмень»', cityCandidates('Тюмени').includes('Тюмень'))
  check('кандидаты: «Москве» → «Москва»', cityCandidates('Москве').includes('Москва'))

  const realFetch = globalThis.fetch
  const geoFixture = {
    results: [
      { name: 'Тестоград', latitude: 55.1, longitude: 82.9, admin1: 'Тестовая область', population: 950000 },
      { name: 'Тестоградка', latitude: 51, longitude: 80, admin1: 'Деревенский', population: 120 },
    ],
  }
  const meteoFixture = {
    current: { temperature_2m: -10.4, apparent_temperature: -15.3, relative_humidity_2m: 80, wind_speed_10m: 6, weather_code: 71 },
    daily: { time: ['2026-11-02', '2026-11-03'], temperature_2m_min: [-12, -11], temperature_2m_max: [-5, -6] },
  }
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (/geocoding-api\.open-meteo/.test(u)) return new Response(JSON.stringify(geoFixture), { status: 200 })
    if (/api\.open-meteo/.test(u)) return new Response(JSON.stringify(meteoFixture), { status: 200 })
    return new Response('blocked', { status: 500 })
  }
  try {
    const r = await webSearch('какая погода в Тестограде ' + Date.now())
    check('погода: источник open-meteo', r[0]?.engine === 'open-meteo')
    check('погода: выбрал крупный город', r[0]?.title.includes('Тестоград, Тестовая область'))
    check('погода: температура в сниппете', r[0]?.snippet.includes('-10°C'))
    check('погода: код 71 = снег', r[0]?.snippet.includes('небольшой снег'))
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log('── Время в городе: часовой пояс из геокодера (v0.3.7) ──')
{
  const realFetch = globalThis.fetch
  const geoFixture = {
    results: [
      { name: 'Ачинск', latitude: 56.27, longitude: 90.5, admin1: 'Красноярский край', population: 100000, timezone: 'Asia/Krasnoyarsk' },
    ],
  }
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (/geocoding-api\.open-meteo/.test(u)) return new Response(JSON.stringify(geoFixture), { status: 200 })
    return new Response('blocked', { status: 500 })
  }
  try {
    const r = await webSearch('посмотри в сети в Ачинске сколько время ' + Date.now())
    check('время: источник geo-tz', r[0]?.engine === 'geo-tz')
    check('время: часы в сниппете', /[0-9]{2}:[0-9]{2}/.test(r[0]?.snippet || ''))
    check('время: пояс указан', (r[0]?.snippet || '').includes('Asia/Krasnoyarsk'))
    check('время: разница с Москвой +4', (r[0]?.snippet || '').includes('разница с Москвой +4 ч'))
    const t2 = await timeLookup('время в Тестограде ' + Date.now())
    check('время: direct lookup тоже работает', /Время: Ачинск|Время: /.test(t2.title))
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log('── Праздники/даты: поиск включается ──')
{
  check('праздник: «сегодня есть праздник» → поиск', needsWebSearch('Сегодня есть праздник в России?') === true)
  check('дата: «какой сегодня день недели» → поиск', needsWebSearch('какой сегодня день недели') === true)
  check('обычная болтовня → без поиска', needsWebSearch('как у тебя дела, красотка') === false)
}

console.log('── Честность: ложное «погуглила» ──')
{
  check('«Погуглила — курс» → «Вспомнила»', fixFalseGoogled('Погуглила — курс 80 ₽') === 'Вспомнила — курс 80 ₽')
  check('«я погуглила в интернете» → «вспомнила»', fixFalseGoogled('я погуглила в интернете') === 'я вспомнила в интернете')
  check('«погуглю» не трогаем', fixFalseGoogled('попроси — погуглю') === 'попроси — погуглю')
  check('«погуглить» не трогаем', fixFalseGoogled('хочу погуглить') === 'хочу погуглить')
  check('без слова — текст прежний', fixFalseGoogled('обычный ответ') === 'обычный ответ')
}

console.log('── Зачистка tool-call разметки (v0.3.6) ──')
{
  const dots = '<dots_function_call>\nweb_search\n<parameter name="query">время в Ачинске</parameter>\n</dots_function_call>'
  check('dots-вызов целиком → пусто', stripToolCallMarkup(dots) === '')
  check('незакрытый tool_call → пусто', stripToolCallMarkup('<tool_call>{"name":"web_search"}') === '')
  check('<invoke> → пусто', stripToolCallMarkup('<invoke name="web_search"><parameter>q</parameter></invoke>') === '')
  check('JSON-вызов → пусто', stripToolCallMarkup('{"name":"web_search","arguments":{"query":"погода"}}') === '')
  check('текст + dots-блок → остаётся текст',
    stripToolCallMarkup('Сейчас гляну. <dots_function_call><parameter>q</parameter></dots_function_call>') === 'Сейчас гляну.')
  check('обычный ответ не тронут',
    stripToolCallMarkup('Привет! Дела отлично 😄') === 'Привет! Дела отлично 😄')
  check('пустая строка → пусто', stripToolCallMarkup('') === '')
  check('null → пусто', stripToolCallMarkup(null) === '')
}

console.log('── Триггеры поиска: «посмотри в сети», время в городе ──')
{
  check('«посмотри в сети в Ачинске сколько время» → поиск', needsWebSearch('посмотри в сети в Ачинске сколько время') === true)
  check('«глянь в яндексе новости» → поиск', needsWebSearch('глянь в яндексе новости') === true)
  check('«сколько времени в Ачинске» → поиск', needsWebSearch('сколько времени в Ачинске') === true)
  check('«время в Красноярске» → поиск', needsWebSearch('время в Красноярске') === true)
  check('голое «Время» → БЕЗ поиска (быстрый ответ)', needsWebSearch('Время') === false)
  check('«сколько времени займёт доставка» → БЕЗ поиска (не про город)', needsWebSearch('сколько времени займёт доставка') === false)
}

console.log('── Погода без города: город из истории диалога ──')
{
  check('«А погода?» + история про Ачинск → добавляем город',
    withCityContext('А погода?', ['посмотри в сети в Ачинске сколько время']) === 'А погода? в Ачинске')
  check('город с именительного тоже подхватывается',
    withCityContext('а погода?', ['Дария, какая погода в Красноярске сейчас']) === 'а погода? в Красноярске')
  check('без истории — как было', withCityContext('А погода?', []) === 'А погода?')
  check('непогодная фраза не тронута',
    withCityContext('как дела?', ['какая погода в Ачинске']) === 'как дела?')
  check('с городом в самой фразе — не дублируем',
    withCityContext('погода в Тюмени?', ['был в Ачинске']) === 'погода в Тюмени?')
}

console.log('── buildSearchQuery: «посмотри в сети …» ──')
{
  check('срезаем «посмотри в сети»',
    buildSearchQuery('посмотри в сети в Ачинске сколько время') === 'в Ачинске сколько время')
  check('срезаем «глянь в яндексе»',
    buildSearchQuery('глянь в яндексе новости про радио') === 'новости про радио')
}

console.log('── Новости: Google News RSS вместо статей Википедии ──')
{
  // Фразы, которые раньше проскакивали мимо триггера (претензия владельца)
  check('«что нового?» → поиск', needsWebSearch('что нового?') === true)
  check('«что происходит в мире» → поиск', needsWebSearch('что происходит в мире') === true)
  check('«что творится в мире» → поиск', needsWebSearch('что творится в мире') === true)
  check('«что слышно?» → поиск', needsWebSearch('что слышно?') === true)

  // Разбор RSS-ленты Google News: «Заголовок - Источник», link, pubDate
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Top Stories</title>
<item><title>Срочный заголовок первый - РИА Новости</title><link>https://news.google.com/rss/articles/a?oc=5</link><pubDate>Tue, 17 Nov 2026 18:30:00 GMT</pubDate><source url="https://ria.ru">РИА Новости</source></item>
<item><title>Второй заголовок - ТАСС</title><link>https://news.google.com/rss/articles/b?oc=5</link><pubDate>Wed, 18 Nov 2026 08:00:00 GMT</pubDate></item>
<item><title>Без ссылки</title></item>
</channel></rss>`
  const items = parseNewsRss(xml, 6)
  check('parseNewsRss: 2 валидных item из 3', items.length === 2)
  check('parseNewsRss: источник отрезан от заголовка', items[0].title === 'Срочный заголовок первый')
  check('parseNewsRss: engine = google-news', items.every((r) => r.engine === 'google-news'))
  check('parseNewsRss: источник в сниппете', items[0].snippet.includes('РИА Новости'))
  check('parseNewsRss: источник из хвоста заголовка (без <source>)', items[1].snippet.includes('ТАСС'))
  check('parseNewsRss: дата из pubDate в сниппете', /[0-9]{2}:[0-9]{2}/.test(items[0].snippet))
}
{
  // newsSearch: общий запрос → главная лента, с темой → поиск по ленте
  const realFetch = globalThis.fetch
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(String(url))
    return new Response(
      '<rss><channel><item><title>Живой заголовок - Лента</title><link>https://news.google.com/x?oc=5</link><pubDate>Wed, 18 Nov 2026 09:00:00 GMT</pubDate></item></channel></rss>',
      { headers: { 'content-type': 'application/rss+xml' } },
    )
  }
  try {
    const top = await newsSearch('последние новости')
    check('newsSearch: общий запрос → гонка лент (Google News + Lenta + РИА + ТАСС)',
      urls.includes('https://news.google.com/rss?hl=ru&gl=RU&ceid=RU:ru')
      && urls.includes('https://lenta.ru/rss/news')
      && urls.includes('https://ria.ru/export/rss2/archive/index.xml')
      && urls.includes('https://tass.ru/rss/v2.xml'))
    check('newsSearch: разобрал живой заголовок', top.length === 1 && top[0].title === 'Живой заголовок')
    check('newsSearch: у победителя метка ленты', ['google-news', 'lenta', 'ria', 'tass'].includes(top[0].engine))
    const themed = await newsSearch('новости футбола')
    check('newsSearch: тема → гонка Google News ↔ Bing News topic',
      urls.some((u) => u.startsWith('https://news.google.com/rss/search?q=') && u.includes('%D1%84'))
      && urls.some((u) => u.startsWith('https://www.bing.com/news/search?q=')))
    check('newsSearch: тема вернула результат', themed.length === 1)
    const viaWeb = await webSearch('свежие новости в мире ' + Date.now())
    check('webSearch: новостной запрос идёт в Google News, не в Википедию',
      viaWeb.length === 1 && viaWeb[0].engine === 'google-news' && urls.every((u) => !u.includes('wikipedia')))
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log('── Длинные ответы: разбивка под лимит Telegram (4096) ──')
{
  check('короткий текст → один кусок без изменений',
    JSON.stringify(splitTelegramMessage('Привет, я Дария')) === JSON.stringify(['Привет, я Дария']))
  check('пустая строка → без кусков', splitTelegramMessage('').length === 0)
  const long = Array.from({ length: 60 }, (_, i) =>
    `Абзац номер ${i}: и вот довольно длинное предложение про жизнь, погоду и всё на свете.`).join('\n\n')
  const chunks = splitTelegramMessage(long)
  check('длинный текст → несколько кусков', chunks.length >= 2)
  check('каждый кусок не длиннее 4000 символов', chunks.every((c) => c.length <= 4000))
  check('содержание не потерялось',
    chunks.join(' ').replace(/\s+/g, ' ').trim() === long.replace(/\s+/g, ' ').trim())
  check('резы по абзацам: куски заканчиваются на «.»', chunks.slice(0, -1).every((c) => c.endsWith('.')))
  const huge = 'слово'.repeat(2000) // 10000 символов без единого пробела
  const hchunks = splitTelegramMessage(huge)
  check('текст без переносов → жёсткий разрез', hchunks.length >= 2 && hchunks.every((c) => c.length <= 4000))
  check('ровно 4000 символов → один кусок', splitTelegramMessage('а'.repeat(4000)).length === 1)
  check('4001 символ → два куска', splitTelegramMessage('а'.repeat(4001)).length === 2)
  // деградированные лимиты: не зависаем, не роняем (guard переприсваивания — урок v0.3.21)
  const oneChar = splitTelegramMessage('слово'.repeat(3000), 1)
  check('limit=1: не зависает, куски ≤ 1 символа',
    oneChar.length >= 2 && oneChar.every((c) => c.length <= 1))
  check('limit=0 → откат к дефолту 4000',
    splitTelegramMessage('а'.repeat(4000), 0).length === 1)
}

console.log('── Рисование: интент «нарисуй …» и geminiImage ──')
{
  check('«нарисуй кота в шляпе» → «кота в шляпе»',
    extractImageIntent('нарисуй кота в шляпе') === 'кота в шляпе')
  check('«изобрази закат над морем» → «закат над морем»',
    extractImageIntent('изобрази закат над морем') === 'закат над морем')
  check('«сделай картинку про Париж» → «Париж»',
    extractImageIntent('сделай картинку про Париж') === 'Париж')
  check('«сгенерируй фото рыжего кота» → «рыжего кота»',
    extractImageIntent('сгенерируй фото рыжего кота') === 'рыжего кота')
  check('«Ну нарисуйка звёздное небо» → «звёздное небо»',
    extractImageIntent('Ну нарисуйка звёздное небо') === 'звёздное небо')
  check('отказ «не рисуй» → не заказ', extractImageIntent('не рисуй') === null)
  check('вопрос «как нарисовать дом?» → не заказ', extractImageIntent('как нарисовать дом?') === null)
  check('голый «нарисуй» без объекта → не заказ', extractImageIntent('нарисуй') === null)
  check('болтовня про живопись → не заказ', extractImageIntent('расскажи про живопись') === null)
}
{
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  const b64 = 'iVBORw0KGgo' + 'A'.repeat(1400)
  // Interactions API ответил картинкой → первый же модели хватает
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('/v1beta/interactions') && init?.headers?.['x-goog-api-key'] === 'test-key') {
      return new Response(JSON.stringify({
        steps: [{ type: 'model_output', content: [
          { type: 'text', text: 'Вот твоя картинка' },
          { type: 'image', mime_type: 'image/png', data: b64 },
        ] }],
      }), { status: 200 })
    }
    return new Response('unexpected', { status: 500 })
  }
  try {
    const r = await geminiImage('кот в шляпе', { geminiKey: 'test-key' })
    check('Interactions API: картинка найдена в глубине ответа',
      !!r.image && r.image.mime === 'image/png' && r.image.b64.length > 1000)
    check('Interactions API: модель — nano-banana-2.1', r.image?.model === 'gemini-nano-banana-2.1')
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
  }
}
{
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  // Interactions 404 у ключа → откат на legacy generateContent с inlineData
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('/v1beta/interactions')) return new Response('not found', { status: 404 })
    if (u.includes('/models/gemini-2.5-flash-image:generateContent')) {
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [
          { text: 'думаю...' },
          { inlineData: { mimeType: 'image/jpeg', data: 'J' + 'B'.repeat(1200) } },
        ] } }],
      }), { status: 200 })
    }
    return new Response('unexpected', { status: 500 })
  }
  try {
    const r = await geminiImage('закат', { geminiKey: 'test-key' })
    check('legacy-откат: inlineData вытащен, mime jpeg',
      !!r.image && r.image.mime === 'image/jpeg' && r.image.model === 'gemini-2.5-flash-image')
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
  }
}
{
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  // всё недоступно → честный { error, tried } без image
  globalThis.fetch = async () => new Response('{"error":"quota"}', { status: 429 })
  try {
    const r = await geminiImage('космос', { geminiKey: 'test-key' })
    check('все модели недоступны → error + tried без image',
      !r.image && typeof r.error === 'string' && Array.isArray(r.tried) && r.tried.length >= 3)
    check('без ключа → сразу честный отказ',
      !(await geminiImage('кот', { geminiKey: '' })).image)
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
  }
}

console.log('── Зрение: фото в askLLM (coarena/gemini/openrouter) ──')
{
  const history = [
    { role: 'user', content: 'привет' },
    { role: 'assistant', content: 'Привет!' },
    { role: 'user', content: 'что это?' },
  ]
  const plain = withImageParts(history, null)
  check('без фото — сообщения как были', plain === history)
  const out = withImageParts(history, { b64: 'ABC'.repeat(50), mime: 'image/jpeg' })
  check('с фото: последняя user-реплика = [текст + image_url data-URL]',
    Array.isArray(out[2].content) && out[2].content[0].type === 'text'
    && out[2].content[1].type === 'image_url'
    && out[2].content[1].image_url.url.startsWith('data:image/jpeg;base64,ABC'))
  check('остальные реплики не тронуты',
    out[0].content === 'привет' && out[1].content === 'Привет!')
}
{
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  const b64 = 'ABC'.repeat(60)
  let captured = null
  // Coarena принимает фото: body.messages[last user].content — массив с image_url
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('coarena.ai/api/v1/chat/completions')) {
      captured = JSON.parse(init.body)
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Это красный квадрат' } }] }), { status: 200 })
    }
    return new Response('unexpected', { status: 500 })
  }
  try {
    resetCoarenaBreaker()
    const reply = await askLLM(
      [{ role: 'user', content: 'что на фото?' }],
      { coarenaKey: 'k', photo: { b64, mime: 'image/jpeg' } },
    )
    const last = captured?.messages?.[captured.messages.length - 1]
    check('coarena: фото ушло в image_url, ответ получен',
      reply === 'Это красный квадрат' && Array.isArray(last?.content)
      && last.content[1]?.image_url?.url === `data:image/jpeg;base64,${b64}`)
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
  }
}
{
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  const b64 = 'XYZ'.repeat(60)
  let orBody = null
  let orModels = null
  let coarenaCalls = 0
  // Coarena не умеет vision (400×3), OpenRouter выручает: модели включают vision-цепочку
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('coarena.ai')) { coarenaCalls += 1; return new Response('no vision', { status: 400 }) }
    if (u.includes('openrouter.ai')) {
      orBody = JSON.parse(init.body)
      orModels = orBody.models
      return new Response(JSON.stringify({ choices: [{ message: { content: 'На фото кот' } }] }), { status: 200 })
    }
    return new Response('unexpected', { status: 500 })
  }
  try {
    resetCoarenaBreaker()
    const reply = await askLLM(
      [{ role: 'user', content: 'кто это?' }],
      { coarenaKey: 'k', openrouterKey: 'ok', photo: { b64, mime: 'image/jpeg' } },
    )
    const last = orBody?.messages?.[orBody.messages.length - 1]
    check('openrouter: vision-модели в цепочке + картинка в сообщении',
      reply === 'На фото кот' && orModels?.includes(VISION_OPENROUTER[0])
      && Array.isArray(last?.content) && last.content[1]?.image_url?.url.includes(b64))
    // два фото-провала подряд → текстовый вызов всё ещё долбит Coarena (автомат
    // не сработал). 3 вызова × 3 модели цепочки = 9 запросов к coarena.ai
    await askLLM([{ role: 'user', content: 'ещё фото' }], { coarenaKey: 'k', openrouterKey: 'ok', photo: { b64, mime: 'image/jpeg' } })
    await askLLM([{ role: 'user', content: 'обычный вопрос' }], { coarenaKey: 'k', openrouterKey: 'ok' })
    check('фото-провалы не включают «автомат»: Coarena опрошена и в текстовом вызове',
      coarenaCalls === 9)
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
  }
}
{
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  const b64 = 'Q'.repeat(180)
  let gemBody = null
  // Gemini native-путь: inlineData в последней user-реплике
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('generativelanguage')) {
      gemBody = JSON.parse(init.body)
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Кот на подоконнике' } ] } }],
      }), { status: 200 })
    }
    return new Response('unexpected', { status: 500 })
  }
  try {
    resetGeminiBreaker()
    const reply = await askLLM(
      [{ role: 'user', content: 'опиши' }],
      { geminiKey: 'gk-test', photo: { b64, mime: 'image/jpeg' } },
    )
    const parts = gemBody?.contents?.[0]?.parts
    check('gemini: inlineData с картинкой в последней реплике',
      reply === 'Кот на подоконнике' && parts?.length === 2
      && parts[1]?.inlineData?.data === b64 && parts[1]?.inlineData?.mimeType === 'image/jpeg')
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
  }
}

console.log('── Голосовые: transcribeAudio (gemini/coarena/openrouter) ──')
{
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  const b64 = 'T2dnUwAC' + 'A'.repeat(200)
  let gemBody = null
  // Gemini native: inlineData с audio/ogg
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('generativelanguage')) {
      gemBody = JSON.parse(init.body)
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Привет, Дария, какая завтра погода?' }] } }],
      }), { status: 200 })
    }
    return new Response('unexpected', { status: 500 })
  }
  try {
    const r = await transcribeAudio(b64, 'audio/ogg', { geminiKey: 'gk-test' })
    const parts = gemBody?.contents?.[0]?.parts
    check('gemini: аудио ушло inlineData (audio/ogg), текст получен',
      r.text === 'Привет, Дария, какая завтра погода?' && r.model === 'gemini-3.6-flash'
      && parts?.[1]?.inlineData?.mimeType === 'audio/ogg' && parts?.[1]?.inlineData?.data === b64)
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
  }
}
{
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  const b64 = 'T2dnUwAC' + 'B'.repeat(200)
  let caBody = null
  // Без ключа Gemini → Coarena: OpenAI input_audio с format:'ogg'
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('coarena.ai/api/v1/chat/completions')) {
      caBody = JSON.parse(init.body)
      return new Response(JSON.stringify({ choices: [{ message: { content: 'привет какая погода' } }] }), { status: 200 })
    }
    return new Response('unexpected', { status: 500 })
  }
  try {
    const r = await transcribeAudio(b64, 'audio/ogg', { coarenaKey: 'k' })
    const audio = caBody?.messages?.[0]?.content?.[1]?.input_audio
    check('coarena: input_audio (format ogg) с чистым base64',
      r.text === 'привет какая погода' && r.model === 'deepseek-v4-1-flash-1017'
      && audio?.format === 'ogg' && audio?.data === b64)
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
  }
}
{
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  // всё 429 → честный {error, tried, lastError}; без ключей — отказ сразу без fetch
  globalThis.fetch = async () => new Response('{"error":"quota"}', { status: 429 })
  try {
    const r = await transcribeAudio('A'.repeat(100), 'audio/ogg', { coarenaKey: 'k', openrouterKey: 'o', geminiKey: 'gk' })
    check('все мозги недоступны → error + tried + lastError без text',
      !r.text && typeof r.error === 'string' && Array.isArray(r.tried) && r.tried.length >= 4 && r.lastError.includes('429'))
    let called = 0
    globalThis.fetch = async () => { called += 1; return new Response('x', { status: 200 }) }
    const r2 = await transcribeAudio('A'.repeat(100), 'audio/ogg', {})
    check('без ключей → отказ сразу, ни одного fetch',
      !r2.text && r2.error === 'ни один мозг не расслышал' && called === 0)
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
  }
}

console.log('── Быстрое время на голое «Время» ──')
{
  const tz = 'Asia/Krasnoyarsk'
  check('«Время» → быстрый ответ', resolveCommand('Время', { tz }).handled === true)
  check('«Время» содержит цифры', /[0-9]{2}:[0-9]{2}/.test(resolveCommand('Время', { tz }).text))
  check('«время в Ачинске» НЕ быстрый (уйдёт в поиск)', resolveCommand('время в Ачинске', { tz }).handled === false)
}

console.log('── askLLM: Gemini главный, OpenRouter запасной ──')
{
  resetGeminiBreaker()
  const realFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    if (String(url).includes('generativelanguage')) {
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Ответ Гемини' }] } }] }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'Ответ OpenRouter' } }] }),
      { headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    const reply = await askLLM([{ role: 'user', content: 'привет' }], { openrouterKey: 'or', geminiKey: 'gk' })
    check('Gemini отвечает первым, пока жив', reply === 'Ответ Гемини')
    check('OpenRouter не вызывался, пока жив Gemini', calls.every((u) => u.includes('generativelanguage')))
    check('первая модель — gemini-3.6-flash', (calls[0] || '').includes('models/gemini-3.6-flash:'))
    check('ключ в query-параметре', (calls[0] || '').includes('key=gk'))
  } finally {
    globalThis.fetch = realFetch
    resetGeminiBreaker()
  }
}
{
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {} // тут ошибки ожидаемы — глушим шум в тестах
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    if (String(url).includes('generativelanguage')) {
      return new Response('{"error":{"code":404,"message":"model not found"}}', { status: 404 })
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'Ответ OpenRouter' } }] }),
      { headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    const reply = await askLLM([{ role: 'user', content: 'привет' }], { openrouterKey: 'or', geminiKey: 'gk' })
    const gModels = calls.filter((u) => u.includes('generativelanguage'))
      .map((u) => (u.match(/models\/([^:]+):/) || [])[1])
    check('Gemini лёг весь → ответ из OpenRouter', reply === 'Ответ OpenRouter')
    check('перебрали цепочку Gemini: основная + 3 алиаса',
      gModels.join(',') === 'gemini-3.6-flash,gemini-3.5-flash-lite,gemini-flash-latest,gemini-2.5-flash')
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
    resetGeminiBreaker()
  }
}
{
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage')) {
      // Gemini «вызывает» поиск сырым тегом — после зачистки пусто → запасной мозг
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '<dots_function_call>web_search</dots_function_call>' }] } }] }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'Спасли из OpenRouter' } }] }),
      { headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    const reply = await askLLM([{ role: 'user', content: 'привет' }], { openrouterKey: 'or', geminiKey: 'gk' })
    check('tool-call разметка в ответе Gemini → зачистка → OpenRouter', reply === 'Спасли из OpenRouter')
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
    resetGeminiBreaker()
  }
}
{
  // sk-gemini-… — ключ моста: без GEMINI_BASE_URL заведомо не работает в Google,
  // мозг должен сразу идти в OpenRouter, не тратя время на отказные запросы
  resetGeminiBreaker()
  const realFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'Сразу из OpenRouter' } }] }),
      { headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    const reply = await askLLM([{ role: 'user', content: 'привет' }], {
      openrouterKey: 'or',
      geminiKey: 'sk-gemini-abc123',
    })
    check('sk-ключ без моста → ответ из OpenRouter', reply === 'Сразу из OpenRouter')
    check('sk-ключ без моста → к Google не ходили вообще', calls.every((u) => !u.includes('generativelanguage')))
  } finally {
    globalThis.fetch = realFetch
    resetGeminiBreaker()
  }
}
{
  // Предохранитель: 2 подряд полных провала Gemini → 3 минуты сразу OpenRouter
  resetGeminiBreaker()
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  let geminiCalls = 0
  globalThis.fetch = async (url) => {
    if (String(url).includes('generativelanguage')) {
      geminiCalls++
      return new Response('{"error":{"code":500,"message":"bridge down"}}', { status: 500 })
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'Запаска' } }] }),
      { headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    await askLLM([{ role: 'user', content: 'раз' }], { openrouterKey: 'or', geminiKey: 'gk' })
    const afterFirst = geminiCalls
    await askLLM([{ role: 'user', content: 'два' }], { openrouterKey: 'or', geminiKey: 'gk' })
    const afterSecond = geminiCalls
    const third = await askLLM([{ role: 'user', content: 'три' }], { openrouterKey: 'or', geminiKey: 'gk' })
    check('первые два вызова пытались в Gemini (по 4 модели)', afterFirst > 0 && afterSecond > afterFirst)
    check('после двух полных провалов Gemini пропущен', geminiCalls === afterSecond)
    check('на пропуске ответ всё равно пришёл из OpenRouter', third === 'Запаска')
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
    resetGeminiBreaker()
  }
}
{
  const noKeys = await askLLM([{ role: 'user', content: 'привет' }], {})
  check('без ключей → null (в чат уйдёт NO_BRAIN)', noKeys === null)
}

console.log('── askLLM: Coarena — главный мозг (v0.3.16) ──')
{
  resetCoarenaBreaker()
  const realFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'Ответ Coarena' } }] }),
      { headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    const reply = await askLLM([{ role: 'user', content: 'привет' }], { coarenaKey: 'ck' })
    check('Coarena отвечает, пока жива', reply === 'Ответ Coarena')
    check('запрос ушёл в coarena.ai/api/v1/chat/completions', (calls[0]?.url || '').includes('coarena.ai/api/v1/chat/completions'))
    check('ключ в Authorization: Bearer', calls[0]?.init?.headers?.Authorization === 'Bearer ck')
    const body = JSON.parse(calls[0]?.init?.body || '{}')
    check('первая модель — deepseek-v4-1-flash-1017 (выбор владельца, free-набор)', body.model === 'deepseek-v4-1-flash-1017')
    check('system-промпт на месте', body.messages?.[0]?.role === 'system' && /Дария/.test(body.messages[0].content))
  } finally {
    globalThis.fetch = realFetch
    resetCoarenaBreaker()
  }
}
{
  // Coarena стоит впереди Gemini, когда заданы оба ключа
  resetCoarenaBreaker()
  const realFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'Ответ Coarena' } }] }),
      { headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    const reply = await askLLM([{ role: 'user', content: 'привет' }], { coarenaKey: 'ck', geminiKey: 'gk' })
    check('Coarena впереди Gemini', reply === 'Ответ Coarena' && calls.every((u) => u.includes('coarena')))
  } finally {
    globalThis.fetch = realFetch
    resetCoarenaBreaker()
  }
}
{
  // 402 (модель не в бесплатном наборе ключа) на всех моделях → запасной мозг
  resetCoarenaBreaker()
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  const models = []
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('coarena')) {
      models.push(String(JSON.parse(String(init.body)).model))
      return new Response('{"error":{"code":402,"message":"payment required"}}', { status: 402 })
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'Ответ OpenRouter' } }] }),
      { headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    const reply = await askLLM([{ role: 'user', content: 'привет' }], { coarenaKey: 'ck', openrouterKey: 'or' })
    check('Coarena 402 на всех моделях → ответ из OpenRouter', reply === 'Ответ OpenRouter')
    check('перебрали цепочку: deepseek → gemini-3-8-flash → gpt-6-luna',
      models.join(',') === 'deepseek-v4-1-flash-1017,gemini-3-8-flash,gpt-6-luna')
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
    resetCoarenaBreaker()
  }
}
{
  // 402 только на первой модели: вторая цепочки отвечает без фолбэка
  resetCoarenaBreaker()
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('coarena')) {
      const model = String(JSON.parse(String(init.body)).model)
      if (model === 'deepseek-v4-1-flash-1017') return new Response('{"error":{"code":402}}', { status: 402 })
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Ответ второй модели Coarena' } }] }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response('{}', { status: 500 })
  }
  try {
    const reply = await askLLM([{ role: 'user', content: 'привет' }], { coarenaKey: 'ck' })
    check('402 на первой модели → вторая отвечает', reply === 'Ответ второй модели Coarena')
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
    resetCoarenaBreaker()
  }
}
{
  // COARENA_MODEL перекрывает дефолтную модель
  resetCoarenaBreaker()
  const realFetch = globalThis.fetch
  let firstModel = ''
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('coarena')) {
      firstModel = firstModel || String(JSON.parse(String(init.body)).model)
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Ок' } }] }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response('{}', { status: 500 })
  }
  try {
    await askLLM([{ role: 'user', content: 'привет' }], { coarenaKey: 'ck', coarenaModel: 'gemini-4-argon' })
    check('COARENA_MODEL перекрывает дефолт', firstModel === 'gemini-4-argon')
  } finally {
    globalThis.fetch = realFetch
    resetCoarenaBreaker()
  }
}
{
  // Предохранитель Coarena: 2 подряд полных провала → 3 минуты сразу запасные
  resetCoarenaBreaker()
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  let coarenaCalls = 0
  globalThis.fetch = async (url) => {
    if (String(url).includes('coarena')) {
      coarenaCalls++
      return new Response('{"error":{"code":429,"message":"daily limit"}}', { status: 429 })
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'Запаска' } }] }),
      { headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    await askLLM([{ role: 'user', content: 'раз' }], { coarenaKey: 'ck', openrouterKey: 'or' })
    const afterFirst = coarenaCalls
    await askLLM([{ role: 'user', content: 'два' }], { coarenaKey: 'ck', openrouterKey: 'or' })
    const afterSecond = coarenaCalls
    const third = await askLLM([{ role: 'user', content: 'три' }], { coarenaKey: 'ck', openrouterKey: 'or' })
    check('первые два вызова пытались в Coarena (по 3 модели)', afterFirst > 0 && afterSecond > afterFirst)
    check('после двух полных провалов Coarena пропущена', coarenaCalls === afterSecond)
    check('на пропуске ответ пришёл из OpenRouter', third === 'Запаска')
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
    resetCoarenaBreaker()
  }
}

console.log('── Чтение страниц целиком: extractPageText / readPage / readPagesContext ──')
{
  // Чистка HTML: скрипты/стили/навигация долой, article приоритетнее, entity → символы
  const page = `<html><head><title>Тест &amp; страница</title><style>.a{color:red}</style></head><body>
    <nav>меню ссылки</nav><script>var evil = 1;</script>
    <article><h1>Заголовок</h1><p>Первый абзац про кота &mdash; длинный и осмысленный.</p>
    <p>Второй: цена 100&#160;руб.</p></article><footer>подвал</footer></body></html>`
  const text = extractPageText(page, 6000)
  check('скрипты/стили/нав/footer вырезаны, article сохранён',
    text.includes('Первый абзац') && text.includes('Заголовок')
      && !text.includes('evil') && !text.includes('.a{color') && !text.includes('меню') && !text.includes('подвал'))
  check('entities декодированы (&mdash;, &#160;)',
    text.includes('— длинный') && text.includes('100 руб'))
  check('обрезка по maxChars с многоточием',
    extractPageText(page, 30).length <= 31 && extractPageText(page, 30).endsWith('…'))

  // readPage: cp1251 из Content-Type
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  // «Привет, мир!» в windows-1251: П=CF р=F0 и=E8 в=E2 е=E5 т=F2 м=EC р=F0
  const cp1251 = new Uint8Array([0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2, 0x2C, 0x20, 0xEC, 0xE8, 0xF0, 0x21])
  const filler = ' Эта статья содержит достаточно осмысленного текста, чтобы пройти минимальный порог длины восемьдесят символов.'
  const enc = new TextEncoder()
  const head = enc.encode('<html><head><title>Old School</title></head><body><p>')
  const tail = enc.encode(filler + '</p></body></html>')
  const bodyBytes = new Uint8Array(head.length + cp1251.length + tail.length)
  bodyBytes.set(head, 0)
  bodyBytes.set(cp1251, head.length)
  bodyBytes.set(tail, head.length + cp1251.length)
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u === 'https://old.example/ru') {
      return new Response(bodyBytes, { status: 200, headers: { 'content-type': 'text/html; charset=windows-1251' } })
    }
    if (u === 'https://old.example/meta') {
      // charset НЕ в Content-Type — должен вытащиться из <meta> (текст латиницей — совпадает с cp1251)
      const metaHtml = '<html><head><meta charset="windows-1251"></head><body><p>Only ascii text here and here to pass the eighty character meaningful threshold for sure ok.</p></body></html>'
      return new Response(enc.encode(metaHtml), { status: 200, headers: { 'content-type': 'text/html' } })
    }
    if (u === 'https://old.example/pdf') return new Response('x', { status: 200, headers: { 'content-type': 'application/pdf' } })
    if (u === 'https://old.example/500') return new Response('err', { status: 500 })
    return new Response('nope', { status: 404 })
  }
  try {
    const p1 = await readPage('https://old.example/ru', { maxChars: 6000 })
    check('cp1251 из Content-Type декодирован', !p1.error && p1.title === 'Old School' && p1.text.includes('Привет, мир!'))
    const p2 = await readPage('https://old.example/meta', { maxChars: 6000 })
    check('charset вытащен из <meta>, когда его нет в Content-Type', !p2.error && p2.text.length > 80)
    const p3 = await readPage('https://old.example/pdf')
    check('не-HTML (pdf) → честный отказ', p3.error.includes('не HTML'))
    const p4 = await readPage('https://old.example/500')
    check('HTTP 500 → error', p4.error === 'HTTP 500')

    // readPagesContext: две страницы → блок с заголовками; все мёртвые → ''
    const results = [
      { title: 'А', url: 'https://old.example/ru', snippet: '' },
      { title: 'Б', url: 'https://old.example/meta', snippet: '' },
    ]
    const block = await readPagesContext(results, { limit: 2 })
    check('блок из двух страниц: маркер + оба заголовка',
      block.includes('[Содержимое страниц') && block.includes('Old School') && block.includes('── Страница 1') && block.includes('── Страница 2'))
    const empty = await readPagesContext([
      { title: 'X', url: 'https://old.example/500' },
      { title: 'Y', url: 'https://old.example/pdf' },
    ])
    check('ни одна не читается → пустой блок', empty === '')
    const skipped = await readPagesContext([{ title: 'W', url: 'file:///etc/passwd' }])
    check('не-http URL отфильтрован', skipped === '')
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
  }
}

console.log('── Свежий контекст группы (groupChatter в system) ──')
{
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  const captured = []
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), body: JSON.parse(init.body) })
    return Response.json({ choices: [{ message: { content: 'Ок' } }] })
  }
  try {
    await askLLM([{ role: 'user', content: 'Дария, что думаете про кинотеатр?' }], {
      coarenaKey: 'ck',
      groupChatter: '[Свежий контекст группы — реплики участников за последние минуты, говорили между собой, не с тобой; используй как фон, если он помогает ответу]\nВася: идём в кино вечером\nПетя: а я занят',
    })
    const sys = captured[0]?.body?.messages?.[0]?.content || ''
    check('chatter попал в system-промпт', sys.includes('[Свежий контекст группы') && sys.includes('Вася: идём в кино вечером'))
    check('история НЕ засорена болтовней (только в system)',
      captured[0].body.messages.slice(1).every((m) => !(m.content || '').includes('Вася:')))
    captured.length = 0
    await askLLM([{ role: 'user', content: 'привет' }], { coarenaKey: 'ck' })
    check('без chatter маркера в system нет', !(captured[0]?.body?.messages?.[0]?.content || '').includes('[Свежий контекст группы]'))
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
    resetCoarenaBreaker()
  }
}

console.log('── Голосовые: Workers AI whisper (биндинг env.AI) ──')
{
  const realFetch = globalThis.fetch
  const realErr = console.error
  console.error = () => {}
  try {
    // whisper доступен → нулевой мозг, цепочка дальше не идёт, b64 уходит как {audio}
    const runs = []
    const aiOk = { run: async (model, input) => { runs.push({ model, input }); return { text: '  Привет Дария  ', word_count: 2 } } }
    const r1 = await transcribeAudio('T2dnUwAC', 'audio/ogg', { aiBinding: aiOk, geminiKey: 'gk' })
    check('whisper-turbo: b64 ушло как есть + language ru, текст возвращён, цепочка остановилась',
      r1.text === 'Привет Дария' && String(r1.model).includes('whisper-large-v3-turbo')
      && runs.length === 1 && runs[0].model === '@cf/openai/whisper-large-v3-turbo'
      && runs[0].input.audio === 'T2dnUwAC' && runs[0].input.language === 'ru')
    // без биндинга шаг пропущен — tried без workers-ai, поведение прежнее
    globalThis.fetch = async () => new Response('{"error":"quota"}', { status: 429 })
    const r2 = await transcribeAudio('A'.repeat(100), 'audio/ogg', { coarenaKey: 'k', geminiKey: 'gk' })
    check('без биндинга шаг пропущен (tried без workers-ai)',
      !r2.text && Array.isArray(r2.tried) && !r2.tried.some((t) => String(t).includes('workers-ai')))
    // whisper упал → цепочка продолжается, coarena отвечает
    globalThis.fetch = async (url) => {
      if (String(url).includes('chat/completions')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Запаска услышала' } }] }), { status: 200 })
      }
      return new Response('{"error":"no"}', { status: 500 })
    }
    const r3 = await transcribeAudio('A'.repeat(100), 'audio/ogg', { aiBinding: { run: async () => { throw new Error('биндинг сдох') } }, coarenaKey: 'k' })
    // в успешном ответе tried нет (он приходит только при полном провале) — важен сам текст
    check('whisper упал → цепочка пошла дальше (coarena ответила)', r3.text === 'Запаска услышала')
    // whisper заядренен навсегда → таймер гонки спасает ответ (коарена подхватывает)
    const r4 = await transcribeAudio('A'.repeat(100), 'audio/ogg', { aiBinding: { run: () => new Promise(() => {}) }, coarenaKey: 'k', aiTimeoutMs: 50 })
    check('whisper висит → таймаут гонки → цепочка дальше', r4.text === 'Запаска услышала')
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
    resetCoarenaBreaker()
  }
}

console.log('── Голосовые ответы: speakText (TTS aura-1 через биндинг) ──')
{
  const realErr = console.error
  console.error = () => {}
  try {
    const bytes = new Uint8Array([79, 103, 103, 83, 0, 2, 1, 2, 3])
    const runs = []
    const aiStream = new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } })
    const aiOk = { run: async (model, input) => { runs.push({ model, input }); return aiStream } }
    const r1 = await speakText('Привет! Я Дария, отвечаю голосом.', { aiBinding: aiOk })
    check('aura-1: {text, speaker, opus+ogg} ушло, поток собран в audioB64',
      !r1.error && r1.mime === 'audio/ogg'
      && runs.length === 1 && runs[0].model === '@cf/deepgram/aura-1'
      && runs[0].input.encoding === 'opus' && runs[0].input.container === 'ogg'
      && runs[0].input.speaker === 'luna' && runs[0].input.text.includes('Дария'))
    const back = Uint8Array.from(atob(r1.audioB64), (c) => c.charCodeAt(0))
    check('audioB64 декодируется в те же байты', back.length === bytes.length && back.every((b, i) => b === bytes[i]))
    // буфер вместо потока тоже работает, speaker переопределяется
    const r2 = await speakText('Тест', { aiBinding: { run: async () => bytes }, ttsSpeaker: 'zeus' })
    check('Uint8Array от биндинга принимается, speaker переопределяется', !r2.error && !!r2.audioB64 && runs.length === 1)
    check('пустой текст → ошибка', (await speakText('   ', { aiBinding: aiOk })).error === 'пустой текст')
    check('без биндинга → ошибка', (await speakText('привет', {})).error === 'нет биндинга AI')
    // заядрененный TTS → таймаут гонки, честная ошибка
    const r3 = await speakText('долго', { aiBinding: { run: () => new Promise(() => {}) }, ttsTimeoutMs: 50 })
    check('TTS висит → таймаут гонки', !!r3.error && r3.error.includes('таймаут'))
  } finally {
    console.error = realErr
    resetCoarenaBreaker()
  }
}

console.log('── speakTextWeb: русский голос через веб-версию ──')
{
  const realErr = console.error
  const realFetch = globalThis.fetch
  console.error = () => {}
  try {
    const bytes = new Uint8Array([73, 68, 51, 3, 0, 1, 2, 3])
    const calls = []
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
      return { ok: true, arrayBuffer: async () => bytes.buffer }
    }
    const w1 = await speakTextWeb('Привет! Я Дария, и это голос из веба. Ты слышишь меня?', { webAppUrl: 'https://web.example/' })
    check('веб-TTS: POST {text, voice:svetlana} на /api/tts → audioB64/mpeg/said',
      !w1.error && w1.mime === 'audio/mpeg' && !!w1.audioB64
      && calls.length === 1 && calls[0].url === 'https://web.example/api/tts'
      && calls[0].body.voice === 'svetlana' && calls[0].body.text.includes('Дария')
      && typeof w1.said === 'string' && w1.said.includes('Дария'))
    const back = Uint8Array.from(atob(w1.audioB64), (c) => c.charCodeAt(0))
    check('audioB64 веб-ТТС декодируется в те же байты', back.length === bytes.length && back.every((b, i) => b === bytes[i]))
    // HTTP 500 → честная ошибка, бот уйдёт в текст
    globalThis.fetch = async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) })
    check('веб-TTS: HTTP 500 → ошибка', (await speakTextWeb('привет', { webAppUrl: 'https://web.example/' })).error === 'веб-TTS: HTTP 500')
    // висящий веб → таймаут гонки
    globalThis.fetch = async () => new Promise(() => {})
    const w2 = await speakTextWeb('долго', { webAppUrl: 'https://web.example/', ttsTimeoutMs: 50 })
    check('веб-TTS висит → таймаут гонки', !!w2.error && w2.error.includes('таймаут'))
    check('веб-TTS: пустой текст → ошибка', (await speakTextWeb('  ', { webAppUrl: 'https://web.example/' })).error === 'пустой текст')
    check('веб-TTS: нет адреса веба → ошибка', (await speakTextWeb('привет', {})).error.includes('WEB_APP_URL'))
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
    resetCoarenaBreaker()
  }
}

console.log('── generateImage: художники без ключей ──')
{
  const realErr = console.error
  const realFetch = globalThis.fetch
  console.error = () => {}
  try {
    const png = new Uint8Array(2200)
    png.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
    // Gemini «протух» (400 API key not valid) → pollinations рисует
    globalThis.fetch = async (url) => {
      const u = String(url)
      if (u.includes('pollinations')) {
        return { ok: true, status: 200, arrayBuffer: async () => png.buffer, headers: { get: (h) => (h === 'content-type' ? 'image/jpeg' : null) } }
      }
      return { ok: false, status: 400, text: async () => '{"error":{"message":"API key not valid"}}', arrayBuffer: async () => new ArrayBuffer(0) }
    }
    const r1 = await generateImage('кот в берете', { geminiKey: 'протухший' })
    check('Gemini 400 → pollinations рисует (jpeg 1024px)', !!r1.image && r1.image.model === 'pollinations-flux' && r1.image.mime === 'image/jpeg' && String(r1.image.b64).length > 100)
    // pollinations тоже умер → flux из биндинга спасает
    globalThis.fetch = async (url) => (String(url).includes('pollinations')
      ? { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null }, text: async () => '' }
      : { ok: false, status: 400, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) })
    const aiFlux = { run: async () => ({ image: 'Zmx1eA' + 'A'.repeat(2200) }) }
    const r2 = await generateImage('кот', { geminiKey: 'x', aiBinding: aiFlux })
    check('pollinations 500 → flux-1-schnell спасает', !!r2.image && r2.image.model === 'flux-1-schnell' && r2.image.mime === 'image/png')
    // webp от pollinations — пропускаем обе модели и берём flux
    let webpCalls = 0
    globalThis.fetch = async (url) => {
      if (String(url).includes('pollinations')) {
        webpCalls++
        return { ok: true, status: 200, arrayBuffer: async () => png.buffer, headers: { get: (h) => (h === 'content-type' ? 'image/webp' : null) } }
      }
      return { ok: false, status: 400, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
    }
    const r3 = await generateImage('кот', { geminiKey: 'x', aiBinding: aiFlux })
    check('pollinations вернул webp → пропустили и взяли flux', !!r3.image && r3.image.model === 'flux-1-schnell' && webpCalls === 2)
    // ничего не работает → честная ошибка со списком попыток
    const r4 = await generateImage('кот', { geminiKey: 'x' })
    // tried-элементы дополнены суффиксами («HTTP 400», «mime ... — мимо») — сравниваем как подстроку
    check('все художники молчат → честная ошибка', !!r4.error && r4.error.includes('все художники') && r4.tried.some((t) => t.includes('pollinations/turbo')) && r4.tried.some((t) => t.includes('flux-1-schnell')))
    check('flux без биндинга → честная ошибка', (await workersAiImage('кот', {})).error === 'нет биндинга AI')
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
    resetCoarenaBreaker()
  }
}

console.log('── translateImagePrompt: промпт на английский перед рисованием ──')
{
  // ru → en: первая строка, кавычки-обёртки сняты
  const aiOk = { run: async () => ({ response: '"A ginger cat in glasses"\nВот перевод.' }) }
  const r1 = await translateImagePrompt('рыжий кот в очках', { aiBinding: aiOk })
  check('ru → en: первая строка, кавычки сняты', r1.translated === true && r1.en === 'A ginger cat in glasses')
  // уже английский → passthrough, биндинг не зовём
  const aiShout = { run: async () => { throw new Error('не должен зваться') } }
  const r2 = await translateImagePrompt('a red cat, digital painting', { aiBinding: aiShout })
  check('уже английский → как есть, без перевода', r2.translated === false && r2.en === 'a red cat, digital painting')
  // модель ответила по-русски → фолбэк на исходный промпт
  const aiRu = { run: async () => ({ response: 'рыжий кот в очках' }) }
  const r3 = await translateImagePrompt('рыжий кот в очках', { aiBinding: aiRu })
  check('модель не перевела → исходный промпт + причина', r3.translated === false && r3.en.includes('рыжий кот') && String(r3.translateError).includes('не перевела'))
  // биндинг заболел → фолбэк на исходный
  const aiDead = { run: async () => { throw new Error('binding sick') } }
  const r4 = await translateImagePrompt('кот', { aiBinding: aiDead })
  check('биндинг заболел → рисуем исходный промпт', r4.translated === false && r4.en === 'кот' && r4.translateError.includes('binding sick'))
  // сквозной: перевод реально кормит художников (flux получает en-промпт)
  const realErr = console.error
  const realFetch = globalThis.fetch
  console.error = () => {}
  try {
    let fluxPrompt = ''
    const aiBoth = { run: async (model, args) => {
      if (args?.messages) return { response: 'A cat in a beret' }
      fluxPrompt = args?.prompt || ''
      return { image: 'Zmx1eA' + 'A'.repeat(2200) }
    } }
    globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) })
    const r5 = await generateImage('кот в берете', { geminiKey: 'x', aiBinding: aiBoth })
    check('generateImage: перевод → flux получил en-промпт', !!r5.image && r5.image.model === 'flux-1-schnell' && r5.translated === true && r5.en === 'A cat in a beret' && fluxPrompt === 'A cat in a beret')
  } finally {
    globalThis.fetch = realFetch
    console.error = realErr
    resetCoarenaBreaker()
  }
}

console.log('── Новости v0.3.40: описания в сниппете, Bing topic, Википедия мимо ──')
{
  // parseNewsRss: description → сниппет (Lenta/РИА/ТАСС/Bing), у google-news — нет
  const lentaXml = '<rss><channel><item><title>Открыли новый мост</title><link>https://lenta.ru/x</link>' +
    '<pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate><description>В Петербурге открыли трёхкилометровый мост через Неву: движение запустили раньше срока.</description></item></channel></rss>'
  const li = parseNewsRss(lentaXml, 6, 'lenta')
  check('parseNewsRss: description попал в сниппет', li.length === 1 && li[0].snippet.includes('трёхкилометровый мост'))
  const gn = parseNewsRss('<rss><channel><item><title>A - Source</title><link>https://x.y/a</link>' +
    '<pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate><description>&lt;a href="https://y.z"&gt;A&lt;/a&gt; Source</description></item></channel></rss>', 6, 'google-news')
  check('parseNewsRss: google-news без description в сниппете', gn.length === 1 && !gn[0].snippet.includes('Source — '))
  // newsSearch: тема → гонка google topic (в CF виснет) ↔ bing topic → bing спасает
  const realFetch = globalThis.fetch
  const urls = []
  try {
    globalThis.fetch = async (url) => {
      urls.push(String(url))
      if (String(url).includes('news.google.com/rss/search')) throw new Error('CF hang')
      if (String(url).includes('bing.com/news')) {
        return new Response('<rss><channel><item><title>Бавария потеряла очки</title><link>https://bing.n/1</link><pubDate>Fri, 20 Nov 2026 23:11:00 GMT</pubDate><description>Кельн увозит ничью из Мюнхена.</description></item></channel></rss>')
      }
      throw new Error('не то')
    }
    const themed = await newsSearch('новости футбола')
    check('newsSearch: google topic завис → bing спас с описанием',
      themed.length === 1 && themed[0].engine === 'bing-news' && themed[0].snippet.includes('Кельн увозит ничью'))
    // webSearch fallback для новостей: всё молчит → Википедия НЕ зовётся → []
    globalThis.fetch = async (url) => {
      const u = String(url)
      if (u.includes('wikipedia.org')) {
        return new Response(JSON.stringify({ query: { search: [{ title: 'Мамаев', snippet: 'футболист' }] } }))
      }
      return Promise.reject(new Error('down'))
    }
    const viaWeb = await webSearch('новости регби ' + Date.now())
    check('webSearch: новостной fallback без Википедии (все молчат → [])', viaWeb.length === 0)
    const ref = await webSearch('кто такой Маск ' + Date.now())
    check('webSearch: не-новостному запросу Википедия доступна', ref.length >= 1 && ref[0].engine === 'wikipedia')
    // «новости сегодня» — теперь общий запрос → гонка главных лент, не topic-поиск
    // (без Date.now()-суффикса: цифры на хвосте ломают $-анкор GENERIC_NEWS_RE)
    const urls2 = []
    globalThis.fetch = async (url) => {
      urls2.push(String(url))
      return Promise.reject(new Error('down'))
    }
    const gen = await webSearch('новости сегодня')
    check('GENERIC_NEWS_RE: «новости сегодня» → гонка главных лент',
      urls2.some((u) => u.includes('lenta.ru/rss/news')) && !urls2.some((u) => u.includes('bing.com/news/search')) && gen.length === 0)
  } finally {
    globalThis.fetch = realFetch
    resetCoarenaBreaker()
  }
}

console.log('── Погода v0.3.41: регион «Крым» мимо геокодера ──')
{
  check('cityCandidates: «Крыму» даёт именительную «Крым»', cityCandidates('Крыму').includes('Крым'))
  const realFetch = globalThis.fetch
  try {
    globalThis.fetch = async (url) => {
      const u = String(url)
      if (/api\.open-meteo\.com\/v1\/forecast/.test(u)) {
        return new Response(JSON.stringify({
          current: { temperature_2m: 12, apparent_temperature: 10, relative_humidity_2m: 60, wind_speed_10m: 4, weather_code: 1 },
          daily: { time: ['2026-11-21', '2026-11-22'], temperature_2m_max: [13, 14], temperature_2m_min: [7, 8] },
        }))
      }
      throw new Error('геокодер не должен зваться для региона: ' + u)
    }
    const w = await weatherLookup('погода в Крыму')
    check('погода: «в Крыму» → регион Крым, не Крымск и не вики',
      w.engine === 'open-meteo' && w.title.includes('Погода: Крым') && !w.title.includes('Крымск'))
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log('── /start v0.3.42: хелп для НейроСекты ──')
{
  const h = resolveCommand('/start')
  check('/start: срабатывает и возвращает текст', h?.handled === true && typeof h.text === 'string')
  check('/start: секта и все реальные умения в хелпе',
    h.text.includes('НейроСект') && h.text.includes('нарисуй') && h.text.includes('погугли')
    && h.text.includes('голосом') && h.text.includes('фото') && h.text.includes('радио'))
  check('/start: ответ на её сообщение — тоже триггер упомянут',
    h.text.includes('ответь на моё сообщение'))
}

console.log(`\nИтого: ${passed} прошло, ${failed} упало`)
process.exit(failed ? 1 : 0)
