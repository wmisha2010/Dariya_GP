/**
 * Дария в Telegram — Cloudflare Worker (webhook).
 *
 * Маршруты:
 *   GET  /                      — статус-страница (жив ли воркер и webhook);
 *   GET  /setup?bot_token=...   — регистрация webhook у Telegram (одноразово);
 *   GET  /search-test?q=...     — диагностика веб-поиска;
 *   GET  /llm-test[&text=...]   — диагностика «мозга»: ключи Coarena/Gemini, регион выхода, живой ответ;
 *   POST /telegram-webhook      — приём апдейтов от Telegram.
 *
 * Секреты (Dashboard → Worker → Settings → Variables and Secrets):
 *   TELEGRAM_BOT_TOKEN — токен от @BotFather (обязателен);
 *   COARENA_API_KEY — главный мозг (coarena.ai), GEMINI_API_KEY — через мост,
 *   OPENROUTER_API_KEY — запасной (все три опциональны);
 *   WEB_APP_URL — ссылка на веб-версию с плеером (по умолчанию — превью-песочница).
 */

import {
  extractCommand,
  resolveCommand,
  askLLM,
  NO_BRAIN,
  NO_PAINT,
  OPENROUTER_CHAIN,
  webSearch,
  formatSearchContext,
  buildSearchQuery,
  fixFalseGoogled,
  withCityContext,
  splitTelegramMessage,
  extractImageIntent,
  geminiImage,
  transcribeAudio,
  speakText,
  readPagesContext,
  readPage,
} from './brain.js'

/** Cloudflare Workers AI: биндинг [ai] в wrangler.toml — whisper без ключей (v0.3.29) */
interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>
}

export interface Env {
  TELEGRAM_BOT_TOKEN: string
  COARENA_API_KEY?: string
  COARENA_MODEL?: string
  OPENROUTER_API_KEY?: string
  OPENROUTER_MODEL?: string
  GEMINI_API_KEY?: string
  GEMINI_BASE_URL?: string
  GEMINI_MODEL?: string
  AI?: AiBinding
  TIMEZONE?: string
  WEB_APP_URL?: string
  WEB_SEARCH?: string
  WEB_PAGE_READ?: string
  GROUP_CHATTER?: string
  SEARCH_TEST_KEY?: string
}

const TG_API = 'https://api.telegram.org'
const DEFAULT_WEB_APP_URL = 'https://preview-chat-d8e654d4-40f5-415b-a16a-09dbc10c3f5d.space-z.ai/'
const VERSION = 'v0.3.35 (brain v3.7)'

/** Контекст диалогов — живёт, пока жив изолят воркера (best-effort, без БД) */
const chatHistory = new Map<number, Array<{ role: 'user' | 'assistant'; content: string }>>()
const HISTORY_MAX_TURNS = 8

/** Свежий контекст группы (v0.3.28): реплики участников «между собой» как фон.
 *  Буфер на каждую группу, ≤15 реплик, живут 10 минут — фон разговора,
 *  НЕ долговременная память; с privacy mode бота в BotFather не наполнится
 *  (Telegram не присылает нерелевантные сообщения, флаг inert, но безвреден). */
const GROUP_CHATTER_MAX = 15
const GROUP_CHATTER_TTL_MS = 10 * 60 * 1000
const groupChatter = new Map<number, Array<{ who: string; text: string; t: number }>>()

/** Записать реплику группы (только не адресованные боту сообщения; ботов и команды долой) */
function recordGroupChatter(chatId: number, msg: any, on: boolean): void {
  if (!on) return
  const text = String(msg?.text || '').trim()
  const from = msg?.from
  if (!text || !from || from.is_bot || text.startsWith('/')) return
  const buf = groupChatter.get(chatId) || []
  const who = String(from.first_name || from.username || 'кто-то').trim().slice(0, 24) || 'кто-то'
  buf.push({ who, text: text.slice(0, 200), t: Date.now() })
  while (buf.length > GROUP_CHATTER_MAX) buf.shift()
  groupChatter.set(chatId, buf)
  if (groupChatter.size > 50) {
    // чатов стало слишком много — выкидываем самые старые буферы целиком
    const oldest = [...groupChatter.entries()]
      .sort((a, b) => (a[1][0]?.t || 0) - (b[1][0]?.t || 0))
      .slice(0, groupChatter.size - 50)
    for (const [id] of oldest) groupChatter.delete(id)
  }
}

/** Блок «свежий контекст группы» для промпта; протухшее подчистим. '' если тишина. */
function buildGroupContext(chatId: number, on: boolean): string {
  if (!on) return ''
  const fresh = (groupChatter.get(chatId) || []).filter((m) => Date.now() - m.t < GROUP_CHATTER_TTL_MS)
  if (fresh.length) groupChatter.set(chatId, fresh)
  else groupChatter.delete(chatId)
  if (!fresh.length) return ''
  return [
    '[Свежий контекст группы — реплики участников за последние минуты, говорили между собой, не с тобой; используй как фон, если он помогает ответу]',
    ...fresh.map((m) => `${m.who}: ${m.text}`),
  ].join('\n')
}

/** Дедупликация апдейтов: Telegram дёргает вебхук повторно, если мы долго отвечаем */
const processedUpdates = new Set<number>()

let cachedBotId: number | null = null

// ── Вспомогательные ──────────────────────────────────────────────────────

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function tgCall(token: string, method: string, payload?: unknown): Promise<any> {
  const res = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  })
  return res.json()
}

async function getBotId(token: string): Promise<number | null> {
  if (cachedBotId) return cachedBotId
  try {
    const data = await tgCall(token, 'getMe')
    if (data?.ok) {
      cachedBotId = data.result.id as number
      return cachedBotId
    }
  } catch { /* getMe недоступен */ }
  return null
}

