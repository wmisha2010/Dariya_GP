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
 *  - всё остальное → LLM (Coarena — главный мозг, Gemini через мост и
 *    OpenRouter — запасные); без ключей — вежливая заглушка.
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
  'Мозг сегодня молчит — ни Coarena, ни запасные Gemini и OpenRouter не ответили 😅 Чаще всего это суточные лимиты бесплатных моделей или спящий мост. Хозяину: повтори через минуту.',
  'Хотела ответить умно, но мозг промолчал 😄 Хозяину намёк: дневной лимит Coarena мог кончиться, у бесплатных моделей OpenRouter свои лимиты, а мост Gemini мог быть выключен — попробуй позже.',
]

export const NO_PAINT = [
  'Хотела нарисовать, но художница сегодня не удалась: сервис картинок не ответил 🙈 Попробуй ещё раз чуть позже!',
  'Кисти закончились — API рисования молчит 😅 Повтори позже, я помню, что ты просила!',
  'Не вышло нарисовать: картинный мозг не ответил. Спроси словами — на это я точно отвечу!',
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
const SEARCH_HINTS_RE = /погода|новост|курс [а-яё]|курс\b.*(доллар|евро|рубл|биткоин|юан)|доллар.*(подорожал|подешевел|курс)|биткоин|эфириум|крипт|кто победил|сч[её]т матча|счет матча|итог(ы)? матча|сколько (стоит|стоят)|стоимость|цена|цены на|дата выхода|когда выйдет|когда вышл[ао]|последн(ие|яя) (новост|серия|сезон|версия|релиз|обновлени)|свеж(ие|ая) новост|тренд|расписание|премьер[аы]|кто такой|кто такая|праздник|выходн|отмеча|какой сегодня|какое сегодня|какой сейчас|какое сейчас|какой (день|год|число)|что (сегодня|сейчас) (в россии|в мире|происходит)|что (нового|происходит|творится|слышно)|(?:сколько\s+)?времени\s+в\s+[а-яё]|время\s+в\s+[а-яё]/i

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

/** Новостные запросы — живая лента Google News вместо поисковиков. Без этого
 *  пути гонку движков обычно выигрывает Википедия — и на «последние новости»
 *  приходят энциклопедические статьи О новостях, а не сами новости
 *  (проверено в проде 2026-11-18: «Википедия: Последние новости — газета…»). */
export const NEWS_RE =
  /новост|что нового|что происходит|что творится|что слышно|срочн(ые|ая|о) (новост|сообщ)/i

/** Общий новостной запрос без темы («последние новости», «что происходит?»,
 *  «новости сегодня», «новости в мире») — берём главную ленту топ-новостей,
 *  а не поиск RSS по слову «новости». Хвост «сегодня/за неделю/в мире» не
 *  делает запрос тематическим (v0.3.40: раньше «новости сегодня» проваливался
 *  в topic-поиск Google, который из CF-воркера виснет до таймаута). */
const GENERIC_NEWS_RE =
  /^(?:последние|свежие|главные|сегодняшние|срочные|топ)?\s*(?:новост[а-яё]*|события|что нового|что происходит|что творится|что слышно)(?:\s+(?:сегодня|сейчас|за\s+(?:неделю|день|сутки|час|месяц)|в\s+(?:мире|россии|стране|сети|интернете)|у\s+нас))*\s*[?!.]*$/i

/** Разбор RSS-ленты: <item> с title «Заголовок - Источник», link, pubDate */
export function parseNewsRss(xml, max = 6, engine = 'google-news') {
  const items = [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)]
  const out = []
  const dateFmt = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
  })
  for (const it of items) {
    if (out.length >= max) break
    const block = it[1]
    const pick = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
      return m ? stripTags(m[1]) : ''
    }
    const rawTitle = pick('title')
    if (!rawTitle) continue
    // У агрегаторов источник в конце заголовка: «Заголовок - Источник»
    const dash = rawTitle.lastIndexOf(' - ')
    const title = dash > 0 ? rawTitle.slice(0, dash) : rawTitle
    const url = pick('link')
    if (!/^https?:\/\//.test(url)) continue
    const when = (() => {
      const d = new Date(pick('pubDate'))
      return Number.isNaN(d.getTime()) ? '' : dateFmt.format(d)
    })()
    const source = pick('source') || (dash > 0 ? rawTitle.slice(dash + 3) : '')
    // <description> лент Lenta/РИА/ТАСС/Bing — 1-2 предложения сути новости: без
    // них модель отвечает по одним заголовкам (жалоба владельца 2026-11-21).
    // У google-news description — повтор заголовка ссылками: пропускаем.
    let snippet = [source, when].filter(Boolean).join(', ')
    if (engine !== 'google-news') {
      const desc = stripTags(pick('description')).slice(0, 180)
      if (desc) snippet = snippet ? `${snippet} — ${desc}` : desc
    }
    out.push({ title, url, snippet, engine })
  }
  return out
}

/** Новостные RSS-ленты для общего запроса. Google News может не отвечать из
 *  датацентра Cloudflare (проверено 2026-11-18: fetch виснет до таймаута), поэтому
 *  ленты стартуют ГОНКОЙ — победитель тот, кто первым отдаст валидный RSS:
 *  Google News + Lenta + РИА + ТАСС (все проверенно живы, RSS 2.0 с pubDate). */
const NEWS_FEEDS = [
  ['google-news', () => 'https://news.google.com/rss?hl=ru&gl=RU&ceid=RU:ru'],
  ['lenta', () => 'https://lenta.ru/rss/news'],
  ['ria', () => 'https://ria.ru/export/rss2/archive/index.xml'],
  ['tass', () => 'https://tass.ru/rss/v2.xml'],
]

async function fetchNewsFeed(name, url, max) {
  // Браузерный UA: Bing News RSS лоялен к нему, а «DariaBot/0.3» у Bing не проверен
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 'Accept-Language': 'ru-RU,ru;q=0.9' },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(name + ' ' + res.status)
  const items = parseNewsRss(await res.text(), max, name)
  if (!items.length) throw new Error(name + ' пусто')
  return items
}

/** Тематический поиск новостей через Bing News RSS (v0.3.40): формат=RSS,
 *  описания с сутью новости, жив из датацентра Cloudflare. */
function bingNewsTopic(q, max) {
  return fetchNewsFeed(
    'bing-news',
    'https://www.bing.com/news/search?q=' + encodeURIComponent(q) + '&format=RSS&setmkt=ru-RU',
    max,
  )
}

