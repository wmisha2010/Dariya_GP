'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseTtsQueueOptions {
  /** 'server' — нейроголос через /api/tts (основной), 'browser' — сразу системный синтез */
  mode?: 'server' | 'browser'
  pitch?: number
  rate?: number
  /** Вызывается, когда вся очередь озвучена */
  onFinish?: () => void
}

const PUMP_TICK_MS = 80
const SENTENCE_END = /[.!?…]$/

/**
 * Потоковая очередь озвучки. Текст добавляется частями (enqueue) во время
 * стриминга ответа: завершённые предложения сразу уходят в очередь речи,
 * незавершённый хвост ждёт следующих частей. Озвучка — серверным нейроголосом
 * последовательно, при сбое — системный speechSynthesis. Мгновенная остановка
 * (перебивание) через stop().
 */
export function useTtsQueue(options: UseTtsQueueOptions = {}) {
  const { mode = 'server', pitch = 1, rate = 1, onFinish } = options

  const [speaking, setSpeaking] = useState(false)

  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const queueRef = useRef<string[]>([])
  const pendingRef = useRef('')
  const fullRef = useRef('')
  const streamEndedRef = useRef(false)
  const pumpingRef = useRef(false)
  const serverFailedRef = useRef(false)
  const optsRef = useRef({ pitch, rate, onFinish })

  useEffect(() => {
    optsRef.current = { pitch, rate, onFinish }
  }, [pitch, rate, onFinish])

  const ensureCtx = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      ctxRef.current = new Ctor()
    }
    if (ctxRef.current.state === 'suspended') {
      void ctxRef.current.resume()
    }
    return ctxRef.current
  }, [])

  const stop = useCallback(() => {
    generationRef.current++
    pumpingRef.current = false
    streamEndedRef.current = true
    queueRef.current = []
    pendingRef.current = ''
    fullRef.current = ''
    abortRef.current?.abort()
    abortRef.current = null
    if (sourceRef.current) {
      try {
        sourceRef.current.stop()
      } catch {
        /* ignore */
      }
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setSpeaking(false)
  }, [])

  const splitIntoSentences = (text: string): string[] => {
    return text
      .replace(/[*_`#]+/g, '')
      .split(/(?<=[.!?…])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  /** Проигрывает WAV-буфер и ждёт окончания */
  const playWav = useCallback(
    (bytes: ArrayBuffer, generation: number): Promise<void> => {
      return new Promise((resolve, reject) => {
        const ctx = ensureCtx()
        if (!ctx) {
          reject(new Error('WebAudio недоступен'))
          return
        }
        ctx
          .decodeAudioData(bytes)
          .then((buffer) => {
            if (generation !== generationRef.current) {
              resolve()
              return
            }
            const source = ctx.createBufferSource()
            source.buffer = buffer
            sourceRef.current = source
            source.onended = () => {
              if (sourceRef.current === source) sourceRef.current = null
              resolve()
            }
            source.connect(ctx.destination)
            source.start()
          })
          .catch(reject)
      })
    },
    [ensureCtx]
  )

  /** Системный синтез речи (запасной путь) */
  const speakBrowser = useCallback((text: string, generation: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        reject(new Error('speechSynthesis недоступен'))
        return
      }
      const synth = window.speechSynthesis
      synth.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'ru-RU'
      utterance.pitch = optsRef.current.pitch
      utterance.rate = optsRef.current.rate
      const voices = synth.getVoices()
      const ruVoice = voices.find((v) => v.lang?.toLowerCase().startsWith('ru'))
      if (ruVoice) utterance.voice = ruVoice
      utterance.onend = () => resolve()
      utterance.onerror = (event) => {
        if (event.error === 'interrupted' || event.error === 'canceled') resolve()
        else reject(new Error(event.error))
      }
      synth.speak(utterance)
    })
  }, [])

  const finish = (generation: number) => {
    if (generation !== generationRef.current) return
    pumpingRef.current = false
    setSpeaking(false)
    optsRef.current.onFinish?.()
  }

  /** Насос очереди: берёт предложения и озвучивает их по порядку */
  const pump = useCallback(
    async (generation: number) => {
      if (pumpingRef.current) return
      pumpingRef.current = true
      setSpeaking(true)

      try {
        while (generation === generationRef.current) {
          const sentence = queueRef.current.shift()
          if (sentence === undefined) {
            if (streamEndedRef.current) break
            await new Promise((r) => setTimeout(r, PUMP_TICK_MS))
            continue
          }

          fullRef.current += (fullRef.current ? ' ' : '') + sentence

          if (mode === 'browser' || serverFailedRef.current) {
            await speakBrowser(sentence, generation)
            continue
          }

          try {
            const controller = new AbortController()
            abortRef.current = controller
            const res = await fetch('/api/tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: sentence.slice(0, 500) }),
              signal: controller.signal,
            })
            if (!res.ok) throw new Error(`TTS ${res.status}`)
            const bytes = await res.arrayBuffer()
            if (generation !== generationRef.current) return
            await playWav(bytes, generation)
            // Небольшая пауза между фразами: бережём лимиты TTS API
            await new Promise((r) => setTimeout(r, 250))
          } catch (error) {
            if (generation !== generationRef.current) return
            if (error instanceof DOMException && error.name === 'AbortError') return
            // Серверный голос не сработал — переключаемся на системный синтез
            serverFailedRef.current = true
            try {
              await speakBrowser(fullRef.current, generation)
              fullRef.current = ''
            } catch {
              if (generation !== generationRef.current) return
            }
          }
        }
        finish(generation)
      } finally {
        pumpingRef.current = false
      }
    },
    [mode, playWav, speakBrowser]
  )

  /**
   * Добавить текст в очередь озвучки. Можно вызывать многократно по мере
   * прихода стрима. Завершённые предложения начинают озвучиваться сразу.
   */
  const enqueue = useCallback(
    (text: string) => {
      if (!text.trim()) return
      // Новая фраза — новая сессия озвучки
      if (!pumpingRef.current && queueRef.current.length === 0 && pendingRef.current === '') {
        generationRef.current++
        fullRef.current = ''
        serverFailedRef.current = false
        streamEndedRef.current = false
      }
      pendingRef.current = `${pendingRef.current} ${text}`.trim()
      const sentences = splitIntoSentences(pendingRef.current)
      if (sentences.length === 0) return
      const last = sentences[sentences.length - 1]
      if (SENTENCE_END.test(last)) {
        // Хвост завершён — уходит в очередь целиком
        pendingRef.current = ''
        queueRef.current.push(...sentences)
      } else {
        const tail = sentences.pop()
        queueRef.current.push(...sentences)
        pendingRef.current = tail ?? ''
      }
      void pump(generationRef.current)
    },
    [pump]
  )

  /** Сообщить, что стрим закончен — доигрываем накопленный хвост */
  const endStream = useCallback(() => {
    if (pendingRef.current) {
      queueRef.current.push(pendingRef.current)
      pendingRef.current = ''
    }
    streamEndedRef.current = true
    void pump(generationRef.current)
  }, [pump])

  /** Озвучить готовый текст целиком (не из стрима) */
  const speak = useCallback(
    (text: string) => {
      stop()
      streamEndedRef.current = false
      enqueue(text)
      endStream()
    },
    [enqueue, endStream, stop]
  )

  // Разблокируем AudioContext по первому касанию (политики автоплея)
  useEffect(() => {
    const unlock = () => {
      ensureCtx()
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.getVoices()
      }
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [ensureCtx])

  useEffect(() => stop, [stop])

  return { speak, enqueue, endStream, stop, speaking }
}