async function sendMessage(token: string, chatId: number, text: string, replyTo?: number) {
  // v0.3.21: Telegram берёт максимум 4096 символов на сообщение и отклоняет
  // длинный текст ЦЕЛИКОМ — режем на части и отправляем по порядку
  const chunks = splitTelegramMessage(text)
  if (!chunks.length) return null
  let last: unknown = null
  for (let i = 0; i < chunks.length; i++) {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: chunks[i],
      disable_web_page_preview: false,
    }
    if (replyTo && i === 0) payload.reply_to_message_id = replyTo
    last = await tgCall(token, 'sendMessage', payload)
  }
  return last
}

/** Индикатор «печатает…» (v0.3.34): Telegram показывает статус ~5с после каждого
 *  sendChatAction — цикл шлёт его каждые 4.5с, пока бот думает (голос/поиск/LLM).
 *  Ошибки игнорируем: индикатор не критичен для ответа. */
async function chatActionLoop(token: string, chatId: number, action: { current: string }, isOn: () => boolean): Promise<void> {
  while (isOn()) {
    try { await tgCall(token, 'sendChatAction', { chat_id: chatId, action: action.current }) } catch { /* индикатор не критичен */ }
    await new Promise((r) => setTimeout(r, 4500))
  }
}

/** Картинка в Telegram: sendPhoto принимает multipart-загрузку, не URL/ID */
async function sendPhoto(token: string, chatId: number, b64: string, mime: string, caption: string, replyTo?: number) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const form = new FormData()
  form.append('chat_id', String(chatId))
  if (caption) form.append('caption', caption.slice(0, 1024)) // лимит подписи в ТГ
  if (replyTo) form.append('reply_to_message_id', String(replyTo))
  form.append('photo', new Blob([bytes], { type: mime }), 'daria.png')
  return fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form })
}

/** Голосовое в Telegram (v0.3.35): sendVoice хочет OGG/Opus — aura-1 отдаёт ровно
 *  его; multipart-загрузка как у sendPhoto (v0.3.22). */
async function sendVoice(token: string, chatId: number, b64: string, replyTo?: number) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const form = new FormData()
  form.append('chat_id', String(chatId))
  if (replyTo) form.append('reply_to_message_id', String(replyTo))
  form.append('voice', new Blob([bytes], { type: 'audio/ogg' }), 'daria.ogg')
  return fetch(`https://api.telegram.org/bot${token}/sendVoice`, { method: 'POST', body: form })
}

/** Файл Telegram (фото/голос) → {b64, mime}: getFile даёт file_path, файл
 *  качаем с file-сервера и кодируем по частям (спред ≤0x8000 не рвёт стек). */
async function tgFileB64(token: string, fileId: string, mime: string): Promise<{ b64: string; mime: string } | null> {
  try {
    const meta = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
      { signal: AbortSignal.timeout(10000) },
    )
    const file: any = await meta.json()
    const path = file?.result?.file_path
    if (!path) return null
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    }
    return { b64: btoa(bin), mime }
  } catch (e) {
    console.error('[tgfile] не удалось скачать:', e)
    return null
  }
}

/** Фото из Telegram → base64 (последний элемент sizes — самый крупный размер) */
async function photoToB64(token: string, sizes: any[]): Promise<{ b64: string; mime: string } | null> {
  const best = sizes[sizes.length - 1]
  return tgFileB64(token, best.file_id, 'image/jpeg') // фото Telegram всегда отдаёт JPEG
}

// ── Обработка апдейта ────────────────────────────────────────────────────

