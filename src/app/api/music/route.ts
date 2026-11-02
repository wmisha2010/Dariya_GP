import { NextRequest } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import type { MusicTrack } from '@/lib/types'

export const maxDuration = 30

interface MusicRequestBody {
  query?: string
  /** generic — «включи музыку» без конкретики: играем популярное, а не ищем точное совпадение */
  mode?: 'specific' | 'generic'
}

/** Кэш SDK-клиента: ZAI.create() тяжёлый, переиспользуем между запросами */
let zaiPromise: ReturnType<typeof ZAI.create> | null = null
function getZai() {
  if (!zaiPromise) {
    zaiPromise = ZAI.create().catch((error) => {
      zaiPromise = null
      throw error
    })
  }
  return zaiPromise
}

/**
 * Кэш последних поисков с TTL: прямые ссылки на mp3 живут недолго,
 * поэтому устаревшие результаты (10 минут) выкидываем и ищем заново.
 */
const searchCache = new Map<string, { tracks: MusicTrack[]; ts: number }>()
const CACHE_MAX = 60
const CACHE_TTL_MS = 10 * 60 * 1000

/** Все прямые потоки играем через наш стрим-прокси: он ставит правильный
 * Referer, тянет http-радио на https-страницу и переживает hotlink-защиту */
function proxied(url: string): string {
  return `/api/music/stream?url=${encodeURIComponent(url)}`
}

/* ──────────────────────────── Источник 1: Mp3.mn ────────────────────────────
 * Пользовательский выбор: mp3.mn — большой каталог музыки с прямыми mp3.
 * Поиск: GET /?song=…, в выдаче у каждого трека button.playlist-play c
 * data-url — прямой HTTPS-поток (mn1.sunproxy.net/...mp3).                   */

/** Снимаем HTML-теги и раскодируем сущности в названиях треков */
function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

async function searchMp3mn(query: string): Promise<MusicTrack[]> {
  try {
    const res = await fetch(`https://mp3.mn/?song=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'ru,en;q=0.8',
      },
      signal: AbortSignal.timeout(9000),
    })
    if (!res.ok) return []
    // Некоторые страницы mp3.mn отдаются в windows-1251 — если в UTF-8
    // декодировании появились затертые байты (U+FFFD) или типичная кириллическая
    // кракозябра «Ð»/«Ñ», перекодируем
    const buf = await res.arrayBuffer()
    let html = new TextDecoder('utf-8').decode(buf)
    if (html.includes('\uFFFD') || /[\u00D0\u00D1][\u0080-\u00BF]/.test(html)) {
      html = new TextDecoder('windows-1251').decode(buf)
    }
    const tracks: MusicTrack[] = []
    const liRe = /<li[^>]*>[\s\S]*?<\/li>/g
    let m: RegExpExecArray | null
    while ((m = liRe.exec(html)) !== null && tracks.length < 8) {
      const block = m[0]
      const audio = /data-url="(https:\/\/[^"]+\.mp3[^"]*)"/.exec(block)?.[1]
      if (!audio) continue
      const artist = /playlist-name-artist[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? ''
      const title = /playlist-name-title[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? ''
      const page = /href="(\/t\/[^"]+)"/.exec(block)?.[1]
      tracks.push({
        source: 'mp3mn',
        title: (stripTags(title) || 'Без названия').slice(0, 120),
        author: stripTags(artist).slice(0, 80),
        url: page ? `https://mp3.mn${page}` : 'https://mp3.mn',
        audioSrc: proxied(audio),
      })
    }
    return tracks
  } catch {
    return []
  }
}

/* ─────────────────────── Источник 2: интернет-радио ───────────────────────
 * radio-browser.info — открытый каталог станций без ключей. Берём только
 * HTTPS-потоки (страница работает по https — смешанный контент запрещён).  */

interface RadioStation {
  name?: string
  url_resolved?: string
  homepage?: string
  favicon?: string
  codec?: string
  lastcheckok?: number
}

