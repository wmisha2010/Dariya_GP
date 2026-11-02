/**
 * Дария в Telegram — Cloudflare Worker (webhook).
 *
 * Маршруты:
 *   GET  /                      — статус-страница (жив ли воркер и webhook);
 *   GET  /setup?bot_token=...   — регистрация webhook у Telegram (одноразово);
 *   POST /telegram-webhook      — приём апдейтов от Telegram.
 *
 * Секреты (Dashboard → Worker → Settings → Variables and Secrets):
 *   TELEGRAM_BOT_TOKEN — токен от @BotFather (обязателен);
 *   OPENROUTER_API_KEY / GEMINI_API_KEY — «мозг» для свободных тем (опционально);
 *   WEB_APP_URL — ссылка на веб-версию с плеером (по умолчанию — превью-песочница).
 */

import {
  extractCommand,
  resolveCommand,
  askLLM,
  NO_BRAIN,
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
}

const TG_API = 'https://api.telegram.org'
const DEFAULT_WEB_APP_URL = 'https://preview-chat-d8e654d4-40f5-415b-a16a-09dbc10c3f5d.space-z.ai/'
const VERSION = 'v0.1 (brain v2.5)'

/** Контекст диалогов — живёт, пока жив изолят воркера (best-effort, без БД) */
const chatHistory = new Map<number, Array<{ role: 'user' | 'assistant'; content: string }>>()
const HISTORY_MAX_TURNS = 8

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

  // 2) Свободные темы — через LLM (OpenRouter → Gemini)
  const history = chatHistory.get(chatId) ?? []
  history.push({ role: 'user', content: text }) // в контекст — исходная фраза
  while (history.length > HISTORY_MAX_TURNS * 2) history.shift()
  chatHistory.set(chatId, history)

  const llmText = await askLLM(history, {
    openrouterKey: env.OPENROUTER_API_KEY || '',
    openrouterModel: env.OPENROUTER_MODEL || '',
    geminiKey: env.GEMINI_API_KEY || '',
    geminiBaseUrl: env.GEMINI_BASE_URL || '',
    geminiModel: env.GEMINI_MODEL || '',
  })

  let reply: string
  if (llmText) {
    reply = llmText
    history.push({ role: 'assistant', content: llmText })
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
  return html([
    '<h1>Дария-бот жива 😏</h1>',
    `<p>Версия: ${VERSION}</p>`,
    token ? '<p>Токен: задан ✅</p>' : '<p>Токен: НЕ задан — добавьте секрет TELEGRAM_BOT_TOKEN</p>',
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

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const token = env.TELEGRAM_BOT_TOKEN || ''
  if (!token) return new Response('no token', { status: 500 })

  const expected = await sha256Hex(`${token}:daria-webhook`)
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== expected) {
    return new Response('forbidden', { status: 403 })
  }

  try {
    const update = await request.json() as { message?: any }
    if (update.message) {
      if (!cachedBotId) await getBotId(token)
      await handleMessage(update.message, env)
    }
  } catch (e) {
    console.error('update failed', e)
  }
  return new Response('ok')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/' && request.method === 'GET') return handleStatus(env)
    if (url.pathname === '/setup' && request.method === 'GET') return handleSetup(url, env)
    if (url.pathname === '/telegram-webhook' && request.method === 'POST') return handleWebhook(request, env)
    return new Response('not found', { status: 404 })
  },
}