/** Живые новости: общий запрос («последние новости», «новости сегодня», «что
 *  происходит?») — гонка топ-лент; с темой («новости футбола») — гонка
 *  Google News topic (из CF-воркера виснет до таймаута) ↔ Bing News topic —
 *  побеждает первый валидный RSS; если оба молчат, webSearch отыграет обычной
 *  гонкой движков. */
export async function newsSearch(query, max = 6) {
  const t = (query || '').trim()
  if (!t || GENERIC_NEWS_RE.test(t)) {
    return Promise.any(NEWS_FEEDS.map(([name, feed]) => fetchNewsFeed(name, feed(), max)))
  }
  return Promise.any([
    fetchNewsFeed(
      'google-news',
      'https://news.google.com/rss/search?q=' + encodeURIComponent(t) + '&hl=ru&gl=RU&ceid=RU:ru',
      max,
    ),
    bingNewsTopic(t, max),
  ])
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
  else if (last === 'у') list.push(stem, stem + 'а', stem + 'ый', stem + 'ая')
  else if (last === 'ю') list.push(stem + 'я', stem + 'а')
  else if (last === 'а') list.push(stem + 'о')
  else if (last === 'ы') list.push(stem + 'а', stem + 'ый')
  return [...new Set(list)].slice(0, 6)
}

/** Крупные регионы, которых в геокодере НЕТ (он знает только населённые пункты):
 *  на «Крым» он отвечает деревней «Крым» (4475 чел.) и городом «Крымск», а
 *  «Крыму» не находит ничего (прод 2026-11-21: «погода в Крыму» падала в гонку
 *  движков и отвечала Википедией про фильм 1989 года). Координаты — центр
 *  региона (для Крыма — Симферополь); карта пополняется по мере жалоб. */
const REGION_PLACES = {
  'крым': { name: 'Крым', latitude: 44.9521, longitude: 34.1021, admin1: '' },
}

/** Геокодер open-meteo: перебираем формы города, выбираем самое населённое совпадение */
async function geocodeCity(raw) {
  const all = []
  // Сначала регионы мимо геокодера: «Крыму» → кандидат «Крым» из карты
  for (const f of cityCandidates(raw).slice(0, 3)) {
    const r = REGION_PLACES[String(f).toLowerCase()]
    if (r) return r
  }
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
  // Новости — приоритет: живая лента Google News, свежие заголовки с датами
  if (NEWS_RE.test(q)) {
    try {
      const news = await newsSearch(q, max)
      if (searchCache.size > 50) searchCache.clear()
      searchCache.set(key, { r: news, t: Date.now() })
      return news
    } catch { /* лента не ответила — обычный поиск */ }
  }
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
  // Новостному fallback'у Википедия только мешает: на «новости футбола» она
  // побеждает гонку и отвечает «Википедия: Мамаев…» вместо новостей (прод
  // 2026-11-21). Энциклопедия — для фактов, не для свежих новостей.
  if (!NEWS_RE.test(q)) tasks.push(wikipediaSearch(q, max).then((rs) => rs.map((r) => ({ ...r, engine: 'wikipedia' }))))
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
    'Опирайся на эти данные, когда они относятся к вопросу, и можешь упомянуть, что только что погуглила.',
    'Если результаты не относятся к вопросу собеседника (болтовня, а не факт про мир) — игнорируй их и отвечай как обычно.',
    'Цифры, имена и даты из блока передавай ДОСЛОВНО — не выдумывай, не меняй и не «округляй» числа.',
    'Если данных мало или они противоречивы — честно скажи, что не нашла надёжного ответа.',
  ].join('\n')
}

const YOUTUBE_LINK_RE = /(https?:\/\/)?(www\.)?(youtube\.com\/\S+|youtu\.be\/\S+)/i

// ── Чтение страниц целиком (v0.3.27): сниппет → полный текст статьи ──────
// Сниппет поисковика — 150–300 символов («оглавление»). Здесь качаем топ-N
// страниц выдачи, вырезаем основной текст и отдаём модели настоящую статью.

/** HTML → чистый текст: скрипты/стили/служебные секции долой, <article>/<main>
 *  приоритетнее всего документа, блоки → переводы строк, числовые entity → символы. */
export function extractPageText(html, maxChars = 6000) {
  let h = String(html || '')
  h = h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|footer|header|aside|form|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
  const art = h.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i)
  if (art && art[2] && art[2].length > 500) h = art[2]
  h = h
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|figcaption)>/gi, '\n')
  h = stripTags(h)
  h = h
    .replace(/&#(\d{1,5});/g, (_, n) => {
      const c = Number(n)
      return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '
    })
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => {
      const c = parseInt(n, 16)
      return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '
    })
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&[a-z]{2,8};/gi, ' ')
  h = h.replace(/[ \t\u00A0]+/g, ' ').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (h.length > maxChars) h = h.slice(0, maxChars) + '…'
  return h
}

/** Заголовок <title> (без тегов, ≤120 символов) */
function pageTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return stripTags(m ? m[1] : '').replace(/\s+/g, ' ').trim().slice(0, 120)
}

/** Качает страницу → {url, title, text} или {error, url}.
 *  Кодировка: charset из Content-Type, иначе <meta charset> в первых 2 КБ;
 *  windows-1251 и koi8-r декодируются штатно, при неудаче — utf-8. */