/** Зеркала radio-browser.info: сервис часто рвёт соединения — идём по списку */
const RADIO_MIRRORS = [
  'de1.api.radio-browser.info',
  'all.api.radio-browser.info',
  'nl1.api.radio-browser.info',
  'fi1.api.radio-browser.info',
]

/** Поиск по каталогу с ротацией зеркал: первое же живое возвращает список */
async function fetchRadioStations(params: URLSearchParams): Promise<RadioStation[]> {
  for (const host of RADIO_MIRRORS) {
    try {
      const res = await fetch(`https://${host}/json/stations/search?${params}`, {
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'Daria-Assistant/1.0' },
      })
      if (!res.ok) continue
      const list = (await res.json()) as RadioStation[]
      if (Array.isArray(list)) return list
    } catch {
      // зеркало недоступно — пробуем следующее
    }
  }
  return []
}

async function searchRadio(query: string): Promise<MusicTrack[]> {
  try {
    const base = { limit: '8', hidebroken: 'true', order: 'clickcount', reverse: 'true' }
    // 1) по названию станции; 2) по тегу-жанру (первое слово); 3) просто «радио».
    // «западные хиты 80-х» не совпадёт ни с одним названием станции — тогда
    // отступаем к жанру, а после — к живому общему поиску, чтобы станции
    // находились почти всегда.
    const firstWord = query.trim().split(/\s+/)[0] ?? ''
    const attempts: Array<Record<string, string>> = [
      { name: query.slice(0, 60) },
      ...(firstWord && firstWord.toLowerCase() !== query.trim().toLowerCase()
        ? [{ bytag: firstWord.slice(0, 30) }]
        : []),
      { name: 'радио' },
    ]
    for (const attempt of attempts) {
      const list = await fetchRadioStations(new URLSearchParams({ ...attempt, ...base }))
      if (!list.length) continue
      // http-потоки тоже берём: стрим-прокси отдаёт их странице по https
      const tracks = list
        .filter((s) => {
          const url = s.url_resolved ?? ''
          const codec = (s.codec ?? '').toLowerCase()
          return (
            url.startsWith('http') &&
            !url.endsWith('.pls') &&
            s.lastcheckok !== 0 &&
            (codec === '' || codec.includes('mp3') || codec.includes('aac'))
          )
        })
        .slice(0, 4)
        .map((s) => ({
          source: 'radio' as const,
          title: (s.name ?? 'Радио').trim().slice(0, 120) || 'Радио',
          author: 'интернет-радио',
          artwork: s.favicon?.startsWith('https://') ? s.favicon : undefined,
          url: s.homepage ?? s.url_resolved ?? '',
          audioSrc: s.url_resolved ? proxied(s.url_resolved) : undefined,
        }))
      if (tracks.length) return tracks
    }
    return []
  } catch {
    return []
  }
}

/* ─────────────────────── Источник 3: YouTube (запасной) ─────────────────── */

const VIDEO_ID_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/

function extractVideoId(url: string): string | null {
  return VIDEO_ID_RE.exec(url)?.[1] ?? null
}

/** Путь 1: веб-поиск по youtube.com — достаём видеоId из найденных ссылок */
async function searchByWebSearch(query: string): Promise<string[]> {
  try {
    const zai = await getZai()
    const results = await zai.functions.invoke('web_search', {
      query: `${query} site:youtube.com`.slice(0, 200),
      num: 10,
    })
    if (!Array.isArray(results)) return []
    const ids: string[] = []
    for (const r of results as Array<{ url?: string }>) {
      const id = r.url ? extractVideoId(r.url) : null
      if (id && !ids.includes(id)) ids.push(id)
    }
    return ids
  } catch {
    return []
  }
}

