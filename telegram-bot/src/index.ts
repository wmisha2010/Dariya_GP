/**
 * Дария в Telegram — Cloudflare Worker (webhook).
 *
 * Маршруты:
 *   GET  /                      — статус-страница (жив ли воркер и webhook);
 *   GET  /setup?bot_token=...   — регистрация webhook у Telegram (одноразово);
 *   GET  /search-test?q=...     — диагностика веб-поиска;
 *   GET  /llm-test[&text=...]   — диагностика «мозга»: ключ Gemini, регион выхода, живой ответ;
 *   POST /telegram-webhook      — приём апдейтов от Telegram.
 *
 * Секреты (Dashboard → Worker → Settings → Variables and Secrets):
 *   TELEGRAM_BOT_TOKEN — токен от @BotFather (обязателен);
 *   GEMINI_API_KEY — главный мозг, OPENROUTER_API_KEY — запасной (опционально);
 *   WEB_APP_URL — ссылка на веб-версию с плеером (по умолчанию — превью-песочница).
 */

import {
  extractCommand,
  resolveCommand,
  askLLM,
  NO_BRAIN,
  OPENROUTER_CHAIN,
  needsWebSearch,
  webSearch,
  formatSearchContext,
  buildSearchQuery,
  fixFalseGoogled,
  withCityContext,
} from './brain.js'

export interface Env {
  TELEGRAM_BOT_TOKEN: string
  OPENROUTER_API_KEY?: string
  OPENROUTER_MODEL?: string
  GEMINI_API_KEY?: string
  GEMINI_BASE_URL?: string
  GEMINI_MODEL?: string
  TIMEZONE?: string
  WEB_APP_URL?: string
  WEB_SEARCH?: string
  SEARCH_TEST_KEY?: string
}

const TG_API = 'https://api.telegram.org'
const DEFAULT_WEB_APP_URL = 'https://preview-chat-d8e654d4-40f5-415b-a16a-09dbc10c3f5d.space-z.ai/'
const VERSION = 'v0.3.15 (brain v3.2)'

/** Контекст диалогов — живёт, пока жив изолят воркера (best-effort, без БД) */
const chatHistory = new Map<number, Array<{ role: 'user' | 'assistant'; content: string }>>()
const HISTORY_MAX_TURNS = 8

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
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: false,
  }
  if (replyTo) payload.reply_to_message_id = replyTo
  return tgCall(token, 'sendMessage', payload)
}

// ── Обработка апдейта ────────────────────────────────────────────────────

async function handleMessage(msg: any, env: Env): Promise<void> {
  const text: string | undefined = msg?.text
  if (!text) return

  const isPrivate = msg.chat?.type === 'private'
  const chatId: number = msg.chat?.id
  const token = env.TELEGRAM_BOT_TOKEN

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
    else return // не к нам обращение — молчим
  }

  const tz = env.TIMEZONE || 'Europe/Moscow'
  const webAppUrl = env.WEB_APP_URL || DEFAULT_WEB_APP_URL

  // 1) Быстрые ответы без ИИ
  const quick = resolveCommand(command, { tz, webAppUrl })
  if (quick.handled) {
    await sendMessage(token, chatId, quick.text, isPrivate ? undefined : msg.message_id)
    return
  }

  // 2) Свободные темы — через LLM (Gemini → OpenRouter)
  const history = chatHistory.get(chatId) ?? []
  const prevUserTexts = history.filter((h) => h.role === 'user').map((h) => h.content).slice(-4)
  history.push({ role: 'user', content: text }) // в контекст — исходная фраза
  while (history.length > HISTORY_MAX_TURNS * 2) history.shift()
  chatHistory.set(chatId, history)

  // 2а) Свежие данные? Гонка поисковых движков → выдача в контекст LLM.
  // Погода без города («А погода?») — берём город из предыдущих реплик диалога.
  let webContext = ''
  if ((env.WEB_SEARCH || '') !== 'off' && needsWebSearch(command)) {
    try {
      const seed = withCityContext(command, prevUserTexts)
      const results = await webSearch(buildSearchQuery(seed))
      webContext = formatSearchContext(results, command)
    } catch { /* без поиска — ответим из знаний */ }
  }

  const llmText = await askLLM(history, {
    openrouterKey: env.OPENROUTER_API_KEY || '',
    openrouterModel: env.OPENROUTER_MODEL || '',
    geminiKey: env.GEMINI_API_KEY || '',
    geminiBaseUrl: env.GEMINI_BASE_URL || '',
    geminiModel: env.GEMINI_MODEL || '',
    webContext,
    tz,
  })

  let reply: string
  if (llmText) {
    // Поиск не было — ложное «погуглила» заменяем честным «вспомнила»
    reply = webContext ? llmText : fixFalseGoogled(llmText)
    history.push({ role: 'assistant', content: reply })
  } else {
    reply = NO_BRAIN[Math.floor(Math.random() * NO_BRAIN.length)]
  }

  await sendMessage(token, chatId, reply, isPrivate ? undefined : msg.message_id)
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
  // Строка «Мозг»: различаем три состояния, чтобы хозяин видел, чего не хватает
  let brainLine: string
  if (env.GEMINI_API_KEY) {
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
    brainLine = '<p>Мозг: НЕ подключён 😴 — добавьте секрет GEMINI_API_KEY или OPENROUTER_API_KEY</p>'
  }
  return html([
    '<h1>Дария-бот жива 😏</h1>',
    `<p>Версия: ${VERSION}</p>`,
    token ? '<p>Токен: задан ✅</p>' : '<p>Токен: НЕ задан — добавьте секрет TELEGRAM_BOT_TOKEN</p>',
    brainLine,
    `<p>Веб-поиск: ${env.WEB_SEARCH === 'off' ? 'выключен 🚫' : 'включён 🌐 (5 движков + Википедия)'}</p>`,
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

/** Диагностика «мозга»: откуда воркер ходит в сеть, жив ли ключ Gemini, тестовый ответ */
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
    if (url.pathname === '/telegram-webhook' && request.method === 'POST') return handleWebhook(request, env, ctx)
    return new Response('not found', { status: 404 })
  },
}
