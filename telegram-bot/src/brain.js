/**
 * Мозг Дарии для Telegram-бота.
 *
 * Перенос логики из веб-версии (src/app/page.tsx, v2.5):
 *  - триггер-имя (Дария/Даша/Дуся/Алиса + падежи и опечатки, нечёткое сравнение);
 *  - медиа-команды («включи радио/музыку/ютуб», «выключи») → в телеге отдают
 *    ссылками: фоновый плеер есть только в веб-версии;
 *  - быстрые ответы (привет, как дела, кто ты, время, дата, помощь) работают
 *    БЕЗ ИИ-ключей — в характере Дарии;
 *  - веб-поиск (DuckDuckGo) для свежих данных: погода, новости, курсы —
 *    результаты подмешиваются в контекст LLM;
 *  - всё остальное → LLM (Gemini — главный мозг, OpenRouter — запасной);
 *    без ключей — вежливая заглушка.
 *
 * Файл намеренно на чистом JS без импортов: тестируется в node (test-brain.mjs)
 * и бандлится wrangler'ом без настройки.
 */

// ── Триггер-имена (как в веб-версии v2.4) ────────────────────────────────
const TRIGGER_VARIANTS = [
  'дария', 'дарью', 'дарье', 'дарии', 'дарьи', 'дарья', 'дэрия', 'дарина', 'далее',
  'даша', 'дашу', 'даши', 'дашей', 'дашенька', 'дэша',
  'дуся', 'дусю', 'дуси',
  'алиса', 'алису', 'алисы',
]

/** Словесный мусор перед командой: «эй,», «окей ,», «слушай,», «ну » */
const FILLER_RE = /^(эй|окей|ок|слушай|ну|в общем)\s*[,!]?\s*/i

// ── Нечёткое сравнение (порт из веб-версии) ──────────────────────────────
export function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[b.length]
}

/** «далее» → «дария»: первая буква совпадает, расстояние ≤1 (короткие) / ≤2 (длинные) */
export function isTriggerToken(token, variants = TRIGGER_VARIANTS) {
  const t = token.toLowerCase()
  for (const v of variants) {
    if (t === v) return true
    if (t[0] !== v[0]) continue
    const maxDist = v.length <= 5 ? 1 : 2
    if (levenshtein(t, v) <= maxDist) return true
  }
  return false
}

// ── Поиск обращения к Дарии ──────────────────────────────────────────────
const WORD_RE = /[a-zа-яё]+/gi

/**
 * Возвращает { found, command }:
 *  - found — в тексте есть обращение к Дарии;
 *  - command — текст без имени обращения (команда).
 * Для @упоминания: caller сначала вырезает «@username».
 */
export function extractCommand(text) {
  const lower = text.toLowerCase()
  const words = lower.match(WORD_RE) || []
  let matchedWord = null
  for (const w of words) {
    if (isTriggerToken(w)) {
      matchedWord = w
      break
    }
  }
  if (!matchedWord) return { found: false, command: '' }
  // Вырезаем найденное слово из исходного текста (не ломаем регистр остального)
  const re = new RegExp(
    `(?<![a-zа-яё])${matchedWord}(?![a-zа-яё])`,
    'i',
  )
  let command = text.replace(re, ' ')
  command = command.replace(FILLER_RE, '')
  command = command.replace(/^[\s,.!?;:—-]+/, '').replace(/[\s,.!?;:—-]+$/, '')
  return { found: true, command: command.trim() }
}

// ── Ответы в характере (без ИИ) ──────────────────────────────────────────
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

const GREETINGS = [
  'Привет-привет 😏 Скучал?',
  'О, смотрите кто пришёл 😄 Привет!',
  'Привет! Я тут, скучаю и жду развлечений 😏',
]
const HOW_ARE_YOU = [
  'Отлично — характер мой лучше не бывает 😄 А у тебя как дела?',
  'Живу, людей подшучиваю над собой не даю 😏 А у тебя как?',
  'Всё прекрасно, пока есть с кем поболтать. Ну, рассказывай — как ты?',
]
const WHO_AM_I = [
  'Я Дария — та самая, что болтает с тобой голосом в веб-версии. Теперь живу и в телеге 😄',
  'Дария я. Дерзкая, обаятельная и немного наглая — тебя предупреждали? 😏',
]
const THANKS = [
  'Да лан 😌 Обращайся.',
  'Приятно, когда ценят 😏',
  'В такой момент мне даже хочется быть скромной. Проходит 😄',
]
const HELP_TEXT = [
  'Что я умею в телеге 😄',
  '• болтать — напиши «Дария, …» и любой вопрос;',
  '• «Дария, погугли …» — схожу в интернет за свежим: погода, новости, курсы;',
  '• «Дария, включи радио/музыку» — дам ссылку на мою веб-версию с плеером;',
  '• скинешь ссылку ютуб — отреагирую;',
  '• время, дата, шутки и подколы — без очереди.',
].join('\n')

export const WEB_APP_LINE = 'А плеер с радио и музыкой — в моей веб-версии:'

