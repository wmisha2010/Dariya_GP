import { NextRequest } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const maxDuration = 30

interface MusicRequestBody {
  query?: string
}

export interface TrackResult {
  videoId: string
  title: string
  author: string
  url: string
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

/** Кэш последних поисков: повторная команда не бьёт по сети */
const searchCache = new Map<string, TrackResult | null>()
const CACHE_MAX = 60

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

async function findTrack(query: string): Promise<TrackResult | null> {
  const [fromSearch, fromPage] = await Promise.all([
    searchByWebSearch(query),
    searchByYouTubePage(query),
  ])
  const ids = [...new Set([...fromSearch, ...fromPage])]

  for (const id of ids.slice(0, 5)) {
    const meta = await fetchMeta(id)
    if (meta === 'skip') continue
    if (meta === null) {
      // Проверить не удалось — берём как есть, хуже не станет
      return { videoId: id, title: 'Трек с YouTube', author: '', url: `https://www.youtube.com/watch?v=${id}` }
    }
    return {
      videoId: id,
      title: (meta.title ?? 'Трек с YouTube').slice(0, 120),
      author: (meta.author_name ?? '').slice(0, 80),
      url: `https://www.youtube.com/watch?v=${id}`,
    }
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as MusicRequestBody
    const query = body.query?.trim()
    if (!query) {
      return new Response(JSON.stringify({ error: 'Пустой запрос' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const key = query.toLowerCase().slice(0, 120)
    const cached = searchCache.get(key)
    if (cached !== undefined) {
      return Response.json(cached ? { track: cached } : { error: 'Ничего не нашлось' }, {
        status: cached ? 200 : 404,
      })
    }

    const track = await findTrack(query)
    if (searchCache.size >= CACHE_MAX) {
      const oldest = searchCache.keys().next().value
      if (oldest !== undefined) searchCache.delete(oldest)
    }
    searchCache.set(key, track)

    if (!track) {
      return Response.json({ error: 'Ничего не нашлось' }, { status: 404 })
    }
    return Response.json({ track })
  } catch {
    return Response.json({ error: 'Поиск музыки не удался' }, { status: 502 })
  }
}