async function handleMessage(msg: any, env: Env): Promise<void> {
  // Фото (v0.3.24) и голосовые (v0.3.25): msg.text может отсутствовать
  const isPhoto = Array.isArray(msg?.photo) && msg.photo.length > 0
  const isVoice = !!msg?.voice
  const text: string = (msg?.text || msg?.caption || '').trim()
  if (!text && !isPhoto && !isVoice) return

  const isPrivate = msg.chat?.type === 'private'
  const chatId: number = msg.chat?.id
  const token = env.TELEGRAM_BOT_TOKEN
  const chatterOn = (env.GROUP_CHATTER || '') !== 'off'

  // Вырезаем @упоминание бота — остаётся «команда»
  const withoutMention = text.replace(/@\w+/g, ' ')

  // Обращение: в личке — всегда; в группе — имя Дарии, @бот или ответ на её сообщение
  let command = ''
  if (isPrivate) {
    command = withoutMention.trim()
  } else {
    const { found, command: cmd } = extractCommand(withoutMention)
    const replyToBot = !!cachedBotId && msg.reply_to_message?.from?.id === cachedBotId
    if (found) command = cmd
    else if (replyToBot) command = withoutMention.trim()
    else {
      // не к нам обращение — но в группе это фон разговора: запоминаем как свежий контекст
      recordGroupChatter(chatId, msg, chatterOn)
      return
    }
  }
  // Индикатор «печатает…» (v0.3.34): горит с этого момента и до отправки ответа —
  // расшифровка голоса, поиск, чтение страниц, размышления LLM. При рисовании
  // переключается на «отправляет фото». Живёт в том же waitUntil, что и обработка.
  const action = { current: 'typing' }
  let typingOn = true
  void chatActionLoop(token, chatId, action, () => typingOn)
  // любая отправка ответа гасит индикатор — не надо помнить про каждый return
  const stopTyping = () => { typingOn = false }
  const sendMessageStopped: typeof sendMessage = async (t, c, body, replyTo) => { stopTyping(); return sendMessage(t, c, body, replyTo) }
  const sendPhotoStopped: typeof sendPhoto = async (t, c, b64, mime, cap, replyTo) => { stopTyping(); return sendPhoto(t, c, b64, mime, cap, replyTo) }

  // Зеркальный режим (v0.3.35): голосовое → голосовой ответ (aura-1 через биндинг
  // env.AI), честный откат на текст, если синтез не удался. Голос вошёл — статус
  // «записывает голосовое» вместо «печатает».
  const wantsVoice = isVoice
  const maybeVoiceReply = async (reply: string): Promise<boolean> => {
    if (!wantsVoice) return false
    action.current = 'record_voice'
    const t = await speakText(reply, { aiBinding: env.AI })
    if (!t.audioB64) return false
    stopTyping()
    await sendVoice(token, chatId, t.audioB64, isPrivate ? undefined : msg.message_id)
    return true
  }

  // Голое фото без подписи — дефолтный вопрос
  if (isPhoto && !command) command = 'Что на этом фото? Опиши подробно и живо.'

  // Голосовые (v0.3.25): расшифровываем → дальше это обычный текст-команда.
  // До быстрых ответов: голосом тоже можно сказать «погода» или «нарисуй кота».
  if (isVoice) {
    const audio = await tgFileB64(token, msg.voice.file_id, msg.voice.mime_type || 'audio/ogg')
    if (!audio) {
      await sendMessageStopped(token, chatId, 'Не смогла скачать голосовое — Telegram не отдал файл 🙈 Попробуй ещё раз!', isPrivate ? undefined : msg.message_id)
      return
    }
    const r = await transcribeAudio(audio.b64, audio.mime, {
      aiBinding: env.AI,
      coarenaKey: env.COARENA_API_KEY || '',
      openrouterKey: env.OPENROUTER_API_KEY || '',
      geminiKey: env.GEMINI_API_KEY || '',
      geminiBaseUrl: env.GEMINI_BASE_URL || '',
      geminiModel: env.GEMINI_MODEL || '',
    })
    if (!r.text) {
      await sendMessageStopped(token, chatId, 'Не расслышала голосовое 😅 Сервис расшифровки не ответил. Попробуй ещё раз — или напиши текстом!', isPrivate ? undefined : msg.message_id)
      return
    }
    // расшифровка — главное содержание; подпись (если была) идёт дополнением
    command = command ? `${r.text} ${command}` : r.text
  }

  const tz = env.TIMEZONE || 'Europe/Moscow'
  const webAppUrl = env.WEB_APP_URL || DEFAULT_WEB_APP_URL

  // 1) Быстрые ответы без ИИ
  const quick = resolveCommand(command, { tz, webAppUrl })
  if (quick.handled) {
    // «погода» голосом → голосом; синтез упал → обычный текст
    if (!(await maybeVoiceReply(quick.text))) await sendMessageStopped(token, chatId, quick.text, isPrivate ? undefined : msg.message_id)
    return
  }

  // История диалога (для веб-поиска, рисования и LLM)
  const history = chatHistory.get(chatId) ?? []

  // 1б) Рисование (v0.3.22): «нарисуй …» — это image-модель, не текстовый LLM.
  // Для ФОТО интент не проверяем: пришла картинка — её смотрим, а не рисуем.
  const imagePrompt = isPhoto ? null : extractImageIntent(command)
  if (imagePrompt) {
    action.current = 'upload_photo' // статус «отправляет фото» вместо «печатает»
    const r = await geminiImage(imagePrompt, {
      geminiKey: env.GEMINI_API_KEY || '',
      geminiBaseUrl: env.GEMINI_BASE_URL || '',
    })
    if (r.image) {
      await sendPhotoStopped(token, chatId, r.image.b64, r.image.mime, `🎨 ${imagePrompt}`, isPrivate ? undefined : msg.message_id)
      history.push({ role: 'user', content: text }, { role: 'assistant', content: `[нарисовала картинку: ${imagePrompt}]` })
      if (history.length > HISTORY_MAX_TURNS * 2) history.splice(0, history.length - HISTORY_MAX_TURNS * 2)
      chatHistory.set(chatId, history)
      return
    }
    // рисовалка недоступна — честно, без ложных обещаний
    await sendMessageStopped(token, chatId, NO_PAINT[Math.floor(Math.random() * NO_PAINT.length)], isPrivate ? undefined : msg.message_id)
    return
  }

  // 2) Свободные темы — через LLM (Coarena → Gemini → OpenRouter)
  // Фото (v0.3.24): getFile → скачать файл → base64; без подписи вопрос дефолтный
  let photo: { b64: string; mime: string } | null = null
  if (isPhoto) {
    photo = await photoToB64(token, msg.photo)
    if (!photo && !text) {
      await sendMessageStopped(token, chatId, 'Не смогла открыть картинку — Telegram не отдал файл 🙈 Попробуй ещё раз!', isPrivate ? undefined : msg.message_id)
      return
    }
  }
  const prevUserTexts = history.filter((h) => h.role === 'user').map((h) => h.content).slice(-4)
  history.push({ role: 'user', content: command }) // в контекст — итоговый вопрос (фото или подпись)
  while (history.length > HISTORY_MAX_TURNS * 2) history.shift()
  chatHistory.set(chatId, history)

  // 2а) Сначала интернет, потом ответ: поиск на КАЖДЫЙ вопрос (v0.3.19, не
  // только по ключевым словам — владелец попросил «хоть что спрошу — должна
  // посмотреть»). Модель сама игнорирует нерелевантные результаты (болтовня).
  // Погода без города («А погода?») — берём город из предыдущих реплик диалога.
  // Голое фото без подписи пропускаем поиск: «что на этом фото» — шум в выдаче.
  let webContext = ''
  if ((env.WEB_SEARCH || '') !== 'off' && !(isPhoto && !text)) {
    try {
      const seed = withCityContext(command, prevUserTexts)
      const results = await webSearch(buildSearchQuery(seed))
      webContext = formatSearchContext(results, command)
      // Чтение страниц целиком (v0.3.27): топ-2 результата из выдачи → текст
      // статьи в промпт. ≥2 результатов — точные источники (погода/курсы) идут
      // одним результатом и не читаются; страницы качаются параллельно (≤6 с).
      if ((env.WEB_PAGE_READ || '') !== 'off' && results.length >= 2) {
        try {
          const pages = await readPagesContext(results, { limit: 2 })
          if (pages) webContext = `${webContext}\n\n${pages}`
        } catch { /* страницы не читаются — отвечаем по сниппетам */ }
      }
    } catch { /* без поиска — ответим из знаний */ }
  }

  const llmText = await askLLM(history, {
    coarenaKey: env.COARENA_API_KEY || '',
    coarenaModel: env.COARENA_MODEL || '',
    openrouterKey: env.OPENROUTER_API_KEY || '',
    openrouterModel: env.OPENROUTER_MODEL || '',
    geminiKey: env.GEMINI_API_KEY || '',
    geminiBaseUrl: env.GEMINI_BASE_URL || '',
    geminiModel: env.GEMINI_MODEL || '',
    webContext,
    groupChatter: buildGroupContext(chatId, chatterOn),
    tz,
    photo: photo || undefined,
  })

  let reply: string
  if (llmText) {
    // Поиск не было — ложное «погуглила» заменяем честным «вспомнила»
    reply = webContext ? llmText : fixFalseGoogled(llmText)
    history.push({ role: 'assistant', content: reply })
  } else {
    reply = NO_BRAIN[Math.floor(Math.random() * NO_BRAIN.length)]
  }

  // голосовое вошло — голосовое выйдет; TTS не удался → обычный текст
  if (!(await maybeVoiceReply(reply))) await sendMessageStopped(token, chatId, reply, isPrivate ? undefined : msg.message_id)
}

