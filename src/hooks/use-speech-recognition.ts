'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Минимальные типы Web Speech API (нет в стандартных lib для всех браузеров)
interface SpeechRecognitionAlternativeLike {
  transcript: string
}
interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: SpeechRecognitionAlternativeLike
  length: number
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: { length: number; [index: number]: SpeechRecognitionResultLike }
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onstart: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

interface UseSpeechRecognitionOptions {
  lang?: string
  /** Вызывается при распознавании промежуточного результата */
  onInterim?: (text: string) => void
  /** Вызывается с финальным текстом фразы */
  onFinal?: (text: string) => void
  onError?: (error: string) => void
}

/**
 * Живое распознавание речи (Web Speech API).
 * Возвращает поддержку браузера и управление микрофоном.
 */
export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}) {
  const { lang = 'ru-RU', onInterim, onFinal, onError } = options
  const [supported, setSupported] = useState(true)
  const [listening, setListening] = useState(false)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const wantActiveRef = useRef(false)
  /** Микрофон приглушён (ассистент говорит) — намерение пользователя сохранено */
  const pausedRef = useRef(false)
  /** Последняя попытка start() — для backoff при мгновенных обрывах цикла */
  const lastStartAttemptRef = useRef(0)
  const optionsRef = useRef({ onInterim, onFinal, onError })

  useEffect(() => {
    optionsRef.current = { onInterim, onFinal, onError }
  }, [onInterim, onFinal, onError])

  useEffect(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      // Детекция возможностей браузера возможна только после монтирования
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupported(false)
      return
    }
    const recognition = new Ctor()
    recognition.lang = lang
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => setListening(true)

    recognition.onresult = (event) => {
      // Пока микрофон приглушён, всё услышанное — эхо, игнорируем
      if (pausedRef.current) return
      let interim = ''
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) final += transcript
        else interim += transcript
      }
      if (interim) optionsRef.current.onInterim?.(interim.trim())
      if (final.trim()) {
        optionsRef.current.onInterim?.('')
        const cleaned = final.trim()
        // Отсекаем галлюцинации тишины: фразы короче 2 символов без смысла
        const meaningful = cleaned.replace(/[\s.,!?-]/g, '')
        if (meaningful.length >= 2) {
          optionsRef.current.onFinal?.(cleaned)
        }
      }
    }

    recognition.onerror = (event) => {
      const code = event.error ?? 'unknown'
      // no-speech — нормальная ситуация, не сообщаем как ошибку
      if (code !== 'no-speech' && code !== 'aborted') {
        optionsRef.current.onError?.(code)
      }
    }

    recognition.onend = () => {
      setListening(false)
      // Перезапускаем, пока пользователь хочет слушать и микрофон не приглушён
      if (!wantActiveRef.current || pausedRef.current) return
      const restart = () => {
        if (!wantActiveRef.current || pausedRef.current) return
        lastStartAttemptRef.current = Date.now()
        try {
          recognition.start()
        } catch {
          // start() может бросить, если recognition ещё останавливается — попробуем позже
          setTimeout(restart, 350)
        }
      }
      // Если предыдущая попытка старта была меньше 600мс назад — сессии
      // обрываются мгновенно (нет аудиоустройства, сетевой сбой): не разгоняем
      // цикл перезапуска до сотен раз в секунду
      const sinceAttempt = Date.now() - lastStartAttemptRef.current
      if (sinceAttempt < 600) setTimeout(restart, 500)
      else restart()
    }

    recognitionRef.current = recognition
    return () => {
      wantActiveRef.current = false
      recognition.onend = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onstart = null
      try {
        recognition.abort()
      } catch {
        /* ignore */
      }
      recognitionRef.current = null
    }
  }, [lang])

  const start = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) return
    pausedRef.current = false
    wantActiveRef.current = true
    lastStartAttemptRef.current = Date.now()
    try {
      recognition.start()
      setListening(true)
    } catch {
      // уже запущен
    }
  }, [])

  const stop = useCallback(() => {
    wantActiveRef.current = false
    pausedRef.current = false
    try {
      recognitionRef.current?.stop()
    } catch {
      /* ignore */
    }
    setListening(false)
  }, [])

  /**
   * Приглушить микрофон, не теряя намерения пользователя (например, пока
   * ассистент говорит — иначе он услышит сам себя и ответит на свои слова).
   */
  const pause = useCallback(() => {
    if (!recognitionRef.current) return
    pausedRef.current = true
    try {
      recognitionRef.current.abort()
    } catch {
      /* ignore */
    }
    setListening(false)
  }, [])

  /** Вернуть микрофон, если пользователь его включал и не выключал сам */
  const resume = useCallback(() => {
    if (!pausedRef.current) return
    pausedRef.current = false
    if (!wantActiveRef.current) return
    const recognition = recognitionRef.current
    if (!recognition) return
    lastStartAttemptRef.current = Date.now()
    try {
      recognition.start()
    } catch {
      // recognition мог ещё останавливаться после abort — пробуем позже
      setTimeout(() => {
        if (wantActiveRef.current && !pausedRef.current) {
          try {
            recognitionRef.current?.start()
          } catch {
            /* ignore */
          }
        }
      }, 350)
    }
  }, [])

  return { supported, listening, start, stop, pause, resume }
}