export async function readPage(url, opts = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': SEARCH_UA,
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(opts.timeoutMs || 8000),
  })
  if (!res.ok) return { error: `HTTP ${res.status}`, url }
  const ct = res.headers.get('content-type') || ''
  if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(ct)) {
    return { error: `не HTML (${(ct.split(';')[0] || '?').trim()})`, url }
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length > 3000000) return { error: 'страница слишком большая', url }
  let charset = (ct.match(/charset=([\w-]+)/i) || [])[1] || ''
  if (!charset) {
    const head = new TextDecoder('utf-8').decode(buf.subarray(0, 2048))
    charset = (head.match(/charset=["']?([\w-]+)/i) || [])[1] || ''
  }
  let html
  try {
    html = new TextDecoder((charset || 'utf-8').toLowerCase()).decode(buf)
  } catch {
    html = new TextDecoder('utf-8').decode(buf)
  }
  if (/text\/plain/i.test(ct)) {
    const max = opts.maxChars || 6000
    const text = html.length > max ? html.slice(0, max) + '…' : html.trim()
    if (!text) return { error: 'пустая страница', url }
    return { url, title: '', text }
  }
  const text = extractPageText(html, opts.maxChars || 6000)
  if (!text || text.length < 80) return { error: 'не вырезался осмысленный текст', url }
  return { url, title: pageTitle(html), text }
}

/** Топ-N страниц выдачи параллельно → единый блок для промпта ('' если ни одна не читается). */
export async function readPagesContext(results, opts = {}) {
  const candidates = (results || [])
    .filter((r) => /^https?:\/\//i.test(r.url || ''))
    .slice(0, opts.limit || 2)
  if (!candidates.length) return ''
  const done = await Promise.all(
    candidates.map((r) =>
      readPage(r.url, { timeoutMs: opts.timeoutMs || 6000, maxChars: opts.maxChars || 5000 }).catch((e) => ({
        error: String(e?.message || e),
        url: r.url,
      })),
    ),
  )
  const ok = done.filter((p) => p.text)
  if (!ok.length) return ''
  const blocks = ok.map((p, i) => `── Страница ${i + 1}: ${p.title || p.url}\n${p.text}`)
  return [
    '[Содержимое страниц из выдачи — тексты прочитаны целиком, а не только сниппеты; среди источников бывают устаревшие: если внутри есть дата, считай её датой информации]',
    ...blocks,
  ].join('\n\n')
}

/** Лимит Telegram на одно сообщение (sendMessage) — 4096 символов UTF-16 */
export const TG_MSG_LIMIT = 4096

/** Длинный ответ → несколько сообщений: режем по концу абзаца → переносу
 *  строки → пробелу → жёстко. Дефолт 4000 (запас до лимита Telegram),
 *  чтобы даже кусок с эмодзи-парными символами точно прошёл. */
export function splitTelegramMessage(text, limit = 4000) {
  const t = String(text || '')
  const max = Math.max(1, Number(limit) || 4000) // кривой limit (0, NaN) → дефолт
  if (!t) return []
  if (t.length <= max) return [t]
  const chunks = []
  let rest = t
  while (rest.length > max) {
    const window = rest.slice(0, max + 1)
    const para = window.lastIndexOf('\n\n')
    const line = window.lastIndexOf('\n')
    const space = window.lastIndexOf(' ')
    // let, не const: ниже защитный guard переприсваивает cut (урок v0.3.21)
    let cut = para > max * 0.4 ? para : line > max * 0.4 ? line : space > max * 0.4 ? space : max
    if (cut <= 0) cut = max // разрез в позиции 0 → пустой кусок → вечный цикл
    chunks.push(rest.slice(0, cut).replace(/\s+$/, ''))
    rest = rest.slice(cut).replace(/^\s+/, '')
  }
  if (rest) chunks.push(rest)
  return chunks
}

/** Поиск не был — убираем ложное «погуглила», чтобы Дария не врала */
export function fixFalseGoogled(text) {
  if (!text || !/погуглил/i.test(text)) return text
  // \b с кириллицей не работает — lookahead
  return text.replace(/[Пп]огуглил[аи]?(?![а-яё])/g, (m) => (m[0] === 'П' ? 'Вспомнила' : 'вспомнила'))
}

// ── Рисование (v0.3.22): intent + Gemini image-модели ─────────────────────
// Рисование — НЕ текстовый LLM: с 2026 картинки в Gemini API идут через
// Interactions API (/v1beta/interactions), а не generateContent.

/** Просит ли фразу нарисовать, и что именно. null — обычное сообщение.
 *  Консервативно: только явные глаголы, чтобы не перехватывать болтовню. */
export function extractImageIntent(text) {
  const t = String(text || '').trim()
  if (!t || /^не\b/i.test(t)) return null // «не рисуй» — отказ, не заказ
  let m = t.match(/^(?:ну\s+)?(?:нарисуй(?:ка|те)?|изобрази(?:те)?|сфотографируй)\s+(?:мне\s+)?(.{2,})$/i)
  if (m) return m[1].trim()
  m = t.match(/^(?:сделай|сгенерируй|создай)\s+(?:мне\s+)?(?:картинку|фотку|фото|изображение|рисунок|коллаж|постер)\s+(?:про|на тему|с|о|где|как)?\s*(.{2,})$/i)
  if (m) return m[1].trim()
  return null
}

/** Глубокий поиск картинки-базы64 в ответе Interactions API (поле data
 *  рядом с type:'image' / mime_type). Данные > 1000 символов — не текст. */
function findImageBlock(node, depth = 0) {
  if (!node || depth > 8) return null
  if (Array.isArray(node)) {
    for (const n of node) { const r = findImageBlock(n, depth + 1); if (r) return r }
    return null
  }
  if (typeof node === 'object') {
    if (typeof node.data === 'string' && node.data.length > 1000
      && (node.type === 'image' || node.mime_type || node.mimeType)) {
      return { b64: node.data, mime: node.mime_type || node.mimeType || 'image/png' }
    }
    for (const v of Object.values(node)) { const r = findImageBlock(v, depth + 1); if (r) return r }
  }
  return null
}

const IMAGE_MODELS = ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image']

/** Рисует картинку по текстовому запросу. Успех: { image: {b64, mime, model} },
 *  неудача: { error, tried }. Бюджет ~25 с, чтобы уложиться в фон Telegram. */
export async function geminiImage(prompt, opts = {}) {
  const key = opts.geminiKey || ''
  if (!key) return { error: 'нет GEMINI_API_KEY', tried: [] }
  const base = (opts.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')
  const deadline = Date.now() + 25000
  const tried = []
  let lastError = '' // тело последней ошибки — для диагностики в /image-test

  // Новый путь: Interactions API (2026) — картинки приходят блоками {type:'image', data}
  for (const model of IMAGE_MODELS) {
    if (Date.now() > deadline) break
    tried.push(model)
    try {
      const res = await fetch(`${base}/interactions`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json', 'Api-Revision': '2026-05-20' },
        body: JSON.stringify({ model, input: [{ type: 'text', text: prompt }], response_format: { type: 'image' } }),
        signal: AbortSignal.timeout(20000),
      })
      if (res.ok) {
        const img = findImageBlock(await res.json())
        if (img) return { image: { ...img, model } }
        tried[tried.length - 1] += ' (без картинки в ответе)'
      } else {
        const err = await res.text().catch(() => '')
        tried[tried.length - 1] += ` HTTP ${res.status}`
        lastError = `HTTP ${res.status}: ${err.slice(0, 200)}`
        console.error(`[image] ${model}: HTTP ${res.status} ${err.slice(0, 150)}`)
        if (res.status === 404) break // Interactions API нет у ключа → сразу legacy
      }
    } catch (e) {
      tried[tried.length - 1] += ' таймаут'
      console.error(`[image] ${model}: ${e?.message || e}`)
    }
  }

  // Запасной путь: legacy generateContent с inlineData (пока жив — используем)
  for (const model of ['gemini-2.5-flash-image', 'gemini-2.0-flash-preview-image-generation']) {
    if (Date.now() > deadline) break
    tried.push(`legacy ${model}`)
    try {
      const res = await fetch(`${base}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
        signal: AbortSignal.timeout(20000),
      })
      if (res.ok) {
        const parts = (await res.json())?.candidates?.[0]?.content?.parts || []
        const p = parts.find((x) => x.inlineData?.data)
        if (p) return { image: { b64: p.inlineData.data, mime: p.inlineData.mimeType || 'image/png', model } }
        tried[tried.length - 1] += ' (без inlineData)'
      } else {
        const err = await res.text().catch(() => '')
        tried[tried.length - 1] += ` HTTP ${res.status}`
        lastError = `HTTP ${res.status}: ${err.slice(0, 200)}`
        console.error(`[image-legacy] ${model}: HTTP ${res.status} ${err.slice(0, 150)}`)
      }
    } catch (e) {
      tried[tried.length - 1] += ' таймаут'
      console.error(`[image-legacy] ${model}: ${e?.message || e}`)
    }
  }
  return { error: 'все image-модели недоступны', tried, lastError }
}

// ── Художники без ключей (v0.3.38) ────────────────────────────────────────
// Ключ Gemini протух (2026-11-21: все модели дают «API key not valid», пробы
// /gemini-key-test и /image-test), а рисовать хочется. Цепочка-обёртка
// generateImage: Gemini (если ключ оживёт — качество топ) → Pollinations
// (без ключей вообще, русский промпт) → flux-1-schnell (биндинг Workers AI).

/** Pollinations.ai — бесплатный генератор без ключей. Промпт можно по-русски
 *  (бэкенд сам переводит), flux → turbo как запасной. Возвращает webp? —
 *  пропускаем (Telegram sendPhoto хочет jpeg/png), идём к следующей модели. */
const POLLINATIONS_MODELS = ['flux', 'turbo']

export async function pollinationsImage(prompt, opts = {}) {
  const deadline = Date.now() + (opts.paintTimeoutMs || 22000)
  const tried = []
  for (const model of POLLINATIONS_MODELS) {
    if (Date.now() > deadline) break
    tried.push(`pollinations/${model}`)
    try {
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(String(prompt || '').slice(0, 900))}` +
        `?width=1024&height=1024&nologo=true&model=${model}&referrer=daria-bot&seed=${Math.floor(Math.random() * 1e9)}`
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (!res.ok) { tried[tried.length - 1] += ` HTTP ${res.status}`; continue }
      const buf = new Uint8Array(await res.arrayBuffer())
      const mime = String(res.headers.get('content-type') || '').split(';')[0]
      if (buf.length < 2000 || !mime.startsWith('image/') || mime === 'image/webp') {
        tried[tried.length - 1] += buf.length < 2000 ? ' пусто' : ` mime ${mime} — мимо`
        continue
      }
      let bin = ''
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return { image: { b64: btoa(bin), mime, model: `pollinations-${model}` } }
    } catch (e) {
      tried[tried.length - 1] += ' таймаут'
    }
  }
  return { error: 'pollinations недоступен', tried }
}

/** Workers AI flux-1-schnell — тот же биндинг воркера, что расшифровывает
 *  голосовые (whisper). Ключей не надо; промпт понимает лучше по-английски,
 *  поэтому стоит последним рубежом. Успех: { image: {b64:'image/png'} }. */
export async function workersAiImage(prompt, opts = {}) {
  const ai = opts.aiBinding
  if (!ai) return { error: 'нет биндинга AI' }
  try {
    const r = await Promise.race([
      // v0.3.38b: схема биндинга больше не принимает num_steps/max_sequence_length
      // («5006: Additional or unevaluated properties not allowed») — только prompt
      ai.run('@cf/black-forest-labs/flux-1-schnell', { prompt: String(prompt || '').slice(0, 900) }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('flux >20с')), 20000)),
    ])
    const b64 = typeof r === 'string' ? r : (r?.image || '')
    if (!b64 || b64.length < 1000) return { error: 'flux: пустой ответ' }
    // v0.3.38c: flux отдаёт JPEG-байты под видом PNG — определяем mime по сигнатуре
    // ('/9j/' = FFD8FF JPEG, 'iVBOR' = 89504E47 PNG), Telegram важен честный тип
    const mime = String(b64).startsWith('/9j/') ? 'image/jpeg' : 'image/png'
    return { image: { b64, mime, model: 'flux-1-schnell' } }
  } catch (e) {
    return { error: 'flux: ' + String(e?.message || e).slice(0, 160) }
  }
}

/** Переводит промпт рисования на английский (v0.3.39): flux/Pollinations
 *  следуют английским деталям лучше. Перевод — Workers AI llama-3.3-70b (тот же
 *  биндинг, что и flux: отвечает за ~0.5с, ключей не надо). Уже английский →
 *  как есть; перевод не удался → исходный промпт (рисуем и по-русски, просто
 *  следование деталям слабее). */
const TRANSLATE_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const TRANSLATE_SYSTEM = 'You translate image-generation prompts into English. Reply with ONLY the translated prompt: a single line, no quotes, no explanations, no markdown. Keep art style words (digital painting, photo, anime, watercolor) as-is.'

export async function translateImagePrompt(prompt, opts = {}) {
  const text = String(prompt || '').trim()
  if (!text) return { en: '', translated: false }
  if (!/[а-яё]/i.test(text)) return { en: text, translated: false }
  const ai = opts.aiBinding
  if (!ai?.run) return { en: text, translated: false, translateError: 'нет биндинга AI' }
  try {
    const r = await Promise.race([
      ai.run(TRANSLATE_MODEL, {
        messages: [
          { role: 'system', content: TRANSLATE_SYSTEM },
          { role: 'user', content: text.slice(0, 900) },
        ],
        max_tokens: 220,
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('перевод >8с')), 8000)),
    ])
    const raw = typeof r === 'string' ? r : String(r?.response || '')
    let en = raw.split('\n').map((s) => s.trim()).filter(Boolean)[0] || ''
    en = en.replace(/^["'`*]+|["'`*]+$/g, '').slice(0, 600)
    // латиницы нет — модель не перевела (или промолчала) → рисуем исходный промпт
    if (!en || !/[a-z]/i.test(en)) return { en: text, translated: false, translateError: 'модель не перевела' }
    return { en, translated: true }
  } catch (e) {
    return { en: text, translated: false, translateError: String(e?.message || e).slice(0, 120) }
  }
}

/** Рисование по цепочке художников. Промпт перед рисованием переводится на
 *  английский (translateImagePrompt — фолбэк на исходный при сбое).
 *  Успех: { image: {b64, mime, model}, en, translated, tried, lastError },
 *  неудача: { error, en, translated, tried, lastError } — tried/lastError есть
 *  всегда (диагностика в /image-test). Общий бюджет ~50 с: рисование идёт
 *  в фоне (waitUntil после ответа Telegram), спешка не критична. */
export async function generateImage(prompt, opts = {}) {
  const tried = []
  let lastError = ''
  const tr = await translateImagePrompt(prompt, opts)
  const en = tr.en || String(prompt || '')
  // поля en/translated/translateError — литералами в каждом return: spread
  // переменной мешает TS сливать ветки в один тип с опциональными полями
  const g = await geminiImage(en, opts)
  if (g.image) return { image: g.image, en: tr.en, translated: !!tr.translated, translateError: tr.translateError, tried: g.tried || [], lastError: g.lastError || '' }
  tried.push(...(g.tried || []))
  lastError = g.lastError || ''
  const p = await pollinationsImage(en, opts)
  if (p.image) return { image: p.image, en: tr.en, translated: !!tr.translated, translateError: tr.translateError, tried, lastError }
  tried.push(...(p.tried || []))
  const f = await workersAiImage(en, opts)
  if (f.image) return { image: f.image, en: tr.en, translated: !!tr.translated, translateError: tr.translateError, tried, lastError }
  tried.push(`flux-1-schnell: ${f.error || 'неизвестная ошибка'}`)
  return { error: 'все художники недоступны', en: tr.en, translated: !!tr.translated, translateError: tr.translateError, tried, lastError: lastError || f.error || '' }
}

// ── Расшифровка голосовых (v0.3.25): аудио → текст ────────────────────────
// Telegram голосовые — OGG/Opus. Цепочка: Gemini native (inlineData, умеет
// audio/ogg) → Coarena chat/completions с input_audio (OpenAI-формат, арена
// проксирует мультимодальные модели) → OpenRouter omni-модель (бесплатная).

const AUDIO_OPENROUTER = ['nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free']

function audioFormat(mime) {
  if (/wav/i.test(mime)) return 'wav'
  if (/mpeg|mp3/i.test(mime)) return 'mp3'
  return 'ogg'
}

/** Голосовые ответы (v0.3.35): TTS через биндинг env.AI — @cf/deepgram/aura-1.
 *  Вход { text, speaker, encoding, container }; opus+ogg — ровно то, что Telegram
 *  ждёт от голосовых сообщений. Выход биндинга — ReadableStream (или буфер).
 *  Биндинг не принимает AbortSignal → гонка с таймером: заядрененная очередь не
 *  должна вешать ответ бота. Возвращает { audioB64, mime } или { error }. */
export async function speakText(text, opts = {}) {
  const ai = opts.aiBinding
  if (!ai?.run) return { error: 'нет биндинга AI' }
  const clean = String(text || '').trim()
  if (!clean) return { error: 'пустой текст' }
  // длинный ответ режем по последнему законченному предложению (~1.5 мин речи)
  const cut = clean.slice(0, 1200)
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  const said = stop > 300 ? cut.slice(0, stop + 1) : cut
  const speaker = opts.ttsSpeaker || 'luna'
  const ttsTimeoutMs = opts.ttsTimeoutMs || 20000
  try {
    const out = await Promise.race([
      ai.run('@cf/deepgram/aura-1', { text: said, speaker, encoding: 'opus', container: 'ogg' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`таймаут TTS (>${ttsTimeoutMs}мс)`)), ttsTimeoutMs)),
    ])
    const buf = out instanceof Uint8Array ? out
      : out instanceof ArrayBuffer ? new Uint8Array(out)
      : new Uint8Array(await new Response(out).arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000))
    return { audioB64: btoa(bin), mime: 'audio/ogg' }
  } catch (e) {
    return { error: 'tts: ' + String(e?.message || e).slice(0, 160) }
  }
}