// ── HTTP-маршруты ────────────────────────────────────────────────────────

async function handleStatus(env: Env): Promise<Response> {
  const token = env.TELEGRAM_BOT_TOKEN || ''
  let webhookInfo = ''
  if (token) {
    try {
      const info = await tgCall(token, 'getWebhookInfo')
      webhookInfo = info?.ok
        ? `<p>Webhook: <code>${info.result.url || 'не установлен'}</code></p>` +
          `<p>Ожидают доставки: ${info.result.pending_update_count ?? 0}</p>`
        : '<p>getWebhookInfo: ошибка (проверьте токен)</p>'
    } catch {
      webhookInfo = '<p>getWebhookInfo: недоступен</p>'
    }
  }
  // Строка «Мозг»: различаем состояния, чтобы хозяин видел, чего не хватает
  let brainLine: string
  if (env.COARENA_API_KEY) {
    const backups: string[] = []
    if (env.GEMINI_API_KEY) backups.push(/^sk-/.test(env.GEMINI_API_KEY) ? 'Gemini-мост' : 'Gemini')
    if (env.OPENROUTER_API_KEY) backups.push('OpenRouter')
    brainLine =
      `<p>Мозг: подключён ✅ <small>(Coarena — главный: ${env.COARENA_MODEL || 'deepseek-v4-1-flash-1017'}` +
      `${backups.length ? ' + запасные: ' + backups.join(', ') : ''})</small></p>`
  } else if (env.GEMINI_API_KEY) {
    const model = env.GEMINI_MODEL ? ': ' + env.GEMINI_MODEL : ''
    const spare = env.OPENROUTER_API_KEY ? ' + запасной OpenRouter' : ''
    const via = env.GEMINI_BASE_URL
      ? `через мост${model}${spare}`
      : /^sk-/.test(env.GEMINI_API_KEY)
        ? `ключ sk-gemini… ждёт мост — добавьте секрет GEMINI_BASE_URL (адрес туннеля), когда поднимешь gemini-web2api${spare}`
        : `напрямую${model}${spare}`
    brainLine = `<p>Мозг: подключён ✅ <small>(Gemini ${via})</small></p>`
  } else if (env.OPENROUTER_API_KEY) {
    brainLine = `<p>Мозг: подключён ✅ <small>(OpenRouter — основной мозг: ${env.OPENROUTER_MODEL || 'по умолчанию'})</small></p>`
  } else {
    brainLine = '<p>Мозг: НЕ подключён 😴 — добавьте секрет COARENA_API_KEY (или GEMINI_API_KEY / OPENROUTER_API_KEY)</p>'
  }
  return html([
    '<h1>Дария-бот жива 😏</h1>',
    `<p>Версия: ${VERSION}</p>`,
    token ? '<p>Токен: задан ✅</p>' : '<p>Токен: НЕ задан — добавьте секрет TELEGRAM_BOT_TOKEN</p>',
    brainLine,
    `<p>Веб-поиск: ${env.WEB_SEARCH === 'off' ? 'выключен 🚫' : 'включён 🌐 (на каждый вопрос; новости — Google News, погода/курсы/время — точные источники)'}</p>`,
    webhookInfo,
    '<p>Setup: <code>/setup?bot_token=ТОКЕН</code></p>',
  ].join(''))
}

async function handleSetup(url: URL, env: Env): Promise<Response> {
  const token = env.TELEGRAM_BOT_TOKEN || ''
  if (!token) {
    return html('<h1>Сначала секрет</h1><p>Добавьте секрет TELEGRAM_BOT_TOKEN в настройках воркера, потом повторите setup.</p>', 500)
  }
  const provided = url.searchParams.get('bot_token') || ''
  if (!provided) {
    return html('<h1>Setup</h1><p>Откройте: <code>/setup?bot_token=ВАШ_ТОКЕН_БОТА</code></p>')
  }
  if (provided !== token) {
    return html('<h1>403</h1><p>bot_token не совпадает с секретом воркера.</p>', 403)
  }

  const webhookUrl = `${url.origin}/telegram-webhook`
  const secretToken = await sha256Hex(`${token}:daria-webhook`)
  const result = await tgCall(token, 'setWebhook', {
    url: webhookUrl,
    secret_token: secretToken,
    allowed_updates: ['message'],
  })

  if (!result?.ok) {
    return html(`<h1>Ошибка setWebhook</h1><pre>${JSON.stringify(result, null, 2)}</pre>`, 500)
  }
  return html([
    '<h1>Webhook установлен ✅</h1>',
    `<p>Дария слушает: <code>${webhookUrl}</code></p>`,
    '<p>Добавьте бота в группу и напишите: <b>Дария, привет</b></p>',
  ].join(''))
}

