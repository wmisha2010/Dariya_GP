'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Состояние воспроизведения фоновой музыки */
export type YtPlayback = 'loading' | 'playing' | 'paused' | 'idle'

/** Минимальные типы YouTube IFrame API — только то, что используем */
interface YtPlayer {
  playVideo(): void
  pauseVideo(): void
  setVolume(volume: number): void
  getPlayerState(): number
  getIframe(): HTMLIFrameElement
  destroy(): void
}
interface YtEvent {
  target: YtPlayer
  data?: number
}
interface YtNamespace {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId: string
      width?: number
      height?: number
      playerVars?: Record<string, number | string>
      events?: {
        onReady?: (event: YtEvent) => void
        onStateChange?: (event: YtEvent) => void
        onError?: (event: YtEvent) => void
      }
    }
  ) => YtPlayer
}

declare global {
  interface Window {
    YT?: YtNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YtNamespace> | null = null

/** Грузим IFrame API один раз на страницу и переиспользуем */
function loadYouTubeApi(): Promise<YtNamespace> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise
  apiPromise = new Promise<YtNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT?.Player) resolve(window.YT)
      else reject(new Error('YouTube API не инициализировался'))
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => reject(new Error('YouTube недоступен'))
    document.head.appendChild(script)
    window.setTimeout(() => {
      if (!window.YT?.Player) reject(new Error('YouTube-плеер не загрузился'))
    }, 15000)
  }).catch((error) => {
    apiPromise = null
    throw error
  })
  return apiPromise
}

/** Во сколько раз тише музыка, пока говорит Дария */
const DUCK_FACTOR = 0.2
/** Сколько ждём старта после onReady, прежде чем пнуть плеер ещё раз */
const START_WATCHDOG_MS = 8_000
/** Сколько даём на повторный пинок, прежде чем признать трек битым */
const RETRY_WATCHDOG_MS = 4_000

const clampVolume = (v: number) => Math.min(100, Math.max(0, Math.round(v)))

export interface UseYouTubeAudioOptions {
  videoId: string | null
  /** Пользовательская громкость 0-100 (голосовая команда «громкость 40») */
  volume?: number
  /** Трек закончился — включаем следующий */
  onEnded?: () => void
  /** Трек нельзя воспроизвести (запрещён embed и т.п.) — пропускаем */
  onError?: () => void
}

/**
 * Фоновый YouTube-плеер: iframe под слоем интерфейса — слышна только музыка.
 * Ключевой момент: созданному API iframe сразу ставится allow="autoplay" —
 * без него Chrome блокирует автозапуск звука в кросс-доменном фрейме и
 * музыка молчит навсегда. Если трек всё же не заиграл (запрещён embed,
 * YouTube недоступен) — срабатывает страховка и очередь листает дальше.
 */