/** Русский голос через веб-версию (v0.3.37): POST {webAppUrl}/api/tts — там
 *  msedge-tts с ru-RU-SvetlanaNeural (бесплатно, без ключей, тот же голос, что
 *  и в вебе). Возврат { audioB64, mime:'audio/mpeg', said } — said это ровно
 *  озвученный кусок (длинные ответы режутся по последнему предложению), чтобы
 *  бот мог отправить хвост текстом. Гонка с таймером: /api/tts устанавливает
 *  websocket, одна фраза ~5с, длинные — до 30с. */
export async function speakTextWeb(text, opts = {}) {
  const base = opts.webAppUrl
  if (!base) return { error: 'нет адреса веб-версии (WEB_APP_URL)' }
  const clean = String(text || '').trim()
  if (!clean) return { error: 'пустой текст' }
  const cut = clean.slice(0, 1200)
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  const said = stop > 300 ? cut.slice(0, stop + 1) : cut
  const timeoutMs = opts.ttsTimeoutMs || 30000
  try {
    const res = await Promise.race([
      fetch(`${String(base).replace(/\/+$/, '')}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: said, voice: opts.ttsVoice || 'svetlana' }),
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`таймаут веб-TTS (>${timeoutMs}мс)`)), timeoutMs)),
    ])
    if (!res.ok) return { error: `веб-TTS: HTTP ${res.status}` }
    const buf = new Uint8Array(await res.arrayBuffer())
    if (!buf.length) return { error: 'веб-TTS: пустое аудио' }
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return { audioB64: btoa(bin), mime: 'audio/mpeg', said }
  } catch (e) {
    return { error: 'tts-web: ' + String(e?.message || e).slice(0, 160) }
  }
}

/** Расшифровывает аудио (base64). Успех: { text, model }, неудача: { error, tried, lastError }.
 *  Бюджет ~25 с — уложиться в фон Telegram. */
export async function transcribeAudio(b64, mime = 'audio/ogg', opts = {}) {
  const tried = []
  const debug = opts.debug || null
  const deadline = Date.now() + 25000
  let lastError = ''
  const prompt = 'Это голосовое сообщение из Telegram (скорее всего на русском). Расшифруй аудио. Верни ТОЛЬКО текст расшифровки, без комментариев, без кавычек и без форматирования.'

  // 0) Cloudflare Workers AI (whisper): биндинг env.AI — без ключей и без лимитов
  //    сторонних API, аудио не хранится (zero data retention). b64 уже готов от
  //    tgFileB64; по официальному туториалу CF аудио уходит base64-строкой.
  //    Ответ: { text, word_count, words[], vtt }.
  const ai = opts.aiBinding
  if (ai?.run && Date.now() < deadline) {
    tried.push('workers-ai whisper-turbo')
    try {
      // @cf/openai/whisper-large-v3-turbo: схема turbo — { audio: b64-строка }
      // (anyOf: string | {body,contentType}), b64 уже готов от tgFileB64, без
      // конверсий. language: 'ru' — бот русскоязычный, подсказка спасает от
      // ложного языка (синтетический espeak-сэмпл без подсказки слышался как
      // польский). Биндинг не принимает AbortSignal и на free-тарифе бывает
      // заядренен очередью: гонка с таймером — ответ бота не может зависнуть.
      const aiTimeoutMs = opts.aiTimeoutMs || 15000
      const out = await Promise.race([
        ai.run('@cf/openai/whisper-large-v3-turbo', { audio: b64, language: 'ru', task: 'transcribe' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`таймаут биндинга (>${aiTimeoutMs}мс)`)), aiTimeoutMs)),
      ])
      const text = String(out?.text || '').trim()
      if (text) {
        debug?.push({ brain: 'workers-ai', model: '@cf/openai/whisper-large-v3-turbo', ok: true })
        return { text, model: 'workers-ai whisper-large-v3-turbo' }
      }
      lastError = 'workers-ai: пустой ответ'
      debug?.push({ brain: 'workers-ai', ok: false, why: 'пустой ответ' })
    } catch (e) {
      const why = String(e?.message || e).slice(0, 160)
      lastError = 'workers-ai: ' + why
      debug?.push({ brain: 'workers-ai', ok: false, why: 'биндинг: ' + why })
    }
  }

  // 1) Gemini native — прямой audio/ogg через inlineData
  const geminiKey = opts.geminiKey || ''
  const bridgeMode = Boolean(opts.geminiBaseUrl)
  if (geminiKey && (bridgeMode || !/^sk-/.test(geminiKey)) && Date.now() < deadline) {
    const base = (opts.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')
    const models = [...new Set([opts.geminiModel || 'gemini-3.6-flash', ...GEMINI_FALLBACKS])]
    for (const model of models) {
      tried.push(`gemini ${model}`)
      try {
        const res = await fetch(`${base}/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [
              { text: prompt },
              { inlineData: { mimeType: mime || 'audio/ogg', data: b64 } },
            ] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
          }),
          signal: AbortSignal.timeout(20000),
        })
        if (res.ok) {
          const raw = (await res.json())?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim()
          const text = stripToolCallMarkup(raw)
          if (text) {
            debug?.push({ brain: 'gemini', model, ok: true })
            return { text, model }
          }
          debug?.push({ brain: 'gemini', model, ok: false, why: 'пустой ответ' })
        } else {
          const err = await res.text().catch(() => '')
          lastError = `HTTP ${res.status}: ${err.slice(0, 200)}`
          debug?.push({ brain: 'gemini', model, ok: false, why: `HTTP ${res.status}` })
          if (res.status === 404) break // модель устарела — идём дальше по цепочке мозгов
        }
      } catch (e) {
        lastError = String(e?.message || e)
        debug?.push({ brain: 'gemini', model, ok: false, why: 'сеть/таймаут' })
      }
    }
  }

  // 2) Coarena: OpenAI-формат input_audio (в data — чистый base64, без префикса)
  const coarenaKey = opts.coarenaKey || ''
  if (coarenaKey && Date.now() < deadline) {
    const models = [...new Set([
      opts.coarenaModel || 'deepseek-v4-1-flash-1017',
      'gemini-3-8-flash', // аудио возьмут только мультимодальные — текстовые модели пропускаем смысла нет, но арена сама отфутболит
      'gpt-6-2-astra',
      ...COARENA_CHAIN,
    ])]
    for (const model of models) {
      if (Date.now() > deadline) break
      tried.push(`coarena ${model}`)
      try {
        const res = await fetch(`${COARENA_BASE}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${coarenaKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'input_audio', input_audio: { data: b64, format: audioFormat(mime) } },
            ] }],
            temperature: 0.1,
            max_tokens: 512,
          }),
          signal: AbortSignal.timeout(20000),
        })
        if (res.ok) {
          const raw = (await res.json())?.choices?.[0]?.message?.content?.trim()
          const text = stripToolCallMarkup(raw)
          if (text) {
            debug?.push({ brain: 'coarena', model, ok: true })
            return { text, model }
          }
          debug?.push({ brain: 'coarena', model, ok: false, why: 'пустой ответ' })
        } else {
          const err = await res.text().catch(() => '')
          lastError = `HTTP ${res.status}: ${err.slice(0, 200)}`
          debug?.push({ brain: 'coarena', model, ok: false, why: `HTTP ${res.status}` })
        }
      } catch (e) {
        lastError = String(e?.message || e)
        debug?.push({ brain: 'coarena', model, ok: false, why: 'сеть/таймаут' })
      }
    }
  }

  // 3) OpenRouter: бесплатная omni-модель с audio-входом
  const openrouterKey = opts.openrouterKey || ''
  if (openrouterKey && Date.now() < deadline) {
    for (const model of AUDIO_OPENROUTER) {
      tried.push(`openrouter ${model}`)
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${openrouterKey}`, 'Content-Type': 'application/json', 'X-Title': 'Daria Telegram Bot' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'input_audio', input_audio: { data: b64, format: audioFormat(mime) } },
            ] }],
            temperature: 0.1,
            max_tokens: 512,
          }),
          signal: AbortSignal.timeout(20000),
        })
        if (res.ok) {
          const raw = (await res.json())?.choices?.[0]?.message?.content?.trim()
          const text = stripToolCallMarkup(raw)
          if (text) {
            debug?.push({ brain: 'openrouter', model, ok: true })
            return { text, model }
          }
          debug?.push({ brain: 'openrouter', model, ok: false, why: 'пустой ответ' })
        } else {
          const err = await res.text().catch(() => '')
          lastError = `HTTP ${res.status}: ${err.slice(0, 200)}`
          debug?.push({ brain: 'openrouter', model, ok: false, why: `HTTP ${res.status}` })
        }
      } catch (e) {
        lastError = String(e?.message || e)
        debug?.push({ brain: 'openrouter', model, ok: false, why: 'сеть/таймаут' })
      }
    }
  }

  return { error: 'ни один мозг не расслышал', tried, lastError }
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