async function handleSearchTest(url: URL, env: Env): Promise<Response> {
  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  if ((env.WEB_SEARCH || '') === 'off') return json({ ok: false, error: 'поиск выключен (WEB_SEARCH=off)' }, 409)
  const key = env.SEARCH_TEST_KEY || ''
  if (key && url.searchParams.get('key') !== key) return json({ ok: false, error: 'неверный key' }, 403)
  const q = (url.searchParams.get('q') || '').trim()
  if (!q) return json({ ok: false, error: 'укажите ?q=поисковый+запрос' }, 400)
  const t0 = Date.now()
  try {
    const results = await webSearch(q)
    const winner = results[0]?.engine || '—'
    return json({ ok: true, query: q, count: results.length, winner, ms: Date.now() - t0, results })
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e), ms: Date.now() - t0 }, 500)
  }
}

/** Диагностика чтения страниц: ?url=… → что Дария реально вырезает из сайта */
async function handleReadTest(url: URL, env: Env): Promise<Response> {
  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  const key = env.SEARCH_TEST_KEY || ''
  if (key && url.searchParams.get('key') !== key) return json({ ok: false, error: 'неверный key' }, 403)
  const target = (url.searchParams.get('url') || '').trim()
  if (!/^https?:\/\//i.test(target)) return json({ ok: false, error: 'укажите ?url=https://…' }, 400)
  const t0 = Date.now()
  const p: any = await readPage(target, { timeoutMs: 10000, maxChars: 6000 }).catch((e: any) => ({
    error: String(e?.message || e),
    url: target,
  }))
  if (p.error) return json({ ok: false, error: p.error, url: target, ms: Date.now() - t0 }, 502)
  return json({ ok: true, url: p.url, title: p.title, chars: p.text.length, preview: p.text.slice(0, 600), ms: Date.now() - t0 })
}

/** Диагностика биндинга Workers AI (v0.3.30): жив ли биндинг и что за ошибка у whisper.
 *  Три зонда: текстовая модель (биндинг вообще работает?), whisper с b64-строкой,
 *  whisper с сырыми байтами — по ответам видно, какой формат входа правильный. */
async function handleAiTest(url: URL, env: Env): Promise<Response> {
  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  const key = env.SEARCH_TEST_KEY || ''
  if (key && url.searchParams.get('key') !== key) return json({ ok: false, error: 'неверный key' }, 403)
  const ai = env.AI
  if (!ai?.run) return json({ ok: false, error: 'биндинг AI отсутствует (env.AI undefined)' })
  const out: any = { binding: 'есть' }
  const probe = url.searchParams.get('probe') || ''
  const run = async (name: string, fn: () => Promise<any>) => {
    if (probe && probe !== name) return
    const s = Date.now()
    try {
      const r = await fn()
      out[name] = { ok: true, ms: Date.now() - s, ...r }
    } catch (e: any) {
      out[name] = { ok: false, ms: Date.now() - s, error: String(e?.message || e).slice(0, 200) }
    }
  }
  await run('textModel', async () => {
    const r: any = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages: [{ role: 'user', content: 'Ответь одним словом: живой' }], max_tokens: 16 })
    return { sample: String(r?.response ?? '').slice(0, 80) }
  })
  await run('whisperTurbo', async () => {
    // @cf/openai/whisper-large-v3-turbo: { audio: b64-строка } + language: 'ru'
    const r: any = await Promise.race([
      ai.run('@cf/openai/whisper-large-v3-turbo', { audio: TEST_VOICE_B64, language: 'ru', task: 'transcribe' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('проба >45с')), 45000)),
    ])
    return { text: String(r?.text || '').slice(0, 120) }
  })
  return json(out)
}

/** Диагностика TTS (v0.3.35): aura-1 озвучивает фразу → whisper-turbo расшифровывает
 *  обратно (round-trip: видно, говорит ли она по-русски, «на слух» без ушей).
 *  ?phrase= — своя фраза (до 200 симв.), ?speaker= — голос (по умолч. luna),
 *  ?out=audio — отдать само аудио бинарём ( ogg/opus ). */
async function handleTtsTest(url: URL, env: Env): Promise<Response> {
  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  const key = env.SEARCH_TEST_KEY || ''
  if (key && url.searchParams.get('key') !== key) return json({ ok: false, error: 'неверный key' }, 403)
  const ai = env.AI
  if (!ai?.run) return json({ ok: false, error: 'биндинг AI отсутствует (env.AI undefined)' })
  const phrase = (url.searchParams.get('phrase') || 'Привет! Я Дария, и я научилась отвечать голосом.').slice(0, 200)
  const speaker = url.searchParams.get('speaker') || 'luna'
  const s = Date.now()
  const t = await speakText(phrase, { aiBinding: ai, ttsSpeaker: speaker })
  const ms = Date.now() - s
  if (t.error || !t.audioB64) return json({ ok: false, ms, phrase, speaker, error: t.error })
  let heard = ''
  try {
    const w: any = await Promise.race([
      ai.run('@cf/openai/whisper-large-v3-turbo', { audio: t.audioB64, language: 'ru', task: 'transcribe' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('whisper >30с')), 30000)),
    ])
    heard = String(w?.text || '').trim()
  } catch (e: any) {
    heard = 'whisper не смог: ' + String(e?.message || e).slice(0, 100)
  }
  const bytes = Uint8Array.from(atob(t.audioB64), (c) => c.charCodeAt(0))
  if (url.searchParams.get('out') === 'audio') {
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': 'audio/ogg',
        'x-tts-ms': String(ms),
        'x-tts-bytes': String(bytes.length),
        'x-tts-heard': encodeURIComponent(heard),
      },
    })
  }
  return json({ ok: true, ms, phrase, speaker, bytes: bytes.length, mime: t.mime, heard })
}