/** Путь 2 (резерв): страница выдачи YouTube — парсим videoId из HTML */
async function searchByYouTubePage(query: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%3D%3D&hl=ru`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept-Language': 'ru,en;q=0.8',
        },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) return []
    const html = await res.text()
    const ids: string[] = []
    const re = /"videoId":"([\w-]{11})"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null) {
      if (!ids.includes(m[1])) ids.push(m[1])
      if (ids.length >= 8) break
    }
    return ids
  } catch {
    return []
  }
}

type OembedMeta = { title?: string; author_name?: string }
/** 'skip' — видео нельзя встроить (автор запретил embed), null — проверка не удалась */
type MetaResult = OembedMeta | 'skip' | null

/** oembed отдаёт метаданные; 401/403 означают «встраивание запрещено» — берём следующий кандидат */
async function fetchMeta(videoId: string): Promise<MetaResult> {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (res.status === 401 || res.status === 403) return 'skip'
    if (!res.ok) return null
    return (await res.json()) as OembedMeta
  } catch {
    return null
  }
}

/** Ищем не один трек, а очередь — чтобы работали «дальше» и автопереход */
async function searchYouTube(query: string): Promise<MusicTrack[]> {
  const [fromSearch, fromPage] = await Promise.all([
    searchByWebSearch(query),
    searchByYouTubePage(query),
  ])
  const ids = [...new Set([...fromSearch, ...fromPage])].slice(0, 8)

  // Метаданные всех кандидатов параллельно — быстро отсеиваем запрещённые к embed
  const metas = await Promise.all(ids.map(fetchMeta))
  const tracks: MusicTrack[] = []
  for (let i = 0; i < ids.length && tracks.length < 6; i++) {
    const id = ids[i]
    const meta = metas[i]
    if (meta === 'skip') continue // встраивание запрещено автором
    tracks.push({
      source: 'youtube',
      title: (meta ? meta.title : undefined) ?? 'Трек с YouTube',
      author: (meta ? meta.author_name : undefined) ?? '',
      artwork: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${id}`,
      videoId: id,
    })
  }
  return tracks
}

/* ──────────────────────────────── POST /api/music ────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as MusicRequestBody
    const generic = body.mode === 'generic'
    const query = body.query?.trim() || (generic ? 'популярная музыка' : 'музыка')

    const key = `${generic ? 'g' : 's'}:${query.toLowerCase().slice(0, 120)}`
    const cached = searchCache.get(key)
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return Response.json(
        cached.tracks.length ? { tracks: cached.tracks } : { error: 'Ничего не нашлось' },
        { status: cached.tracks.length ? 200 : 404 }
      )
    }

    // Источники ищем параллельно и СМЕШИВАЕМ в одной очереди: если движок
    // не смог заиграть конкретный трек, плеер сам перейдёт к следующему
    // (mp3-файл → youtube-видео → радио) — музыка не застревает
    const [mp3mn, radio, youtube] = await Promise.all([
      searchMp3mn(query),
      searchRadio(generic ? 'музыка' : query),
      searchYouTube(query),
    ])

    const seen = new Set<string>()
    const tracks: MusicTrack[] = []
    const pushAll = (list: MusicTrack[]) => {
      for (const t of list) {
        const key = t.videoId ?? t.audioSrc ?? t.title
        if (seen.has(key)) continue
        seen.add(key)
        tracks.push(t)
        if (tracks.length >= 12) return
      }
    }
    pushAll(mp3mn.slice(0, 4))
    pushAll(youtube.slice(0, 4))
    pushAll(radio.slice(0, 4))
    if (tracks.length < 3) pushAll([...mp3mn, ...youtube, ...radio])

    if (searchCache.size >= CACHE_MAX) {
      const oldest = searchCache.keys().next().value
      if (oldest !== undefined) searchCache.delete(oldest)
    }
    searchCache.set(key, { tracks, ts: Date.now() })

    if (!tracks.length) {
      return Response.json({ error: 'Ничего не нашлось' }, { status: 404 })
    }
    return Response.json({ tracks })
  } catch {
    return Response.json({ error: 'Поиск музыки не удался' }, { status: 502 })
  }
}
