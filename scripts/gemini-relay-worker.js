/**
 * Cloudflare Worker — релей для Google Gemini API (обход гео-ограничения).
 *
 * Google запрещает бесплатный Gemini для запросов с серверов ряда регионов
 * (Гонконг, Россия и др.). Этот воркер просто пересылает запрос на Google со
 * своего IP (инфраструктура Cloudflare — поддерживаемый регион), не храня
 * никаких ключей: ключ передаётся в строке запроса, как и раньше.
 *
 * Как задеплоить (5 минут, бесплатно, карта не нужна):
 *   1. Зайди на https://workers.cloudflare.com → Sign up / Log in
 *      (можно через Google-аккаунт).
 *   2. «Create application» → «Create Worker» → Deploy (дефолтный hello world).
 *   3. «Edit code» → удали всё, вставь ЭТОТ ФАЙЛ целиком → Deploy.
 *   4. Скопируй адрес воркера вида https://имя.аккаунт.workers.dev
 *      (имя воркера сделай подлиннее и поприличнее — оно публичное).
 *   5. Пришли мне эту ссылку — я пропишу GEMINI_BASE_URL и проверю.
 *      (Самостоятельно: в .env.local добавь строку
 *       GEMINI_BASE_URL=https://имя.аккаунт.workers.dev/v1beta
 *       и перезапусти сервер.)
 *
 * Лимиты free-тарифа Cloudflare: 100 000 запросов/день — хватит с запасом.
 */

export default {
  async fetch(request) {
    const url = new URL(request.url)

    // Разрешаем только пересылку к Google Gemini API
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(
        JSON.stringify({ ok: true, relay: 'gemini', hint: 'PUT /v1beta/...' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const target =
      'https://generativelanguage.googleapis.com' + url.pathname + url.search

    // Прокидываем только нужные заголовки (служебные cf-*/host не передаём)
    const headers = new Headers()
    for (const name of ['content-type', 'authorization', 'x-goog-api-key', 'accept']) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }

    // Тело читаем целиком (JSON небольшой), ответ стримится обратно как есть
    const method = request.method
    const body = method === 'GET' || method === 'HEAD' ? undefined : await request.text()

    const upstream = await fetch(target, { method, headers, body })

    const responseHeaders = new Headers()
    for (const name of ['content-type', 'content-length']) {
      const value = upstream.headers.get(name)
      if (value) responseHeaders.set(name, value)
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  },
}