// ── LLM: Coarena (главный) → Gemini (мост) → OpenRouter (запасной) ──────
// Живая цепочка бесплатных моделей (проверено по каталогу OpenRouter 2026-11-02):
// poolside/laguna-s-2.1:free умерла (404 мгновенно), dots-3-note-preview выброшена —
// она же источник сырых <dots_function_call> в чате
export const OPENROUTER_CHAIN = [
  'google/gemma-4-31b-it:free',
  'recursive/flint-v1.0:free',
  'google/gemma-4-26b-a4b-it:free',
]
/** Цепочка имён Gemini: основная → алиасы (несуществующее имя даёт быстрый 404 — идём дальше).
 *  gemini-3.6-flash и gemini-3.5-flash-lite — имена моделей моста gemini-web2api (есть и в официальном API) */
const GEMINI_FALLBACKS = ['gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash']

// ── Coarena: главный мозг (coarena.ai, OpenAI-совместимый API) ───────────
// Один ключ арены открывает все модели (Claude, GPT, Gemini, Grok…). API
// OpenAI-совместимый: POST /v1/chat/completions с Authorization: Bearer.
// 402 = модель не входит в бесплатный набор ключа → пробуем следующую модель;
// 429 = лимит арены → отдаём ход запасным провайдерам.
const COARENA_BASE = 'https://coarena.ai/api/v1'
/** Цепочка моделей Coarena — бесплатный набор free-аккаунта (проверено в проде
 *  2026-11-18: ответ 402 перечисляет именно их). Дефолт и первая модель —
 *  DeepSeek V4.1 Flash 1017 (выбор владельца); при пополнении баланса секрет
 *  COARENA_MODEL открывает любую модель (claude-fable-5, gpt-6-2-astra,
 *  gemini-4-argon…). */