/** Диагностика «мозга»: откуда воркер ходит в сеть, жив ли ключ Gemini, тестовый ответ */
async function handleImageTest(url: URL, env: Env): Promise<Response> {
  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  const key = env.SEARCH_TEST_KEY || ''
  if (key && url.searchParams.get('key') !== key) return json({ ok: false, error: 'неверный key' }, 403)
  const prompt = (url.searchParams.get('q') || 'рыжий кот в художественном берете, цифровая живопись').trim()
  const t0 = Date.now()
  const r = await geminiImage(prompt, {
    geminiKey: env.GEMINI_API_KEY || '',
    geminiBaseUrl: env.GEMINI_BASE_URL || '',
  })
  if (!r.image) return json({ ok: false, error: r.error, tried: r.tried, lastError: r.lastError || '', ms: Date.now() - t0 }, 500)
  const bytes = Uint8Array.from(atob(r.image.b64), (c) => c.charCodeAt(0))
  const info = { ok: true, model: r.image.model, mime: r.image.mime, bytes: bytes.length, ms: Date.now() - t0 }
  if (url.searchParams.get('raw') === '1') {
    return new Response(bytes, { headers: { 'content-type': r.image.mime, 'x-image-model': r.image.model } })
  }
  const sendTo = Number(url.searchParams.get('send') || '')
  if (sendTo) {
    const sent = await sendPhoto(env.TELEGRAM_BOT_TOKEN, sendTo, r.image.b64, r.image.mime, `🎨 Тест v0.3.22: ${prompt}`)
    return json({ ...info, sentTo: sendTo, sent: sent.ok })
  }
  return json(info)
}

// Тестовая картинка для /vision-test: 64×64 красный квадрат PNG (сгенерирован PIL)
const TEST_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUElEQVR42u3PQREAAAQAMATRP5QwUni42xospzs+q3hOQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBA4N4CCJ0BmOb2hBcAAAAASUVORK5CYII='

/** Кто из мозгов реально видит картинки: askLLM с фото + debug-отчёт попыток */
async function handleVisionTest(url: URL, env: Env): Promise<Response> {
  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  const key = env.SEARCH_TEST_KEY || ''
  if (key && url.searchParams.get('key') !== key) return json({ ok: false, error: 'неверный key' }, 403)
  const question = (url.searchParams.get('q') || 'Какого цвета квадрат на картинке? Ответь одним словом.').trim()
  const attempts: any[] = []
  const t0 = Date.now()
  const reply = await askLLM(
    [{ role: 'user', content: question }],
    {
      coarenaKey: env.COARENA_API_KEY || '',
      coarenaModel: env.COARENA_MODEL || '',
      openrouterKey: env.OPENROUTER_API_KEY || '',
      openrouterModel: env.OPENROUTER_MODEL || '',
      geminiKey: env.GEMINI_API_KEY || '',
      geminiBaseUrl: env.GEMINI_BASE_URL || '',
      geminiModel: env.GEMINI_MODEL || '',
      photo: { b64: TEST_PNG_B64, mime: 'image/png' },
      debug: attempts,
    },
  )
  return json({ ok: !!reply, reply, attempts, ms: Date.now() - t0 })
}

// Тестовый сэмпл речи для /voice-test: espeak-ng «Привет Дария, какая завтра
// погода?» → OGG/Opus 24k (base64 вшивается скриптом scripts/inject-voice-sample.py)
const TEST_VOICE_B64 = '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'

/** Кто из мозгов реально расшифровывает речь: transcribeAudio на вшитом сэмпле */
async function handleVoiceTest(url: URL, env: Env): Promise<Response> {
  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  const key = env.SEARCH_TEST_KEY || ''
  if (key && url.searchParams.get('key') !== key) return json({ ok: false, error: 'неверный key' }, 403)
  const attempts: any[] = []
  const t0 = Date.now()
  const r = await transcribeAudio(TEST_VOICE_B64, 'audio/ogg', {
    aiBinding: env.AI,
    coarenaKey: env.COARENA_API_KEY || '',
    openrouterKey: env.OPENROUTER_API_KEY || '',
    geminiKey: env.GEMINI_API_KEY || '',
    geminiBaseUrl: env.GEMINI_BASE_URL || '',
    geminiModel: env.GEMINI_MODEL || '',
    debug: attempts,
  })
  return json({ ok: !!r.text, text: r.text || '', model: r.model || '', tried: r.tried, lastError: r.lastError || '', attempts, ms: Date.now() - t0 })
}

/** Проверка ключа Gemini через сеть Cloudflare: из песочницы владельца Google
 *  блокирует регион, а тело ошибки WebFetch не показывает. ?candidate=…&kind=models|text.
 *  Ключ НИКОГДА не возвращается в ответе и не пишется в логи. */
