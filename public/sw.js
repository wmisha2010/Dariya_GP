/**
 * Дария — минимальный сервис-воркер для установки как приложение (PWA).
 *
 * Стратегии (сознательно консервативные, чтобы не ломать живой разговор):
 *  - /api/* НЕ перехватываем вообще: SSE-стриминг ответов и озвучка должны
 *    течь напрямую, любой кэш посередине = зависший разговор;
 *  - /_next/static и /icons — cache-first (неизменяемые ресурсы, у Next
 *    они с хэшами в имени);
 *  - всё остальное — только сеть; при отсутствии сети отдаём закэшированную
 *    оболочку «/», чтобы приложение хотя бы открылось.
 */
const CACHE = 'daria-shell-v2'
const SHELL = ['/', '/icons/icon-192.png', '/icons/icon-512.png', '/logo.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // Стриминг чата/озвучки/поиска — только сеть, без посредника
  if (url.pathname.startsWith('/api/')) return

  // Неизменяемые статические ресурсы — cache-first.
  // НО: это верно только для прода — у дев-чанков Turbopack имя постоянное
  // (заканчивается на «._.js»), а код меняется при каждой правке; закэшированный
  // дев-чанк = приложение навсегда застряло на старом коде. Их — только сеть
  if (url.pathname.endsWith('._.js')) return
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(req, copy))
            return res
          })
      )
    )
    return
  }

  // Страницы — всегда свежие с сети; офлайн — оболочка
  event.respondWith(fetch(req).catch(() => caches.match('/')))
})
