import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Стрим-прокси музыки. Зачем он нужен:
 *  1. http-потоки радио: страница работает по https — браузер режет смешанный
 *     контент, а через наш же эндпоинт поток приходит с https и играется.
 *  2. Hotlink-защита: mp3.mn/sunproxy отдают mp3 только с правильным Referer
 *     и User-Agent — браузер их не пошлёт, сервер пошлёт.
 *  3. Единый источник аудио для плеера: меньше сюрпризов с CORS/редиректами.
 *
 * Тело ответа проксируется потоком (без буферизации всего файла), Range
 * передаётся дальше — перемотка и докачка работают как с прямым URL.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Сайты, чьи файлы играют только с их собственным Referer */
const REFERER_RULES: Array<[RegExp, string]> = [
  [/sunproxy\.net|mp3\.mn|mp3mn\.net/i, 'https://mp3mn.net/'],
]

const PASSTHROUGH_REQ_HEADERS = ['range', 'if-range', 'icy-metadata']
const PASSTHROUGH_RES_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'icy-name',
  'icy-genre',
  'icy-br',
  'icy-url',
]

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url') ?? ''
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return Response.json({ error: 'Некорректный url' }, { status: 400 })
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return Response.json({ error: 'Только http/https' }, { status: 400 })
  }

  const referer = REFERER_RULES.find(([re]) => re.test(target.hostname))?.[1] ?? target.origin
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Referer: referer,
    Accept: '*/*',
    'Accept-Language': 'ru,en;q=0.8',
  }
  for (const name of PASSTHROUGH_REQ_HEADERS) {
    const value = req.headers.get(name)
    if (value) headers[name] = value
  }

  // Стрим может длиться часами (радио) — таймаут не ставим, обрываем поток,
  // когда уйдёт сам плеер (пауза/выключение музыки)
  const upstreamController = new AbortController()
  const onClientAbort = () => upstreamController.abort()
  req.signal.addEventListener('abort', onClientAbort)

  try {
    const upstream = await fetch(target.toString(), {
      headers,
      redirect: 'follow',
      signal: upstreamController.signal,
    })
    if (!upstream.ok && upstream.status !== 206) {
      return Response.json({ error: `Источник ответил ${upstream.status}` }, { status: 502 })
    }

    const out = new Headers()
    for (const name of PASSTHROUGH_RES_HEADERS) {
      const value = upstream.headers.get(name)
      if (value) out.set(name, value)
    }
    if (!out.has('content-type')) out.set('content-type', 'audio/mpeg')
    out.set('cache-control', 'no-store')
    out.set('access-control-allow-origin', '*')

    return new Response(upstream.body, { status: upstream.status, headers: out })
  } catch {
    return Response.json({ error: 'Поток недоступен' }, { status: 502 })
  }
}