export function useYouTubeAudio({ videoId, volume = 100, onEnded, onError }: UseYouTubeAudioOptions) {
  const [playback, setPlayback] = useState<YtPlayback>('idle')
  const [failed, setFailed] = useState(false)
  const playerRef = useRef<YtPlayer | null>(null)
  const duckedRef = useRef(false)
  const volumeRef = useRef(clampVolume(volume))
  const handlersRef = useRef({ onEnded, onError })
  // Держим актуальные колбэки вне рендера — события плеера всегда зовут свежие
  useEffect(() => {
    handlersRef.current = { onEnded, onError }
  })

  /** Стабильный id обёртки: контейнер обязан жить в DOM, пока играет музыка */
  const [containerId] = useState(() => `yt-audio-${Math.random().toString(36).slice(2, 9)}`)

  /** Эффективная громкость = пользовательская × коэффициент приглушения */
  const applyVolume = useCallback(() => {
    const factor = duckedRef.current ? DUCK_FACTOR : 1
    try {
      playerRef.current?.setVolume(Math.round(volumeRef.current * factor))
    } catch {
      // плеер мог пересоздаваться — не страшно
    }
  }, [])

  useEffect(() => {
    volumeRef.current = clampVolume(volume)
    applyVolume()
  }, [volume, applyVolume])

  useEffect(() => {
    if (!videoId) {
      playerRef.current?.destroy()
      playerRef.current = null
      // setState отложен в микрозадачу — не в теле эффекта (react-hooks)
      queueMicrotask(() => {
        setPlayback('idle')
        setFailed(false)
      })
      return
    }
    let cancelled = false
    /** Трек уже признан битым — страховки больше не срабатывают */
    let skipped = false
    const watchdogs = new Set<ReturnType<typeof setTimeout>>()
    const later = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        watchdogs.delete(id)
        fn()
      }, ms)
      watchdogs.add(id)
    }
    queueMicrotask(() => {
      if (!cancelled) {
        setFailed(false)
        setPlayback('loading')
      }
    })

    const trySkip = () => {
      if (cancelled || skipped) return
      skipped = true
      for (const id of watchdogs) clearTimeout(id)
      setPlayback('idle')
      setFailed(true)
      handlersRef.current.onError?.()
    }

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return
        playerRef.current?.destroy()
        playerRef.current = null
        const wrapper = document.getElementById(containerId)
        if (!wrapper) return
        // YT.Player заменяет переданный элемент на iframe — каждый раз даём свежий
        const host = document.createElement('div')
        wrapper.replaceChildren(host)
        const origin = window.location.origin
        const player = new YT.Player(host, {
          videoId,
          width: 200,
          height: 200,
          playerVars: { autoplay: 1, controls: 0, playsinline: 1, rel: 0, origin },
          events: {
            onReady: (event) => {
              if (cancelled || skipped) return
              // ДЕЛЕГАЦИЯ АВТОЗАПУСКА: у iframe, созданного API, нет allow="autoplay",
              // и Chrome блокирует в нём звук даже после жеста пользователя на
              // странице. Ставим атрибут сразу после создания — фрейм ещё не
              // начал грузиться, разрешение успевает подхватиться
              try {
                event.target.getIframe()?.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture')
              } catch {
                /* не критично */
              }
              event.target.setVolume(Math.round(volumeRef.current * (duckedRef.current ? DUCK_FACTOR : 1)))
              event.target.playVideo()
              // Не заиграл сам — пинаем ещё раз, потом листаем очередь
              later(() => {
                try {
                  if (playerRef.current?.getPlayerState() === 1) return
                  playerRef.current?.playVideo()
                } catch {
                  trySkip()
                  return
                }
                later(trySkip, RETRY_WATCHDOG_MS)
              }, START_WATCHDOG_MS)
            },
            onStateChange: (event) => {
              // 1 — играет, 2 — пауза, 0 — закончился
              if (event.data === 1) {
                skipped = true // играет — все страховки отменяются
                for (const id of watchdogs) clearTimeout(id)
                setPlayback('playing')
              } else if (event.data === 2) setPlayback('paused')
              else if (event.data === 0) {
                setPlayback('idle')
                handlersRef.current.onEnded?.()
              }
            },
            onError: () => trySkip(),
          },
        })
        playerRef.current = player
      })
      .catch(() => {
        // API/сеть недоступны — не молчим, а переходим к следующему треку
        if (!cancelled) trySkip()
      })
    return () => {
      cancelled = true
      for (const id of watchdogs) clearTimeout(id)
    }
  }, [videoId, containerId])

  // Плеер уничтожается при размонтировании страницы
  useEffect(
    () => () => {
      playerRef.current?.destroy()
      playerRef.current = null
    },
    []
  )

  /** Пауза / продолжить (кнопка на панели и голосовая команда «пауза») */
  const toggle = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    if (player.getPlayerState() === 1) {
      player.pauseVideo()
      setPlayback('paused')
    } else {
      player.playVideo()
      setPlayback('playing')
    }
  }, [])

  /** Приглушить музыку на время голоса ассистента */
  const duck = useCallback(
    (on: boolean) => {
      duckedRef.current = on
      applyVolume()
    },
    [applyVolume]
  )

  return { playback, failed, toggle, duck, containerId }
}