async function handleGeminiKeyTest(url: URL, env: Env): Promise<Response> {
  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  const gate = env.SEARCH_TEST_KEY || ''
  if (gate && url.searchParams.get('key') !== gate) return json({ ok: false, error: 'неверный key' }, 403)
  const candidate = (url.searchParams.get('candidate') || env.GEMINI_API_KEY || '').trim()
  if (!candidate) return json({ ok: false, error: 'нет candidate и GEMINI_API_KEY пуст' })
  const kind = url.searchParams.get('kind') === 'text' ? 'text' : 'models'
  try {
    if (kind === 'models') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=${encodeURIComponent(candidate)}`, { signal: AbortSignal.timeout(15000) })
      const body: any = await res.json().catch(() => ({}))
      if (res.ok) {
        const ms: string[] = (body?.models || []).map((m: any) => String(m.name || '').replace('models/', ''))
        return json({ ok: true, verdict: 'валиден (список моделей)', count: ms.length, flash: ms.filter((m) => m.includes('flash')).slice(0, 12), image: ms.filter((m) => m.includes('image')).slice(0, 8) })
      }
      return json({ ok: false, verdict: `HTTP ${res.status}`, error: String(body?.error?.message || '').slice(0, 300), status: body?.error?.status || '' })
    }
    // kind=text: минимальный generateContent — проверка именно генерации
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(candidate)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Ответь одним словом: живой' }] }], generationConfig: { temperature: 0, maxOutputTokens: 16 } }),
      signal: AbortSignal.timeout(20000),
    })
    const body: any = await res.json().catch(() => ({}))
    if (res.ok) {
      const reply = (body?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim()
      return json({ ok: true, verdict: 'валиден (generateContent)', reply, modelVersion: body?.modelVersion || '' })
    }
    return json({ ok: false, verdict: `HTTP ${res.status}`, error: String(body?.error?.message || '').slice(0, 300), status: body?.error?.status || '' })
  } catch (e: any) {
    return json({ ok: false, verdict: 'сеть/таймаут', error: String(e?.message || e).slice(0, 200) })
  }
}

async function handleLlmTest(url: URL, env: Env): Promise<Response> {
  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  const key = env.SEARCH_TEST_KEY || ''
  if (key && url.searchParams.get('key') !== key) return json({ ok: false, error: 'неверный key' }, 403)

  const out: Record<string, unknown> = { ok: true, version: VERSION }

  // Какие переменные воркер РЕАЛЬНО видит (только имена, не значения) —
  // так ловим опечатки в имени секрета и «секрет не в тот раздел»
  out.envKeys = Object.keys(env).sort()

  // Откуда воркер ходит в интернет — регион важен: Google Gemini закрыт для части стран
  try {
    const r = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(5000) })
    const j: any = await r.json()
    out.egress = {
      ip: j.ip,
      city: j.city,
      country: j.country,
      colo: r.headers.get('cf-ray')?.split('-').pop() || '', // из какой коло ходили в сеть
    }
  } catch (e: any) {
    out.egress = { error: String(e?.message || e) }
  }

  // Coarena жив? Ключ проверяем лёгким запросом /credits (план и баланс арены),
  // затем мини-прогон модели с тем же именем, что у мозга — увидим настоящий код
  // ошибки: 401 (ключ не принят), 402 (модель не в бесплатном наборе), 429 (лимит)
  const coKey = env.COARENA_API_KEY || ''
  if (coKey) {
    try {
      const cr = await fetch('https://coarena.ai/api/v1/credits', {
        headers: { Authorization: `Bearer ${coKey}` },
        signal: AbortSignal.timeout(8000),
      })
      const cj: any = await cr.json().catch(() => ({}))
      out.coarenaKey = cr.ok
        ? { ok: true, credits: cj }
        : { ok: false, status: cr.status, message: String(cj?.error?.message || JSON.stringify(cj)).slice(0, 200) }
    } catch (e: any) {
      out.coarenaKey = { ok: false, error: String(e?.message || e) }
    }
    try {
      const t0 = Date.now()
      const r = await fetch('https://coarena.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${coKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: env.COARENA_MODEL || 'deepseek-v4-1-flash-1017',
          messages: [{ role: 'user', content: 'Скажи «привет» одним словом' }],
          max_tokens: 16,
        }),
        signal: AbortSignal.timeout(15000),
      })
      const j: any = await r.json().catch(() => ({}))
      out.coarenaTest = r.ok
        ? { ok: true, model: j?.model || '', ms: Date.now() - t0 }
        : {
            ok: false,
            status: r.status,
            code: String(j?.error?.code ?? ''),
            message: String(j?.error?.message || JSON.stringify(j?.error ?? j)).slice(0, 300),
            ms: Date.now() - t0,
          }
    } catch (e: any) {
      out.coarenaTest = { ok: false, error: String(e?.message || e) }
    }
  } else {
    out.coarenaKey = { ok: false, error: 'секрет COARENA_API_KEY не задан' }
  }

  // Ключ Gemini жив? (список моделей — лёгкий запрос, полный ответ см. ?text=)
  // keyType: sk-gemini-… — это ключ моста gemini-web2api, напрямую в Google он не работает
  const geminiKey = env.GEMINI_API_KEY || ''
  if (geminiKey) {
    const base = (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')
    const keyType = /^sk-/.test(geminiKey) ? 'мост gemini-web2api (sk-gemini-…)' : 'Google AI Studio'
    const bridgeNote = /^sk-/.test(geminiKey) && !env.GEMINI_BASE_URL
      ? 'Ключ от моста gemini-web2api: без секрета GEMINI_BASE_URL (адрес туннеля) мозг сразу отвечает через OpenRouter. Когда мост поднят — добавьте GEMINI_BASE_URL и нажмите Deploy.'
      : ''
    try {
      const r = await fetch(`${base}/models?pageSize=8&key=${encodeURIComponent(geminiKey)}`, {
        signal: AbortSignal.timeout(8000),
      })
      const j: any = await r.json().catch(() => ({}))
      if (r.ok) {
        out.gemini = {
          ok: true,
          models: (j.models || []).map((m: any) => String(m.name || '').replace(/^models\//, '')).slice(0, 8),
        }
      } else {
        const msg = String(j?.error?.message || '')
        const g: Record<string, unknown> = {
          ok: false,
          status: r.status,
          code: j?.error?.status || '',
          message: msg.slice(0, 200),
        }
        // Подсказка, чтобы «региональный» отказ не принимали за битый ключ:
        // Google проверяет авторизацию раньше региона
        if (/API_KEY_INVALID|API key not valid/i.test(msg)) {
          g.note =
            'Ключ НЕ принят Google — похоже, значение скопировано не полностью или ключ отозван. Rotate → вставить заново.'
        } else if (/location is not supported|FAILED_PRECONDITION/i.test(msg)) {
          g.note =
            'Ключ, скорее всего, жив: отказ из-за региона (Google закрыл API для этой страны), а не из-за ключа. '
            + 'Telegram-запросы приходят в европейские дата-центры — там Gemini отвечает. Финальная проверка — написать Дарии в чат.'
        }
        out.gemini = g
      }
    } catch (e: any) {
      out.gemini = { ok: false, error: String(e?.message || e) }
    } finally {
      // keyType и подсказку приписываем к любому исходу проверки (правка
      // unknown-объекта на месте не компилируется — работаем через локальный Record)
      const g = (out.gemini || {}) as Record<string, unknown>
      g.keyType = keyType
      if (bridgeNote) g.note = g.note ? `${String(g.note)} ${bridgeNote}` : bridgeNote
      out.gemini = g
    }
  } else {
    out.gemini = { ok: false, error: 'секрет GEMINI_API_KEY не задан' }
  }

  // OpenRouter жив? Сначала ключ (лёгкий запрос /api/v1/key), затем минимальный
  // прогон с той же цепочкой моделей, что у мозга — увидим настоящий код ошибки
  const orKey = env.OPENROUTER_API_KEY || ''
  if (orKey) {
    try {
      const kr = await fetch('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${orKey}` },
        signal: AbortSignal.timeout(8000),
      })
      const kj: any = await kr.json().catch(() => ({}))
      out.openrouterKey = kr.ok
        ? {
            ok: true,
            label: kj?.data?.label || '',
            usage: kj?.data?.usage,
            limit: kj?.data?.limit ?? 'без лимита',
            free_tier: kj?.data?.is_free_tier,
          }
        : { ok: false, status: kr.status, message: String(kj?.error?.message || '').slice(0, 200) }
    } catch (e: any) {
      out.openrouterKey = { ok: false, error: String(e?.message || e) }
    }
    try {
      const models = [env.OPENROUTER_MODEL || OPENROUTER_CHAIN[0], ...OPENROUTER_CHAIN.slice(1)].filter(
        (m, i, a) => a.indexOf(m) === i,
      )
      const t0 = Date.now()
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${orKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Daria Telegram Bot',
        },
        body: JSON.stringify({
          models,
          messages: [{ role: 'user', content: 'Скажи «привет» одним словом' }],
          max_tokens: 16,
        }),
        signal: AbortSignal.timeout(15000),
      })
      const j: any = await r.json().catch(() => ({}))
      out.openrouterTest = r.ok
        ? { ok: true, model: j?.model || '', ms: Date.now() - t0 }
        : {
            ok: false,
            status: r.status,
            code: String(j?.error?.code ?? ''),
            message: String(j?.error?.message || JSON.stringify(j?.error ?? j)).slice(0, 300),
            ms: Date.now() - t0,
          }
    } catch (e: any) {
      out.openrouterTest = { ok: false, error: String(e?.message || e) }
    }
  } else {
    out.openrouterKey = { ok: false, error: 'секрет OPENROUTER_API_KEY не задан' }
  }

  // Полный прогон мозга: ?text=Привет
  const text = (url.searchParams.get('text') || '').trim()
  if (text) {
    const t0 = Date.now()
    const reply = await askLLM(
      [{ role: 'user', content: text }],
      {
        coarenaKey: env.COARENA_API_KEY || '',
        coarenaModel: env.COARENA_MODEL || '',
        openrouterKey: env.OPENROUTER_API_KEY || '',
        openrouterModel: env.OPENROUTER_MODEL || '',
        geminiKey,
        geminiBaseUrl: env.GEMINI_BASE_URL || '',
        geminiModel: env.GEMINI_MODEL || '',
        tz: env.TIMEZONE || 'Europe/Moscow',
      },
    )
    out.answer = { reply: reply ?? null, ms: Date.now() - t0 }
  }
  return json(out)
}

