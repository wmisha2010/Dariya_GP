'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseTtsQueueOptions {
  /** Базовая высота голоса персонажа (1.0 — нейтрально) */
  pitch?: number
  /** Базовая скорость речи персонажа */
  rate?: number
  /** Пол голоса: помогает выбрать мужской/женский системный голос */
  gender?: 'female' | 'male'
  /** Вызывается, когда вся очередь озвучена */
  onFinish?: () => void
}

type Emotion = 'neutral' | 'excited' | 'question' | 'sympathy' | 'thoughtful'

interface EmotionProfile {
  /** Множитель высоты тона */
  pitch: number
  /** Множитель темпа */
  rate: number
  /** Пауза после фразы, мс */
  pause: number
}

/**
 * Эмоциональные профили: как меняются тон, темп и паузы в зависимости от
 * настроения фразы. Перемножаются с базовыми параметрами персонажа.
 */
const EMOTION_PROFILES: Record<Emotion, EmotionProfile> = {
  neutral: { pitch: 1.0, rate: 1.0, pause: 160 },
  excited: { pitch: 1.15, rate: 1.06, pause: 230 },
  question: { pitch: 1.07, rate: 0.98, pause: 300 },
  sympathy: { pitch: 0.93, rate: 0.9, pause: 340 },
  thoughtful: { pitch: 0.97, rate: 0.93, pause: 400 },
}

const EXCITED_RE =
  /(ура|здорово|отлично|класс|круто|супер|обожаю|прекрасно|замечательно|восхитительно|великолепно|получилось|молодец|с удовольствием|с радостью)/i
const SYMPATHY_RE =
  /(жаль|грустно|сочувствую|переживаю|устал|тяжело|извини|прости|сожалею|не грусти|держись|обнимаю|болею за тебя|как ты)/i
const THOUGHTFUL_RE = /(хм+|так-так|интересно|любопытно|давай подумаем|знаешь что|смотри|загадка)/i
const EMOJI_RE = /[\p{Extended_Pictographic}\u200d\uFE0F\u20E3]/gu

const FEMALE_HINTS = /(svetlana|milena|alena|katya|katia|irina|tatyana|female|жен)/i
const MALE_HINTS = /(yuri|dmitri|pavel|dariy|artemiy|aleksei|alexey|male|муж)/i

const PUMP_TICK_MS = 80
const SENTENCE_END = /[.!?…]$/
/** Сколько ждём появления системных голосов перед первой озвучкой */
const VOICES_WAIT_MS = 1500

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Детерминированный микро-джиттер ±amp: голос живее, чем ровный «робот» */
function jitter(text: string, amp: number): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const unit = ((h >>> 0) % 1000) / 1000
  return 1 + (unit - 0.5) * 2 * amp
}

/** Определяем настроение фразы по знакам и ключевым словам */
function detectEmotion(raw: string): Emotion {
  const s = raw.trim()
  const t = s.toLowerCase()
  const bangs = (s.match(/!/g) ?? []).length
  if (bangs >= 2) return 'excited'
  if (bangs >= 1 && EXCITED_RE.test(t)) return 'excited'
  if (s.endsWith('?') || s.endsWith('?..')) return 'question'
  if (SYMPATHY_RE.test(t)) return 'sympathy'
  if (s.includes('…') || s.endsWith('...') || THOUGHTFUL_RE.test(t)) return 'thoughtful'
  return 'neutral'
}

