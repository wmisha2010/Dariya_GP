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
 *  - всё остальное → LLM (OpenRouter → Gemini, те же модели, что в вебе);
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
  'Вопрос приняла, но мой ИИ-мозг ещё не подключен 😅 Пусть хозяин добавит ключ OPENROUTER_API_KEY в настройках воркера — и я заговорю по-настоящему.',
  'Хотела ответить умно, но ключ ИИ не задан 😄 Намекни моему хозяину: OPENROUTER_API_KEY в секретах воркера.',
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
const SEARCH_VERBS_RE = /(погугли|загугли|поищи|поищ|поиск\s+в\s+интернете|найди\s+(в\s+интернете|в\s+сети)|посмотри\s+в\s+интернете)/i

/** Темы, где без свежих данных нечего делать */
const SEARCH_HINTS_RE = /погода|новост|курс [а-яё]|курс\b.*(доллар|евро|рубл|биткоин|юан)|доллар.*(подорожал|подешевел|курс)|биткоин|эфириум|крипт|кто победил|сч[её]т матча|счет матча|итог(ы)? матча|сколько (стоит|стоят)|стоимость|цена|цены на|дата выхода|когда выйдет|когда вышл[ао]|последн(ие|яя) (новост|серия|сезон|версия|релиз|обновлени)|свеж(ие|ая) новост|тренд|расписание|премьер[аы]|кто такой|кто такая/i

/** Нужен ли веб-поиск для этой фразы */
export function needsWebSearch(text) {
  const t = (text || '').toLowerCase()
  if (!t) return false
  return SEARCH_VERBS_RE.test(t) || SEARCH_HINTS_RE.test(t)
}

/** Из команды убираем поисковые глаголы — остальное уходит в DuckDuckGo */
export function buildSearchQuery(command) {
  let q = (command || '')
    .replace(/^(погугли|загугли|поищи|поищ|найди|посмотри)\s*(в\s*интернете|в\s*сети)?\s*[,!.?]*\s*/i, '')
    .replace(/^(в\s+интернете|в\s+сети)\s*/i, '')
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
    const title = stripTags(a[2])
    if (!title) continue
    const p = body.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    out.push({ title, url: a[1], snippet: stripTags(p?.[1] || '') })
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
  const headers = {
    'User-Agent': SEARCH_UA,
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
  }
  const tasks = SEARCH_ENGINES.map(([name, engine]) => (async () => {
    const { url, parse } = engine(q)
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) })
    if (!res.ok) throw new Error('status ' + res.status)
    const results = parse(await res.text(), max)
    if (!results.length) throw new Error('пусто')
    return results.map((r) => ({ ...r, engine: name })) // метка победителя для диагностики
  }))
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
    `[Результаты веб-поиска по запросу «${query}» — только что из интернета]`,
    ...lines,
    'Опирайся на эти данные в ответе; можешь упомянуть, что только что погуглила. Если данных мало — скажи честно.',
  ].join('\n')
}

const YOUTUBE_LINK_RE = /(https?:\/\/)?(www\.)?(youtube\.com\/\S+|youtu\.be\/\S+)/i

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
  if (/который час|сколько времени|время сейчас|какое сейчас время/.test(c))
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
  'Если приложен блок [Результаты веб-поиска] — опирайся на эти данные и можешь похвастаться, что только что погуглила.',
  'Если такого блока нет, а спрашивают про «прямо сейчас» — честно скажи, что в сеть не заглядывала, и предложи: «попроси — погуглю».',
  'Если просят помощь по музыке: у тебя нет плеера в Telegram, радио и музыка живут в твоей веб-версии.',
].join(' ')

// ── LLM: OpenRouter → Gemini (те же модели, что в веб-версии) ────────────
const OPENROUTER_FALLBACKS = ['recursive/flint-v1.0:free', 'dots-studio/dots-3-note-preview:free']

/**
 * history: [{role: 'user'|'assistant', content: string}] — последние ходы,
 * последняя запись — текущая реплика пользователя.
 * opts.webContext — блок с результатами веб-поиска (см. formatSearchContext).
 * Возвращает текст ответа или null, если ни один провайдер не ответил.
 */
export async function askLLM(history, opts = {}) {
  const openrouterKey = opts.openrouterKey || ''
  const geminiKey = opts.geminiKey || ''
  const primary = opts.openrouterModel || 'poolside/laguna-s-2.1:free'
  const webContext = opts.webContext || ''
  const system = webContext ? `${SYSTEM_PROMPT}\n\n${webContext}` : SYSTEM_PROMPT

  if (openrouterKey) {
    const models = [primary, ...OPENROUTER_FALLBACKS.filter((m) => m !== primary)]
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
      })
      if (res.ok) {
        const data = await res.json()
        const text = data?.choices?.[0]?.message?.content?.trim()
        if (text) return text
      }
    } catch { /* падаем на Gemini */ }
  }

  if (geminiKey) {
    const base = (opts.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')
    const model = opts.geminiModel || 'gemini-3.8-flash'
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
            generationConfig: { temperature: 0.9, maxOutputTokens: 500 },
          }),
        },
      )
      if (res.ok) {
        const data = await res.json()
        const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim()
        if (text) return text
      }
    } catch { /* оба провайдера недоступны */ }
  }

  return null
}