async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const token = env.TELEGRAM_BOT_TOKEN || ''
  if (!token) return new Response('no token', { status: 500 })

  const expected = await sha256Hex(`${token}:daria-webhook`)
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== expected) {
    return new Response('forbidden', { status: 403 })
  }

  let update: { message?: any; update_id?: number }
  try {
    update = await request.json() as any
  } catch {
    return new Response('ok')
  }

  // Дедупликация по update_id (защита от повторных доставок)
  const uid = update?.update_id
  if (typeof uid === 'number') {
    if (processedUpdates.has(uid)) return new Response('ok')
    processedUpdates.add(uid)
    if (processedUpdates.size > 300) {
      let i = 0
      for (const old of processedUpdates) {
        processedUpdates.delete(old)
        if (++i >= 150) break
      }
    }
  }

  // Отвечаем Telegram мгновенно, обработку — в фоне: без этого повторы и дубли ответов
  ctx.waitUntil(
    (async () => {
      try {
        if (update.message) {
          if (!cachedBotId) await getBotId(token)
          await handleMessage(update.message, env)
        }
      } catch (e) {
        console.error('update failed', e)
      }
    })(),
  )
  return new Response('ok')
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/' && request.method === 'GET') return handleStatus(env)
    if (url.pathname === '/setup' && request.method === 'GET') return handleSetup(url, env)
    if (url.pathname === '/search-test' && request.method === 'GET') return handleSearchTest(url, env)
    if (url.pathname === '/llm-test' && request.method === 'GET') return handleLlmTest(url, env)
    if (url.pathname === '/image-test' && request.method === 'GET') return handleImageTest(url, env)
    if (url.pathname === '/vision-test' && request.method === 'GET') return handleVisionTest(url, env)
    if (url.pathname === '/voice-test' && request.method === 'GET') return handleVoiceTest(url, env)
    if (url.pathname === '/gemini-key-test' && request.method === 'GET') return handleGeminiKeyTest(url, env)
    if (url.pathname === '/read-test' && request.method === 'GET') return handleReadTest(url, env)
    if (url.pathname === '/ai-test' && request.method === 'GET') return handleAiTest(url, env)
    if (url.pathname === '/tts-test' && request.method === 'GET') return handleTtsTest(url, env)
    if (url.pathname === '/telegram-webhook' && request.method === 'POST') return handleWebhook(request, env, ctx)
    return new Response('not found', { status: 404 })
  },
}