/** Чистим фразу от markdown, эмодзи и ссылок — в голос они не нужны */
function cleanForSpeech(text: string): string {
  return text
    .replace(/`{3}[\s\S]*?`{3}/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'ссылка')
    .replace(/[*_~#>|]+/g, '')
    .replace(EMOJI_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Выбираем лучший русский голос: нейроголоса Edge/Chrome в приоритете */
function pickVoice(synth: SpeechSynthesis, gender: 'female' | 'male' | undefined): SpeechSynthesisVoice | null {
  const ru = synth
    .getVoices()
    .filter((v) => v.lang?.toLowerCase().startsWith('ru'))
  if (ru.length === 0) return null
  const score = (v: SpeechSynthesisVoice): number => {
    const n = v.name.toLowerCase()
    let s = 0
    if (/natural|neural/.test(n)) s += 6
    if (/google/.test(n)) s += 5
    if (/premium|enhanced/.test(n)) s += 3
    if (v.localService) s += 1
    if (gender === 'female') {
      if (FEMALE_HINTS.test(n)) s += 4
      if (MALE_HINTS.test(n)) s -= 4
    } else if (gender === 'male') {
      if (MALE_HINTS.test(n)) s += 4
      if (FEMALE_HINTS.test(n)) s -= 4
    }
    if (/espeak/.test(n)) s -= 8
    return s
  }
  return ru.sort((a, b) => score(b) - score(a))[0] ?? null
}

/**
 * Потоковая очередь озвучки русским голосом через системный синтез речи
 * (Web Speech API). Текст добавляется частями (enqueue) во время стриминга:
 * завершённые предложения сразу уходят в очередь. Эмоции: высота тона,
 * темп и паузы подстраиваются под настроение каждой фразы. Мгновенная
 * остановка (перебивание) через stop().
 */
export function useTtsQueue(options: UseTtsQueueOptions = {}) {
  const { pitch = 1, rate = 1, gender = 'female', onFinish } = options

  const [speaking, setSpeaking] = useState(false)
  const [voiceName, setVoiceName] = useState<string | null>(null)
  const [voiceCount, setVoiceCount] = useState(0)
  const [voiceSupported, setVoiceSupported] = useState(true)

  const generationRef = useRef(0)
  const queueRef = useRef<string[]>([])
  const pendingRef = useRef('')
  const streamEndedRef = useRef(false)
  const pumpingRef = useRef(false)
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const optsRef = useRef({ pitch, rate, gender, onFinish })

  useEffect(() => {
    optsRef.current = { pitch, rate, gender, onFinish }
  }, [pitch, rate, gender, onFinish])

  // ─── Загрузка списка голосов (в Chrome приходит асинхронно) ─────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setVoiceSupported(false)
      return
    }
    const synth = window.speechSynthesis
    const update = () => {
      const ru = synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('ru'))
      voicesRef.current = ru
      setVoiceCount(ru.length)
    }
    update()
    synth.addEventListener('voiceschanged', update)
    // Подстраховка: некоторые браузеры не всегда присылают voiceschanged
    const timers = [250, 800, 2000, 4000].map((ms) => setTimeout(update, ms))
    return () => {
      synth.removeEventListener('voiceschanged', update)
      timers.forEach(clearTimeout)
    }
  }, [])

  // Отражаем выбранную голосовую персону (для подсказки в интерфейсе)
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const voice = pickVoice(window.speechSynthesis, gender)
    setVoiceName(voice?.name ?? null)
  }, [gender, voiceCount])

  const stop = useCallback(() => {
    generationRef.current++
    pumpingRef.current = false
    streamEndedRef.current = true
    queueRef.current = []
    pendingRef.current = ''
    utterRef.current = null
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setSpeaking(false)
  }, [])

  const finish = (generation: number) => {
    if (generation !== generationRef.current) return
    pumpingRef.current = false
    setSpeaking(false)
    optsRef.current.onFinish?.()
  }

  /** Ждём загрузки голосов перед первой фразой (иначе Chrome промолчит) */
  const waitVoicesReady = async (generation: number): Promise<void> => {
    if (voicesRef.current.length > 0) return
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const synth = window.speechSynthesis
    const deadline = Date.now() + VOICES_WAIT_MS
    while (voicesRef.current.length === 0 && Date.now() < deadline) {
      await sleep(100)
      if (generation !== generationRef.current) return
      voicesRef.current = synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('ru'))
    }
  }

  /** Произносим одну фразу с эмоциональными параметрами */
  const speakUtterance = useCallback((text: string, generation: number): Promise<void> => {
    return new Promise<void>((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve()
        return
      }
      const synth = window.speechSynthesis
      const voice = pickVoice(synth, optsRef.current.gender)
      if (!voice) {
        // Русских голосов нет (headless-браузер / пустая система) — пропускаем молча
        resolve()
        return
      }

      const prof = EMOTION_PROFILES[detectEmotion(text)]
      const u = new SpeechSynthesisUtterance(text)
      u.voice = voice
      u.lang = voice.lang || 'ru-RU'
      u.pitch = clamp(optsRef.current.pitch * prof.pitch * jitter(text, 0.035), 0.2, 1.9)
      u.rate = clamp(optsRef.current.rate * prof.rate * jitter(`${text}·r`, 0.025), 0.55, 1.8)
      u.volume = 1

      let settled = false
      const finishOnce = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (utterRef.current === u) utterRef.current = null
        resolve()
      }
      // Страховка: редкие движки не вызывают onend — считаем время по длине
      const estimated = (text.length / 11) * 1000 / Math.max(u.rate, 0.5)
      const timer = setTimeout(finishOnce, estimated + 4000)
      u.onend = finishOnce
      u.onerror = () => finishOnce()

      utterRef.current = u
      try {
        synth.speak(u)
      } catch {
        finishOnce()
      }
    })
  }, [])

  /** Насос очереди: берёт предложения и озвучивает их по порядку */
  const pump = useCallback(
    async (generation: number) => {
      if (pumpingRef.current) return
      pumpingRef.current = true
      setSpeaking(true)

      try {
        await waitVoicesReady(generation)
        while (generation === generationRef.current) {
          const sentence = queueRef.current.shift()
          if (sentence === undefined) {
            if (streamEndedRef.current) break
            await sleep(PUMP_TICK_MS)
            continue
          }

          const clean = cleanForSpeech(sentence)
          if (clean) {
            await speakUtterance(clean, generation)
            if (generation !== generationRef.current) return
          }

          // Живая пауза между фразами (зависит от эмоции и финального знака)
          const hasMore =
            queueRef.current.length > 0 || !streamEndedRef.current || pendingRef.current.length > 0
          if (hasMore) {
            const prof = EMOTION_PROFILES[detectEmotion(clean || sentence)]
            const tail = /[…]$/.test(clean || sentence) ? 160 : 0
            await sleep(prof.pause + tail)
          }
        }
        finish(generation)
      } finally {
        pumpingRef.current = false
      }
    },
    [speakUtterance]
  )

  const splitIntoSentences = (text: string): string[] => {
    return text
      .replace(/[*_`#]+/g, '')
      .split(/(?<=[.!?…])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

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

  // Прогреваем список голосов по первому взаимодействию (политики автоплея)
  useEffect(() => {
    const warmup = () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.getVoices()
      }
    }
    window.addEventListener('pointerdown', warmup, { once: true })
    window.addEventListener('keydown', warmup, { once: true })
    return () => {
      window.removeEventListener('pointerdown', warmup)
      window.removeEventListener('keydown', warmup)
    }
  }, [])

  useEffect(() => stop, [stop])

  return { speak, enqueue, endStream, stop, speaking, voiceName, voiceSupported }
}
