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

/** Обычная громкость и громкость, пока говорит Дария */
const VOLUME_NORMAL = 100
const VOLUME_DUCKED = 20

export interface UseYouTubeAudioOptions {
  videoId: string | null
  /** Трек закончился — включаем следующий */
  onEnded?: () => void
  /** Трек нельзя воспроизвести (запрещён embed и т.п.) — пропускаем */
  onError?: () => void
}

/**
 * Фоновый YouTube-плеер: iframe размером 2×2 px под слоем интерфейса —
 * слышна только музыка. Умеет пауза/продолжить и приглушение громкости
 * на время голоса ассистента.
 */
export function useYouTubeAudio({ videoId, onEnded, onError }: UseYouTubeAudioOptions) {
  const [playback, setPlayback] = useState<YtPlayback>('idle')
  const [failed, setFailed] = useState(false)
  const playerRef = useRef<YtPlayer | null>(null)
  const duckedRef = useRef(false)
  const handlersRef = useRef({ onEnded, onError })
  // Держим актуальные колбэки вне рендера — события плеера всегда зовут свежие
  useEffect(() => {
    handlersRef.current = { onEnded, onError }
  })

  /** Стабильный id обёртки: контейнер обязан жить в DOM, пока играет музыка */
  const [containerId] = useState(() => `yt-audio-${Math.random().toString(36).slice(2, 9)}`)

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
    queueMicrotask(() => {
      if (!cancelled) {
        setFailed(false)
        setPlayback('loading')
      }
    })
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
        playerRef.current = new YT.Player(host, {
          videoId,
          width: 200,
          height: 200,
          playerVars: { autoplay: 1, controls: 0, playsinline: 1, rel: 0 },
          events: {
            onReady: (event) => {
              event.target.setVolume(duckedRef.current ? VOLUME_DUCKED : VOLUME_NORMAL)
              event.target.playVideo()
            },
            onStateChange: (event) => {
              // 1 — играет, 2 — пауза, 0 — закончился
              if (event.data === 1) setPlayback('playing')
              else if (event.data === 2) setPlayback('paused')
              else if (event.data === 0) {
                setPlayback('idle')
                handlersRef.current.onEnded?.()
              }
            },
            onError: () => handlersRef.current.onError?.(),
          },
        })
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
          setPlayback('idle')
        }
      })
    return () => {
      cancelled = true
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
  const duck = useCallback((on: boolean) => {
    duckedRef.current = on
    try {
      playerRef.current?.setVolume(on ? VOLUME_DUCKED : VOLUME_NORMAL)
    } catch {
      // плеер мог пересоздаваться — не страшно
    }
  }, [])

  return { playback, failed, toggle, duck, containerId }
}