export const COARENA_CHAIN = ['gemini-3-8-flash', 'gpt-6-luna']

// Предохранитель Coarena — как у Gemini: заболела арена → 3 минуты сразу
// запасные провайдеры (состояние живёт в изоляте воркера, защита best effort).
const coarenaBreaker = { fails: 0, skipUntil: 0 }
const COARENA_BREAKER_AFTER = 2
const COARENA_BREAKER_COOLDOWN_MS = 3 * 60 * 1000

/** Сброс предохранителя Coarena — для тестов (test-brain.mjs). */
export function resetCoarenaBreaker() {
  coarenaBreaker.fails = 0
  coarenaBreaker.skipUntil = 0
}

// ── Предохранитель Gemini ────────────────────────────────────────────────
// Зависший/больной мост не должен съедать 20 секунд на КАЖДОМ сообщении:
// после двух подряд полных провалов Gemini три минуты отвечаем сразу через
// OpenRouter. Состояние живёт в изоляте воркера — защита мягкая, best effort.
const geminiBreaker = { fails: 0, skipUntil: 0 }
const GEMINI_BREAKER_AFTER = 2
const GEMINI_BREAKER_COOLDOWN_MS = 3 * 60 * 1000

/** Сброс предохранителя — для тестов (test-brain.mjs). */
export function resetGeminiBreaker() {
  geminiBreaker.fails = 0
  geminiBreaker.skipUntil = 0
}