const MEDIA_STOP = [
  'Хитрость: в телеге у меня фонового плеера нет — выключать нечего 😄 Музыка живёт в веб-версии.',
  'Тут я музыку не включаю, так что и выключать нечего 😏 Зато в веб-версии командуй как хочешь.',
]
const MEDIA_MUSIC = [
  'Из телеги погромче не получится 😅 Музыка и радио у меня в веб-версии:',
  'Плеер у меня остался в веб-версии — там и включу. Держи:',
]
const MEDIA_RADIO = [
  'Радио у меня крутится в веб-версии — там живой эфир и десятки станций:',
  'Радио — моя веб-территория 😄 Ссылка:',
]
const MEDIA_YOUTUBE = [
  'Ютуб сам я тут не открою 😅 Скинь ссылку на видео — отреагирую. А встроенный плеер у меня в веб-версии:',
  'Без ссылки не играю 😄 Кинь ютуб-линк, или заходи в веб-версию:',
]
export const NO_BRAIN = [
  'Мозг сегодня молчит — провайдер не ответил 😅 Чаще всего это лимиты бесплатных моделей OpenRouter. Хозяину: повтори через минуту.',
  'Хотела ответить умно, но мозг промолчал 😄 Хозяину намёк: у бесплатных моделей OpenRouter лимиты — попробуй позже или добавь GEMINI_API_KEY (станет главным мозгом).',
]

export function formatTime(tz = 'Europe/Moscow') {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit', minute: '2-digit', timeZone: tz,
  }).format(new Date())
}

export function formatDate(tz = 'Europe/Moscow') {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: tz,
  }).format(new Date())
}

// ── Веб-поиск (свежие данные для LLM) ────────────────────────────────────

/** Явные команды поиска */
const SEARCH_VERBS_RE = /(погугли|загугли|поищи|поищ|поиск\s+в\s+интернете|найди\s+(в\s+интернете|в\s+сети)|посмотри\s+в\s+(интернете|сети|гугле|яндексе)|глянь\s+в\s+(интернете|сети|гугле|яндексе))/i

/** Запросы времени в городе, оба порядка слов: «сколько времени в Ачинске» и «в Ачинске сколько время» */
const TIME_QUERY_RE = /(?:времени|время)(?:\s+[а-яё]+){0,3}\s+(?:в|во|на)\s+[а-яё]|(?:в|во|на)\s+[а-яё]+(?:\s+[а-яё]+){0,3}[\s,]*(?:времени|время)/i

/** Темы, где без свежих данных нечего делать */
const SEARCH_HINTS_RE = /погода|новост|курс [а-яё]|курс\b.*(доллар|евро|рубл|биткоин|юан)|доллар.*(подорожал|подешевел|курс)|биткоин|эфириум|крипт|кто победил|сч[её]т матча|счет матча|итог(ы)? матча|сколько (стоит|стоят)|стоимость|цена|цены на|дата выхода|когда выйдет|когда вышл[ао]|последн(ие|яя) (новост|серия|сезон|версия|релиз|обновлени)|свеж(ие|ая) новост|тренд|расписание|премьер[аы]|кто такой|кто такая|праздник|выходн|отмеча|какой сегодня|какое сегодня|какой сейчас|какое сейчас|какой (день|год|число)|что (сегодня|сейчас) (в россии|в мире|происходит)|(?:сколько\s+)?времени\s+в\s+[а-яё]|время\s+в\s+[а-яё]/i

/** Нужен ли веб-поиск для этой фразы */
export function needsWebSearch(text) {
  const t = (text || '').toLowerCase()
  if (!t) return false
  return SEARCH_VERBS_RE.test(t) || SEARCH_HINTS_RE.test(t) || TIME_QUERY_RE.test(t)
}

/** Из команды убираем поисковые глаголы — остальное уходит в DuckDuckGo */
export function buildSearchQuery(command) {
  let q = (command || '')
    .replace(/^(погугли|загугли|поищи|поищ|найди|посмотри|глянь)\s*(в\s*интернете|в\s*сети|в\s*гугле|в\s*яндексе)?\s*[,!.?]*\s*/i, '')
    .replace(/^(в\s+интернете|в\s+сети|в\s+гугле|в\s+яндексе)\s*/i, '')
    .trim()
  return q || (command || '').trim()
}

