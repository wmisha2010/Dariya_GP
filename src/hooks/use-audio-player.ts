'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { YtPlayback } from '@/hooks/use-youtube-audio'

export interface UseAudioPlayerOptions {
  /** Прямой URL аудиопотока; null — плеер выключен */
  src: string | null
  /** Пользовательская громкость 0-100 (голосовая команда «громкость 40») */
  volume?: number
  /** Трек закончился — включаем следующий */
  onEnded?: () => void
  /** Поток не играет (умер, формат не тот) — пропускаем */
  onError?: () => void
}

/** Во сколько раз тише музыка, пока говорит Дария */
const DUCK_FACTOR = 0.2
/** Сколько ждём: не заиграл за это время — битый поток, листаем дальше;
 *  играет, но timeupdate замер на это время — поток заглох, листаем дальше */
const START_WATCHDOG_MS = 12_000

const clampVolume = (v: number) => Math.min(100, Math.max(0, Math.round(v)))

/**
 * Фоновый аудиоплеер на HTMLAudioElement: играет прямые потоки из интернета
 * (mp3.mn, интернет-радио — через стрим-прокси) без видео. Умеет пауза/
 * продолжить, громкость и приглушение на время голоса ассистента.
 * Битый поток не блокирует очередь: ошибка play() или тишина на старте
 * приводят к onError — плеер переходит к следующему треку.
 */
export function useAudioPlayer({ src, volume = 100, onEnded, onError }: UseAudioPlayerOptions) {
  const [playback, setPlayback] = useState<YtPlayback>('idle')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const duckedRef = useRef(false)
  const volumeRef = useRef(clampVolume(volume))
  const handlersRef = useRef({ onEnded, onError })
  // Держим актуальные колбэки вне рендера — события элемента всегда зовут свежие
  useEffect(() => {
    handlersRef.current = { onEnded, onError }
  })

  /** Эффективная громкость = пользовательская × коэффициент приглушения */
  const applyVolume = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    const factor = duckedRef.current ? DUCK_FACTOR : 1
    audio.volume = Math.min(1, (volumeRef.current / 100) * factor)
  }, [])

  useEffect(() => {
    volumeRef.current = clampVolume(volume)
    applyVolume()
  }, [volume, applyVolume])

  useEffect(() => {
    if (!src) {
      audioRef.current?.pause()
      audioRef.current = null
      // setState отложен в микрозадачу — не в теле эффекта (react-hooks)
      queueMicrotask(() => setPlayback('idle'))
      return
    }
    let dead = false
    queueMicrotask(() => setPlayback('loading'))
    const audio = new Audio()
    audio.src = src
    audio.preload = 'auto'
    audioRef.current = audio
    applyVolume()

    const fail = () => {
      if (dead) return
      dead = true
      setPlayback('idle')
      handlersRef.current.onError?.()
    }

    /* Сторожевой таймер — двусторонний:
     * · до первого «playing» — «поток не заиграл», листаем дальше;
     * · после старта — «поток заглох»: на каждом тике timeupdate
     *   перезаводим, перестал тикать (станция умерла) — через
     *   START_WATCHDOG_MS считаем трек битым.
     * Раньше таймер не выключался после старта и рубил ИГРАЮЩЕЕ радио
     * на 12-й секунде — выглядело как «сама переключила станцию». */
    let watchdog: ReturnType<typeof setTimeout> | null = null
    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog)
      watchdog = setTimeout(fail, START_WATCHDOG_MS)
    }
    const disarmWatchdog = () => {
      if (watchdog) {
        clearTimeout(watchdog)
        watchdog = null
      }
    }

    const onPlaying = () => {
      armWatchdog() // теперь сторожим тишину, а не старт
      setPlayback('playing')
    }
    const onPaused = () => {
      disarmWatchdog() // пауза — не ошибка, сторож не должен убить трек
      setPlayback('paused')
    }
    const onTimeUpdate = () => armWatchdog()
    const handleEnded = () => {
      disarmWatchdog()
      if (dead) return
      setPlayback('idle')
      handlersRef.current.onEnded?.()
    }
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPaused)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', fail)

    // Пользователь уже взаимодействовал со страницей — автозапуск звука разрешён.
    // Отказ play() (битый поток, NotAllowedError) — не молчим, а листаем дальше
    audio.play().catch(fail)

    // Страховка от «вечного»: поток подключился, но тишина (станция умерла,
    // прокси висит) — через таймаут считаем трек битым
    armWatchdog()

    return () => {
      dead = true
      disarmWatchdog()
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('pause', onPaused)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', fail)
      audio.pause()
      audio.src = ''
      audioRef.current = null
    }
  }, [src, applyVolume])

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
  const duck = useCallback(
    (on: boolean) => {
      duckedRef.current = on
      applyVolume()
    },
    [applyVolume]
  )

  return { playback, toggle, duck }
}
