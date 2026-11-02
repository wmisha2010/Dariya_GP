'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { YtPlayback } from '@/hooks/use-youtube-audio'

export interface UseAudioPlayerOptions {
  /** Прямой URL аудиопотока; null — плеер выключен */
  src: string | null
  /** Трек закончился — включаем следующий */
  onEnded?: () => void
  /** Поток не играет (умер, формат не тот) — пропускаем */
  onError?: () => void
}

/** Доля громкости, пока говорит Дария */
const DUCK_VOLUME = 0.2

/**
 * Фоновый аудиоплеер на HTMLAudioElement: играет прямые потоки из интернета
 * (Audius, интернет-радио) без видео. Умеет пауза/продолжить и приглушение
 * громкости на время голоса ассистента.
 */
export function useAudioPlayer({ src, onEnded, onError }: UseAudioPlayerOptions) {
  const [playback, setPlayback] = useState<YtPlayback>('idle')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const duckedRef = useRef(false)
  const handlersRef = useRef({ onEnded, onError })
  // Держим актуальные колбэки вне рендера — события элемента всегда зовут свежие
  useEffect(() => {
    handlersRef.current = { onEnded, onError }
  })

  useEffect(() => {
    if (!src) {
      audioRef.current?.pause()
      audioRef.current = null
      // setState отложен в микрозадачу — не в теле эффекта (react-hooks)
      queueMicrotask(() => setPlayback('idle'))
      return
    }
    queueMicrotask(() => setPlayback('loading'))
    const audio = new Audio()
    audio.src = src
    audio.preload = 'auto'
    audio.volume = duckedRef.current ? DUCK_VOLUME : 1
    audioRef.current = audio

    const onPlaying = () => setPlayback('playing')
    const onPaused = () => setPlayback('paused')
    const handleEnded = () => {
      setPlayback('idle')
      handlersRef.current.onEnded?.()
    }
    const handleError = () => {
      setPlayback('idle')
      handlersRef.current.onError?.()
    }
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPaused)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)
    // Пользователь уже взаимодействовал со страницей — автозапуск звука разрешён
    audio.play().catch(() => setPlayback('idle'))

    return () => {
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('pause', onPaused)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
      audio.pause()
      audio.src = ''
      audioRef.current = null
    }
  }, [src])

  /** Пауза / продолжить (кнопка на панели и голосовая команда «пауза») */
  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().catch(() => setPlayback('idle'))
    } else {
      audio.pause()
    }
  }, [])

  /** Приглушить музыку на время голоса ассистента */
  const duck = useCallback((on: boolean) => {
    duckedRef.current = on
    if (audioRef.current) audioRef.current.volume = on ? DUCK_VOLUME : 1
  }, [])

  return { playback, toggle, duck }
}