function stripTags(s) {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Вытаскиваем настоящую ссылку из редиректа DuckDuckGo (/l/?uddg=…) */
function decodeDdgHref(href) {
  const m = (href || '').match(/[?&]uddg=([^&]+)/)
  if (m) {
    try { return decodeURIComponent(m[1]) } catch { return '' }
  }
  let h = href || ''
  if (h.startsWith('//')) h = 'https:' + h
  return h
}

/** Якоря с заданным классом (атрибуты в любом порядке, кавычки любые) */
function parseAnchors(html, className) {
  const out = []
  const re = /<a\s+([^>]*?)>([\s\S]*?)<\/a>/g
  let m
  while ((m = re.exec(html))) {
    const attrs = m[1]
    if (!new RegExp(`class=['"][^'"]*\\b${className}\\b`).test(attrs)) continue
    const href = attrs.match(/href=['"]([^'"]+)['"]/)?.[1] || ''
    out.push({ href, text: m[2] })
  }
  return out
}

/** Парсер выдачи html.duckduckgo.com/html */
export function parseDdgHtml(html, max = 5) {
  const titles = parseAnchors(html, 'result__a')
  const snippets = parseAnchors(html, 'result__snippet')
  const out = []
  for (let i = 0; i < titles.length && out.length < max; i++) {
    const url = decodeDdgHref(titles[i].href)
    const title = stripTags(titles[i].text)
    const snippet = stripTags(snippets[i]?.text || '')
    if (!title || !/^https?:\/\//.test(url)) continue
    if (/duckduckgo\.com\/y\.js|duck\.co/.test(url)) continue // реклама
    out.push({ title, url, snippet })
  }
  return out
}

/** Парсер выдачи lite.duckduckgo.com (запасной) */
export function parseDdgLiteHtml(html, max = 5) {
  const links = parseAnchors(html, 'result-link')
  const snippets = [...html.matchAll(/<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)]
  const out = []
  for (let i = 0; i < links.length && out.length < max; i++) {
    const url = decodeDdgHref(links[i].href)
    const title = stripTags(links[i].text)
    const snippet = stripTags(snippets[i]?.[1] || '')
    if (!title || !/^https?:\/\//.test(url)) continue
    out.push({ title, url, snippet })
  }
  return out
}

/** Парсер выдачи Bing (блоки li.b_algo) */
export function parseBingHtml(html, max = 5) {
  const blocks = [...html.matchAll(/<li[^>]*class=["'][^"']*b_algo[^"']*["'][^>]*>([\s\S]*?)<\/li>/g)]
  const out = []
  for (const block of blocks) {
    if (out.length >= max) break
    const body = block[1]
    const a = body.match(/<a[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
    if (!a) continue
    let title = stripTags(a[2])
    title = title.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim() // бинг вклеивает адрес в текст ссылки
    if (!title) continue
    const url = decodeBingHref(a[1])
    if (/^https?:\/\/([a-z0-9-]+\.)*(bing\.com|microsoft\.com)\//i.test(url)) continue // редиректы и ссылки бинга на себя — мусор
    const p = body.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    out.push({ title, url, snippet: stripTags(p?.[1] || '') })
  }
  return out
}

/** Парсер выдачи Google (базовая HTML-версия, ссылки вида /url?q=…) */
export function parseGoogleHtml(html, max = 5) {
  const anchors = [...html.matchAll(/<a[^>]*href="\/url\?q=(https?:\/\/[^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)]
  const out = []
  for (const a of anchors) {
    if (out.length >= max) break
    const title = stripTags(a[2])
    const url = a[1]
    if (!title || !/^https?:\/\//.test(url)) continue
    if (/google\.[a-z.]+\/|accounts\.google|youtube\.com\/results|gstatic/.test(url)) continue
    out.push({ title, url, snippet: '' })
  }
  return out
}

const SEARCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/** Движки поиска (запускаются параллельно, побеждает первый успешный) */
const SEARCH_ENGINES = [
  ['ddg-html', (q) => ({ url: 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), parse: parseDdgHtml })],
  ['ddg-lite', (q) => ({ url: 'https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(q), parse: parseDdgLiteHtml })],
  ['bing', (q) => ({ url: 'https://www.bing.com/search?q=' + encodeURIComponent(q) + '&setlang=ru&count=8', parse: parseBingHtml })],
  ['google', (q) => ({ url: 'https://www.google.com/search?q=' + encodeURIComponent(q) + '&num=8&hl=ru', parse: parseGoogleHtml })],
  ['mojeek', (q) => ({ url: 'https://www.mojeek.com/search?q=' + encodeURIComponent(q), parse: parseMojeekHtml })],
]

/** Парсер выдачи Mojeek (заголовки в h2) */
export function parseMojeekHtml(html, max = 5) {
  const anchors = [...html.matchAll(/<h2[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  const out = []
  for (const a of anchors) {
    if (out.length >= max) break
    const title = stripTags(a[2])
    if (!title || /mojeek\.com/.test(a[1])) continue
    out.push({ title, url: a[1], snippet: '' })
  }
  return out
}

/** Википедия — самый лояльный к ботам источник (для энциклопедических вопросов) */
async function wikipediaSearch(q, max) {
  const url =
    'https://ru.wikipedia.org/w/api.php?action=query&list=search&srlimit=' + Math.min(max, 3) +
    '&format=json&srsearch=' + encodeURIComponent(q)
  const res = await fetch(url, {
    headers: { 'User-Agent': 'DariaBot/0.3 (personal assistant bot)' },
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error('wikipedia ' + res.status)
  const data = await res.json()
  const hits = data?.query?.search || []
  const results = hits.map((h) => ({
    title: `Википедия: ${h.title}`,
    url: 'https://ru.wikipedia.org/wiki/' + encodeURIComponent(h.title.replace(/ /g, '_')),
    snippet: stripTags(h.snippet || ''),
  }))
  if (!results.length) throw new Error('wikipedia пусто')
  return results
}

/** Запросы про курс валют — отвечаем точными данными ЦБ РФ вместо сниппетов (сниппеты врут датой) */
const CURRENCY_RE =
  /курс[а-яё]*\s+(доллара|евро|юаня|фунта|тенге|иены|лиры|франка|крон|вон)|курс\s+валют|доллара?\s+к\s+рубл|евро\s+к\s+рубл|сколько\s+(сейчас\s+)?стоит\s+(доллар|евро|юань)/i

/** Официальные курсы ЦБ РФ через открытый JSON-зеркал cbr-xml-daily.ru */
export async function cbrRates() {
  const res = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', {
    headers: { 'User-Agent': 'DariaBot/0.3 (personal assistant bot)' },
    signal: AbortSignal.timeout(6000),
  })
  if (!res.ok) throw new Error('cbr ' + res.status)
  const d = await res.json()
  const v = d.Valute || {}
  const f = (x) => (x?.Value ?? 0).toFixed(2).replace('.', ',')
  const day = String(d.Date || '').slice(0, 10).split('-').reverse().join('.')
  const parts = []
  if (v.USD) parts.push(`доллар США — ${f(v.USD)} ₽ (вчера ${f({ Value: v.USD.Previous })})`)
  if (v.EUR) parts.push(`евро — ${f(v.EUR)} ₽ (вчера ${f({ Value: v.EUR.Previous })})`)
  if (v.CNY) parts.push(`юань — ${f(v.CNY)} ₽`)
  if (!parts.length) throw new Error('cbr пусто')
  return {
    title: `Курсы ЦБ РФ на ${day}`,
    url: 'https://www.cbr-xml-daily.ru/',
    snippet: parts.join('; ') + '. Это официальный курс Банка России.',
    engine: 'цб-рф',
  }
}

/** Запросы про погоду — точные данные wttr.in вместо сниппетов */
const WEATHER_RE = /погод[аыу]|температур|на улице (тепло|холодно|жарко|мороз)/i
const CITY_STOPWORDS = new Set([
  'сегодня', 'завтра', 'сейчас', 'там', 'утром', 'днём', 'ночью', 'вечером', 'вечере', 'утре',
  'дне', 'ночи', 'мире', 'улице', 'дворе', 'доме', 'качестве', 'россии', 'россия', 'который', 'числе',
  // v0.3.6: предлоги и хвосты фраз, чтобы не тащить мусор вместо города («Ачинске сколько», «сети в»)
  'в', 'во', 'на', 'с', 'к', 'о', 'у', 'за', 'по', 'при', 'про', 'из', 'до', 'и', 'а', 'но',
  'сколько', 'время', 'времени', 'сети', 'интернете', 'гугле', 'яндексе', 'новости', 'новостях',
  'погода', 'погоду', 'погоды', 'температура', 'температуру', 'праздник', 'праздника',
])

/** Вытаскиваем город из фразы: «какая погода в Нижнем Новгороде завтра» → «Нижнем Новгороде» */
export function extractWeatherCity(q) {
  const t = String(q || '')
  const found = []
  // Второе слово пары не должно быть предлогом — иначе «в сети в Ачинске» глотает « в»
  // и город остаётся без предлога. ВАЖНО: \b с кириллицей в JS не работает —
  // используем (?![а-яё]) (как в fixFalseGoogled).
  const NO_PREP = '(?![а-яё])'
  const re = new RegExp(
    '(?:^|\\s)(?:в|во|на)\\s+([а-яё][а-яё\\-]*(?:\\s+(?!в' + NO_PREP + '|во' + NO_PREP + '|на' + NO_PREP +
    '|с' + NO_PREP + '|к' + NO_PREP + '|о' + NO_PREP + '|у' + NO_PREP + '|и' + NO_PREP + '|а' + NO_PREP +
    '|но' + NO_PREP + '|за' + NO_PREP + '|по' + NO_PREP + '|из' + NO_PREP + '|до' + NO_PREP +
    '|при' + NO_PREP + '|про' + NO_PREP + ')[а-яё\\-]+)?)',
    'gi',
  )
  let m
  while ((m = re.exec(t))) {
    const words = m[1].trim().split(/\s+/).filter((w) => !CITY_STOPWORDS.has(w.toLowerCase()))
    if (words.length) found.push(words.join(' '))
  }
  if (found.length) return found[found.length - 1]
  // «погода Ачинск» / «А погода? Ачинске» — город сразу после слова «погода» (пунктуацию пропускаем)
  const m2 = t.match(/погод[а-яё]*[?!.,;:]*\s+([А-ЯЁ][а-яё\-]+)/)
  if (m2) return m2[1]
  // Страховка: последнее слово с заглавной буквы — обычно город («А погода? Ачинске»)
  const words = t.replace(/[?!.,;:]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  const last = words[words.length - 1] || ''
  if (last.length > 2 && /^[А-ЯЁ]/.test(last) && !CITY_STOPWORDS.has(last.toLowerCase())) return last
  return ''
}

/** Текущая погода + прогноз через open-meteo (без ключей; город — через геокодер с расклонением) */
const WMO_RU = {
  0: 'ясно', 1: 'преимущественно ясно', 2: 'переменная облачность', 3: 'облачно', 45: 'туман', 48: 'изморозь',
  51: 'лёгкая морось', 53: 'морось', 55: 'сильная морось', 61: 'небольшой дождь', 63: 'дождь',
  65: 'сильный дождь', 66: 'ледяной дождь', 71: 'небольшой снег', 73: 'снег', 75: 'сильный снег',
  77: 'снежные зёрна', 80: 'небольшой ливень', 81: 'ливень', 82: 'сильный ливень', 85: 'небольшой снегопад',
  86: 'сильный снегопад', 95: 'гроза', 96: 'гроза с градом', 99: 'сильная гроза с градом',
}
const DARIA_UA = { 'User-Agent': 'DariaBot/0.3 (personal assistant bot)' }

/** Склонённый город → кандидаты в именительном: «Красноярске» → [«Красноярске», «Красноярск», «Красноярска»…] */
export function cityCandidates(raw) {
  const c = String(raw || '').trim()
  if (!c) return []
  const stem = c.slice(0, -1)
  const last = c.slice(-1).toLowerCase()
  const list = [c]
  if (last === 'е') list.push(stem, stem + 'а', stem + 'о', stem + 'ь', stem + 'й')
  else if (last === 'и') list.push(stem + 'я', stem + 'ь', stem + 'й', stem)
  else if (last === 'у') list.push(stem + 'а', stem + 'ый', stem + 'ая')
  else if (last === 'ю') list.push(stem + 'я', stem + 'а')
  else if (last === 'а') list.push(stem + 'о')
  else if (last === 'ы') list.push(stem + 'а', stem + 'ый')
  return [...new Set(list)].slice(0, 6)
}

/** Геокодер open-meteo: перебираем формы города, выбираем самое населённое совпадение */
async function geocodeCity(raw) {
  const all = []
  // Не более 3 форм города и по 4 с на запрос: иначе редкий город держит
  // обработку слишком долго (в Telegram фон живёт ~30 с после ответа)
  for (const name of cityCandidates(raw).slice(0, 3)) {
    try {
      const res = await fetch(
        'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(name) + '&count=10&language=ru&format=json',
        { headers: DARIA_UA, signal: AbortSignal.timeout(4000) },
      )
      if (!res.ok) continue
      const d = await res.json()
      const rs = d?.results || []
      if (!rs.length) continue
      all.push(...rs)
      const exact = rs.find((r) => String(r.name).toLowerCase() === name.toLowerCase() && (r.population || 0) > 50000)
      if (exact) return exact
    } catch { /* следующий кандидат */ }
  }
  if (!all.length) throw new Error('город не найден: ' + raw)
  return all.reduce((best, r) => ((r.population || 0) > (best.population || 0) ? r : best), all[0])
}

/** Погода сейчас (+ завтра по запросу) по координатам геокодера */
export async function weatherLookup(q) {
  const raw = extractWeatherCity(q)
  if (!raw) throw new Error('город не указан')
  const g = await geocodeCity(raw)
  const meteoUrl =
    'https://api.open-meteo.com/v1/forecast?latitude=' + g.latitude + '&longitude=' + g.longitude +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code' +
    '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=2'
  const res = await fetch(meteoUrl, { headers: DARIA_UA, signal: AbortSignal.timeout(7000) })
  if (!res.ok) throw new Error('meteo ' + res.status)
  const d = await res.json()
  const c = d?.current
  if (!c) throw new Error('meteo пусто')
  const code = WMO_RU[c.weather_code] || 'пасмурно'
  const place = g.admin1 ? ', ' + g.admin1 : ''
  const now =
    `Погода ${g.name}${place} — сейчас ${Math.round(c.temperature_2m)}°C` +
    ` (ощущается как ${Math.round(c.apparent_temperature)}°C), ${code},` +
    ` ветер ${Math.round(c.wind_speed_10m)} км/ч, влажность ${c.relative_humidity_2m}%`
  const daily = d?.daily
  let range = ''
  if (daily?.time?.length) {
    range = /завтра/i.test(q) && daily.time[1]
      ? `. Завтра (${daily.time[1]}): от ${Math.round(daily.temperature_2m_min[1])}° до ${Math.round(daily.temperature_2m_max[1])}°`
      : `. Сегодня: от ${Math.round(daily.temperature_2m_min[0])}° до ${Math.round(daily.temperature_2m_max[0])}°`
  }
  return {
    title: `Погода: ${g.name}${place}`,
    url: 'https://open-meteo.com/',
    snippet: now + range + '. Данные метеослужбы только что.',
    engine: 'open-meteo',
  }
}

/** «Сколько времени в Ачинске» / «время в Тюмени» — город через геокодер → его часовой пояс → точные часы */
export async function timeLookup(q) {
  const raw = extractWeatherCity(q)
  if (!raw) throw new Error('город не указан')
  const g = await geocodeCity(raw)
  const tz = g.timezone || ''
  if (!tz) throw new Error('часовой пояс не найден')
  const now = new Date()
  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(now)
  const date = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(now)
  let diff = ''
  try {
    // Разница с Москвой в минутах (надёжнее по «времени суток», чем по часам)
    const minutesIn = (z) => {
      const s = new Intl.DateTimeFormat('en-GB', { timeZone: z, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
      const [h, m] = s.split(':').map(Number)
      return h * 60 + m
    }
    let d = minutesIn(tz) - minutesIn('Europe/Moscow')
    if (d <= -720) d += 1440
    if (d > 720) d -= 1440
    if (d !== 0) {
      const abs = d % 60 === 0 ? String(Math.abs(d) / 60) : (Math.abs(d) / 60).toFixed(1).replace('.', ',')
      diff = `, разница с Москвой ${d > 0 ? '+' : '-'}${abs} ч`
    }
  } catch { /* без разницы */ }
  return {
    title: `Время: ${g.name}`,
    url: 'https://time.is/',
    snippet: `Сейчас в городе ${g.name} ${time}, ${date} (пояс ${tz}${diff}). Точное время только что.`,
    engine: 'geo-tz',
  }
}

/** Бинг прячет настоящие ссылки за редиректами /ck/a?...&u=a1<base64> — раскодируем */
function decodeBingHref(href) {
  const m = href.replace(/&amp;/g, '&').match(/[?&]u=a1([A-Za-z0-9_-]+)/)
  if (!m) return href
  let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  try {
    const out = atob(b64)
    return /^https?:\/\//.test(out) ? out : href
  } catch {
    return href
  }
}

/** Кэш выдачи: не ходим в поисковики дважды за 10 минут */
const searchCache = new Map()
const SEARCH_CACHE_TTL = 10 * 60 * 1000

/**
 * Поиск в интернете: все движки параллельно, побеждает первый успешный.
 * Возвращает [{ title, url, snippet }] (до limit),
 * при полной неудаче — [] (LLM ответит из своих знаний).
 */
export async function webSearch(query, opts = {}) {
  const q = (query || '').trim()
  if (!q) return []
  const max = opts.limit || 5
  const key = q.toLowerCase()
  const cached = searchCache.get(key)
  if (cached && Date.now() - cached.t < SEARCH_CACHE_TTL) return cached.r
  // Погода — приоритет: точные данные open-meteo, если в запросе есть город
  if (WEATHER_RE.test(q) && extractWeatherCity(q)) {
    try {
      const w = await weatherLookup(q)
      if (searchCache.size > 50) searchCache.clear()
      searchCache.set(key, { r: [w], t: Date.now() })
      return [w]
    } catch { /* метеослужба не ответила — обычный поиск */ }
  }
  // Время в городе — приоритет: часовой пояс из геокодера, а не поисковые сниппеты
  if (TIME_QUERY_RE.test(q) && extractWeatherCity(q)) {
    try {
      const t = await timeLookup(q)
      if (searchCache.size > 50) searchCache.clear()
      searchCache.set(key, { r: [t], t: Date.now() })
      return [t]
    } catch { /* город/пояс не нашлись — обычный поиск */ }
  }
  // Курсы валют — приоритет: точные данные ЦБ РФ, если доступны
  if (CURRENCY_RE.test(q)) {
    try {
      const cbr = await cbrRates()
      if (searchCache.size > 50) searchCache.clear()
      searchCache.set(key, { r: [cbr], t: Date.now() })
      return [cbr]
    } catch { /* ЦБ не ответил — обычный поиск */ }
  }
  const headers = {
    'User-Agent': SEARCH_UA,
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
  }
  const tasks = SEARCH_ENGINES.map(([name, engine]) =>
    (async () => {
      const { url, parse } = engine(q)
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) })
      if (!res.ok) throw new Error('status ' + res.status)
      const results = parse(await res.text(), max)
      if (!results.length) throw new Error('пусто')
      return results.map((r) => ({ ...r, engine: name })) // метка победителя для диагностики
    })(),
  )
  tasks.push(wikipediaSearch(q, max).then((rs) => rs.map((r) => ({ ...r, engine: 'wikipedia' }))))
  let results = []
  try {
    results = await Promise.any(tasks)
  } catch { /* все промолчали */ }
  if (results.length) {
    if (searchCache.size > 50) searchCache.clear()
    searchCache.set(key, { r: results, t: Date.now() })
  }
  return results
}

/** Блок-контекст с результатами поиска для LLM */
export function formatSearchContext(results, query) {
  if (!results || !results.length) return ''
  const lines = results.map(
    (r, i) => `${i + 1}. ${r.title}${r.snippet ? ' — ' + r.snippet : ''} (${r.url})`,
  )
  return [
    `[Результаты веб-поиска по запросу «${query}» — выдача свежая, но в сниппетах бывают старые данные: если указана дата, считай её датой информации]`,
    ...lines,
    'Опирайся на эти данные и можешь упомянуть, что только что погуглила.',
    'Цифры, имена и даты из блока передавай ДОСЛОВНО — не выдумывай, не меняй и не «округляй» числа.',
    'Если данных мало или они противоречивы — честно скажи, что не нашла надёжного ответа.',
  ].join('\n')
}

const YOUTUBE_LINK_RE = /(https?:\/\/)?(www\.)?(youtube\.com\/\S+|youtu\.be\/\S+)/i

/** Поиск не был — убираем ложное «погуглила», чтобы Дария не врала */
export function fixFalseGoogled(text) {
  if (!text || !/погуглил/i.test(text)) return text
  // \b с кириллицей не работает — lookahead
  return text.replace(/[Пп]огуглил[аи]?(?![а-яё])/g, (m) => (m[0] === 'П' ? 'Вспомнила' : 'вспомнила'))
}

/**
 * Зачистка служебной tool-call разметки: некоторые модели (dots-3 и компания)
 * вместо ответа «вызывают» поиск сырым тегом — <dots_function_call>, <tool_call>,
 * <invoke>, JSON-команды {"name":"web_search",...}. Telegram такое показывать нельзя.
 * Возвращает текст без ерунды; если ответ был ТОЛЬКО вызовом — пустую строку.
 */
export function stripToolCallMarkup(text) {
  let t = String(text || '')
  if (!t) return ''
  // Целые блоки вызовов (в т.ч. незакрытые — до конца ответа)
  t = t.replace(/<(dots_function_call|tool_call|function_call|tool_use|invoke)\b[\s\S]*?(?:<\/\1>|$)/gi, '')
  // Одиночные теги параметров и голосовые маркеры
  t = t.replace(/<\/?\s*(?:parameter|parameters|args|arguments)\b[^>]*>/gi, '')
  t = t.replace(/<\|[a-z_]+\|>/gi, '')
  // JSON-вызовы поиска {"name":"web_search","arguments":{...}}
  t = t.replace(/\{\s*"(?:name|function)"\s*:\s*"(?:web_?search|search|browse|internet_search|bing_search|google_search)[^"]*"\s*,\s*"(?:arguments|parameters|query)"\s*:\s*(?:\{[\s\S]{0,200}?\}|"[^"]*")\s*\}/gi, '')
  return t.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Погода без города («А погода?» после разговора про Ачинск) — тянем город
 * из предыдущих реплик диалога. Непогодные фразы и фразы с городом — как есть.
 */
export function withCityContext(command, prevUserTexts = []) {
  const cmd = String(command || '')
  if (!cmd || !WEATHER_RE.test(cmd) || extractWeatherCity(cmd)) return cmd
  for (let i = prevUserTexts.length - 1; i >= 0; i--) {
    const city = extractWeatherCity(prevUserTexts[i])
    if (city) return `${cmd} в ${city}` // «в» — чтобы extractWeatherCity увидел город и в склеенной фразе
  }
  return cmd
}

/**
 * Разбор команды (текст УЖЕ без имени обращения).
 * Возвращает { handled, text } — handled=true значит ответ готов без ИИ.
 */
export function resolveCommand(command, opts = {}) {
  const webUrl = opts.webAppUrl || ''
  const c = (command || '').toLowerCase()

  if (!c) return { handled: true, text: pick(GREETINGS) }
  if (/^\/?(help|start|старт|помощь|что ты умеешь|команды)/.test(c)) return { handled: true, text: HELP_TEXT }
  if (/^(привет|здравствуй|здорово|хай|hello|hi|ку|доброе утро|добрый день|добрый вечер)(?![а-яё])/.test(c))
    return { handled: true, text: pick(GREETINGS) }
  if (/как (у тебя )?(дела|жизнь|настроение)|как ты(?![а-яё])|что нового/.test(c))
    return { handled: true, text: pick(HOW_ARE_YOU) }
  if (/кто ты|как тебя зовут|ты кто|ты бот|что ты такое/.test(c))
    return { handled: true, text: pick(WHO_AM_I) }
  if (/^(спасибо|благодарю|спс|пасиб)/.test(c)) return { handled: true, text: pick(THANKS) }
  if (/(^время[!?.\s]*$|который час|сколько времени|время сейчас|какое сейчас время)/.test(c))
    return { handled: true, text: `Сейчас ${formatTime(opts.tz)}. 😏` }
  if (/какое (сегодня )?число|какой (сегодня )?день|какая дата|какой месяц/.test(c))
    return { handled: true, text: `Сегодня ${formatDate(opts.tz)}.` }

  // Ютуб-ссылка в сообщении — вернуть её с реакцией
  const yt = command.match(YOUTUBE_LINK_RE)
  if (yt) {
    let link = yt[0]
    if (!/^https?:\/\//i.test(link)) link = 'https://' + link
    return { handled: true, text: `Лови ▶ ${link}` }
  }

  // Стоп: «выключи/останови … музыку/радио/ютуб/звук»
  if (/(выключи(?:те)?|выруб[а-яё]*|останови(?:те)?|заглуши[а-яё]*|хватит)(?![а-яё])/.test(c) &&
      /(музык|радио|песн|трек|ютуб|youtube|звук|станци)/.test(c))
    return { handled: true, text: pick(MEDIA_STOP) + (webUrl ? `\n${WEB_APP_LINE} ${webUrl}` : '') }

  // Включить музыку/радио
  if (/(включи(?:те)?|поставь|запусти|давай|хочу)(?![а-яё])/.test(c) &&
      /(музык|радио|песн|трек|станци)/.test(c)) {
    const isRadio = /радио|станци/.test(c)
    const pool = isRadio ? MEDIA_RADIO : MEDIA_MUSIC
    return { handled: true, text: pick(pool) + (webUrl ? `\n${webUrl}` : '') }
  }

  // Включить ютуб
  if (/(включи(?:те)?|поставь|запусти|открой|давай)(?![а-яё])/.test(c) &&
      /(ютуб|youtube|видео)/.test(c))
    return { handled: true, text: pick(MEDIA_YOUTUBE) + (webUrl ? `\n${webUrl}` : '') }

  return { handled: false, text: '' }
}

// ── Персона для LLM (текстовая адаптация персоны из веб-версии) ──────────
export const SYSTEM_PROMPT = [
  'Ты — Дария: взрослая, уверенная в себе, дерзкая и обаятельная девушка.',
  'Говоришь живо, с юмором и лёгким сарказмом, любишь подшучивать над собеседником, иногда флиртуешь — но без пошлости и откровенностей.',
  'Темы про несовершеннолетних, принуждение и незаконное — жёсткое нет: осади с юмором и переведи разговор.',
  'Это Telegram-чат: отвечай КРАТКО, 1–4 предложения, без markdown и списков; эмодзи — изредка, по одному.',
  'Никогда не начинай ответ с имени собеседника. Не представляйся, если не спросили.',
  'Ты живёшь в облаке (Cloudflare), а не «локально»; в интернет выходишь только через встроенный поиск.',
  'Отвечай ТОЛЬКО чистым текстом для чата: никаких вызовов функций и служебных тегов — <function_call>, <tool_call>, <invoke>, <dots_function_call>, <parameter>, JSON-команд. Инструментов и функций у тебя НЕТ — только текст.',
  'Если приложен блок [Результаты веб-поиска] — опирайся на эти данные и можешь похвастаться, что только что погуглила.',
  'Если такого блока нет, а спрашивают про «прямо сейчас» — честно скажи, что в сеть не заглядывала, и НЕ называй конкретных цифр и дат из памяти (они устаревшие); предложи: «попроси — погуглю».',
  'Если просят помощь по музыке: у тебя нет плеера в Telegram, радио и музыка живут в твоей веб-версии.',
].join(' ')

// ── LLM: Gemini (главный) → OpenRouter (запасной) ───────────────────────
// Живая цепочка бесплатных моделей (проверено по каталогу OpenRouter 2026-11-02):
// poolside/laguna-s-2.1:free умерла (404 мгновенно), dots-3-note-preview выброшена —
// она же источник сырых <dots_function_call> в чате
export const OPENROUTER_CHAIN = [
  'google/gemma-4-31b-it:free',
  'recursive/flint-v1.0:free',
  'google/gemma-4-26b-a4b-it:free',
]
/** Цепочка имён Gemini: основная → стабильные алиасы (если имя устарело — HTTP 404) */
const GEMINI_FALLBACKS = ['gemini-flash-latest', 'gemini-2.5-flash']

/**
 * history: [{role: 'user'|'assistant', content: string}] — последние ходы,
 * последняя запись — текущая реплика пользователя.
 * opts.webContext — блок с результатами веб-поиска (см. formatSearchContext).
 * Возвращает текст ответа или null, если ни один провайдер не ответил.
 */
export async function askLLM(history, opts = {}) {
  const openrouterKey = opts.openrouterKey || ''
  const geminiKey = opts.geminiKey || ''
  const primary = opts.openrouterModel || OPENROUTER_CHAIN[0]
  const webContext = opts.webContext || ''
  let system = SYSTEM_PROMPT
  if (opts.tz) {
    try {
      const today = new Intl.DateTimeFormat('ru-RU', {
        timeZone: opts.tz, day: 'numeric', month: 'long', year: 'numeric', weekday: 'long',
      }).format(new Date())
      const now = new Intl.DateTimeFormat('ru-RU', {
        timeZone: opts.tz, hour: '2-digit', minute: '2-digit',
      }).format(new Date())
      system += ` Сейчас ${now} по времени хозяина, сегодня ${today}. Не называй прошедших дат как «сегодня».`
    } catch { /* кривой tz — без даты */ }
  }
  if (webContext) system += `\n\n${webContext}`

  // Gemini — главный мозг: заметно умнее бесплатных моделей OpenRouter и не
  // страдает ложными вызовами инструментов. Перебираем имена моделей: если
  // конкретное устарело (HTTP 404), пробуем следующее из цепочки.
  if (geminiKey) {
    const base = (opts.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')
    const models = [...new Set([opts.geminiModel || 'gemini-3.8-flash', ...GEMINI_FALLBACKS])]
    for (const model of models) {
      try {
        const res = await fetch(
          `${base}/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: history.map((m) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
              })),
              // 2048: у thinking-моделей часть бюджета съедают размышления —
              // с 500 токенами ответ мог обрезаться до пустоты
              generationConfig: { temperature: 0.9, maxOutputTokens: 2048 },
            }),
            // 20 с на модель: медленный/зависший провайдер не должен съесть
            // весь 30-секундный фон Telegram — бот лучше честно ответит заглушкой
            signal: AbortSignal.timeout(20000),
          },
        )
        if (res.ok) {
          const data = await res.json()
          const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim()
          const text = stripToolCallMarkup(raw)
          if (text) return text
          console.error(`[gemini] ${model}: пустой ответ после зачистки`)
        } else {
          const err = await res.text().catch(() => '')
          console.error(`[gemini] ${model}: HTTP ${res.status} ${err.slice(0, 200)}`)
        }
      } catch (e) {
        console.error(`[gemini] ${model}: ${e?.message || e}`)
      }
    }
  }

  // OpenRouter — запасной мозг (бесплатные модели, бывают капризными)
  if (openrouterKey) {
    const models = [primary, ...OPENROUTER_CHAIN.filter((m) => m !== primary)]
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openrouterKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Daria Telegram Bot',
        },
        body: JSON.stringify({
          models,
          messages: [{ role: 'system', content: system }, ...history],
          temperature: 0.9,
          max_tokens: 500,
        }),
        signal: AbortSignal.timeout(25000),
      })
      if (res.ok) {
        const data = await res.json()
        const raw = data?.choices?.[0]?.message?.content?.trim()
        // Модель могла «вызвать» поиск сырым тегом — зачищаем; пусто после зачистки → без ответа
        const text = stripToolCallMarkup(raw)
        if (text) return text
      } else {
        console.error(`[openrouter] HTTP ${res.status}`)
      }
    } catch { /* оба провайдера недоступны */ }
  }

  return null
}