/**
 * history: [{role: 'user'|'assistant', content: string}] — последние ходы,
 * последняя запись — текущая реплика пользователя.
 * opts.webContext — блок с результатами веб-поиска (см. formatSearchContext).
 * Возвращает текст ответа или null, если ни один провайдер не ответил.
 */
/** Бесплатные vision-модели OpenRouter (живой список API, 2026-11): с фото
 *  идём к ним, если базовая модель арены картинку не взяла. */
export const VISION_OPENROUTER = ['google/gemma-4-31b-it:free', 'nvidia/nemotron-3.5-super-vl:free']

/** OpenAI-мультимодальный формат: последняя реплика пользователя превращается
 *  в массив [текст + картинка data-URL]. Без фото — сообщения как были. */
export function withImageParts(messages, photo) {
  if (!photo?.b64) return messages
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user')
  if (lastUserIdx < 0) return messages
  return messages.map((m, i) => (i === lastUserIdx ? {
    role: 'user',
    content: [
      { type: 'text', text: m.content },
      { type: 'image_url', image_url: { url: `data:${photo.mime || 'image/jpeg'};base64,${photo.b64}` } },
    ],
  } : m))
}

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
  // Свежий контекст группы (v0.3.28): реплики участников «между собой» как фон.
  // Клеим в system, а не в history — история диалога не засоряется болтовней.
  const chatter = (opts.groupChatter || '').trim()
  if (chatter) system += `\n\n${chatter}`

  // Coarena — главный мозг: один ключ открывает все модели арены (Claude, GPT,
  // Gemini, Grok…). API OpenAI-совместимый: POST /v1/chat/completions с
  // Authorization: Bearer. 402 = модель не входит в бесплатный набор ключа →
  // пробуем следующую модель цепочки; 429 = лимит арены → отдаём ход запасным.
  const coarenaKey = opts.coarenaKey || ''
  if (coarenaKey && Date.now() >= coarenaBreaker.skipUntil) {
    const models = [...new Set([opts.coarenaModel || 'deepseek-v4-1-flash-1017', ...COARENA_CHAIN])]
    for (const model of models) {
      try {
        const res = await fetch(`${COARENA_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${coarenaKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            // фото (v0.3.24): OpenAI-мультимодальный формат — картинка в data-URL
            messages: [{ role: 'system', content: system }, ...withImageParts(history, opts.photo)],
            temperature: 0.9,
            // 500 → 1024 (v0.3.21): ответ обрывался на ~500 токенах; длинные
            // куски дальше доотправляет разбивка sendMessage (лимит 4096)
            max_tokens: 1024,
          }),
          // 20 с на модель: арена не должна съесть весь 30-секундный фон Telegram
          signal: AbortSignal.timeout(20000),
        })
        if (res.ok) {
          const data = await res.json()
          const raw = data?.choices?.[0]?.message?.content?.trim()
          const text = stripToolCallMarkup(raw)
          if (text) {
            opts.debug?.push({ brain: 'coarena', model, ok: true })
            coarenaBreaker.fails = 0 // успех — сбрасываем счётчик провалов
            return text
          }
          opts.debug?.push({ brain: 'coarena', model, ok: false, why: 'пустой ответ' })
          console.error(`[coarena] ${model}: пустой ответ после зачистки`)
        } else {
          const err = await res.text().catch(() => '')
          opts.debug?.push({ brain: 'coarena', model, ok: false, why: `HTTP ${res.status}` })
          console.error(`[coarena] ${model}: HTTP ${res.status} ${err.slice(0, 200)}`)
        }
      } catch (e) {
        opts.debug?.push({ brain: 'coarena', model, ok: false, why: 'сеть/таймаут' })
        console.error(`[coarena] ${model}: ${e?.message || e}`)
      }
    }
    // Дошли до конца цикла — ни одна модель не ответила, учитываем провал.
    // Фото — исключение (v0.3.24): модели арены могут просто не уметь vision,
    // это не значит, что текстовый мозг умер, — «автомат» не включаем.
    if (!opts.photo) coarenaBreaker.fails += 1
    if (coarenaBreaker.fails >= COARENA_BREAKER_AFTER) {
      console.error(
        `[coarena] ${COARENA_BREAKER_AFTER} провала подряд — ${COARENA_BREAKER_COOLDOWN_MS / 1000} с отвечаем через запасных`,
      )
      coarenaBreaker.fails = 0
      coarenaBreaker.skipUntil = Date.now() + COARENA_BREAKER_COOLDOWN_MS
    }
  }

  // Gemini — запасной мозг №1 (когда Coarena не задан или упал): заметно
  // умнее бесплатных моделей OpenRouter и не страдает ложными вызовами
  // инструментов. Перебираем имена моделей: если конкретное устарело
  // (HTTP 404), пробуем следующее из цепочки.
  //
  // Ключ sk-gemini-… — это ключ моста gemini-web2api: напрямую в Google он НЕ
  // работает. Если GEMINI_BASE_URL не задан (мост ещё не подключён), не долбим
  // Google заведомо отказными запросами — сразу отвечаем через OpenRouter.
  const bridgeMode = Boolean(opts.geminiBaseUrl)
  const bridgeKey = /^sk-/.test(geminiKey)
  if (geminiKey && (bridgeMode || !bridgeKey) && Date.now() >= geminiBreaker.skipUntil) {
    const base = (opts.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')
    const lastUserIdx = history.map((m) => m.role).lastIndexOf('user')
    const models = [...new Set([opts.geminiModel || 'gemini-3.6-flash', ...GEMINI_FALLBACKS])]
    for (const model of models) {
      try {
        const res = await fetch(
          `${base}/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: history.map((m, i) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                // фото (v0.3.24): inlineData в последней реплике пользователя
                parts: opts.photo?.b64 && i === lastUserIdx && m.role === 'user'
                  ? [{ text: m.content }, { inlineData: { mimeType: opts.photo.mime || 'image/jpeg', data: opts.photo.b64 } }]
                  : [{ text: m.content }],
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
          if (text) {
            opts.debug?.push({ brain: 'gemini', model, ok: true })
            geminiBreaker.fails = 0 // успех — сбрасываем счётчик провалов
            return text
          }
          opts.debug?.push({ brain: 'gemini', model, ok: false, why: 'пустой ответ' })
          console.error(`[gemini] ${model}: пустой ответ после зачистки`)
        } else {
          const err = await res.text().catch(() => '')
          opts.debug?.push({ brain: 'gemini', model, ok: false, why: `HTTP ${res.status}` })
          console.error(`[gemini] ${model}: HTTP ${res.status} ${err.slice(0, 200)}`)
        }
      } catch (e) {
        opts.debug?.push({ brain: 'gemini', model, ok: false, why: 'сеть/таймаут' })
        console.error(`[gemini] ${model}: ${e?.message || e}`)
      }
    }
    // Провал учитываем только для текста: фото могли не увидеть (нет vision),
    // а текстовый мозг при этом здоров
    if (!opts.photo) geminiBreaker.fails += 1
    if (geminiBreaker.fails >= GEMINI_BREAKER_AFTER) {
      console.error(
        `[gemini] ${GEMINI_BREAKER_AFTER} провала подряд — ${GEMINI_BREAKER_COOLDOWN_MS / 1000} с отвечаем только через OpenRouter`,
      )
      geminiBreaker.fails = 0
      geminiBreaker.skipUntil = Date.now() + GEMINI_BREAKER_COOLDOWN_MS
    }
  }

  // OpenRouter — запасной мозг (бесплатные модели, бывают капризными).
  // С фото (v0.3.24) базовая модель может не принимать картинки — после неё
  // перебираем бесплатные vision-модели (живой список API, 2026-11).
  if (openrouterKey) {
    const models = opts.photo?.b64
      ? [...new Set([primary, ...VISION_OPENROUTER])]
      : [primary, ...OPENROUTER_CHAIN.filter((m) => m !== primary)]
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
          messages: [{ role: 'system', content: system }, ...withImageParts(history, opts.photo)],
          temperature: 0.9,
          // 1024 (v0.3.21): с 500 ответ запасного мозга обрывался на полуслове
          max_tokens: 1024,
        }),
        signal: AbortSignal.timeout(25000),
      })
      if (res.ok) {
        const data = await res.json()
        const raw = data?.choices?.[0]?.message?.content?.trim()
        // Модель могла «вызвать» поиск сырым тегом — зачищаем; пусто после зачистки → без ответа
        const text = stripToolCallMarkup(raw)
        if (text) {
          opts.debug?.push({ brain: 'openrouter', model: data?.model || '', ok: true })
          return text
        }
        opts.debug?.push({ brain: 'openrouter', model: data?.model || '', ok: false, why: 'пустой ответ' })
      } else {
        opts.debug?.push({ brain: 'openrouter', model: '', ok: false, why: `HTTP ${res.status}` })
        console.error(`[openrouter] HTTP ${res.status}`)
      }
    } catch { /* оба провайдера недоступны */ }
  }

  return null
}
