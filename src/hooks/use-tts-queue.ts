'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseTtsQueueOptions {
  /** Базовая высота голоса персонажа (1.0 — нейтрально) — для системного синтеза */
  pitch?: number
  /** Базовая скорость речи персонажа — для системного синтеза */
  rate?: number
  /** Пол голоса: мужской тембр ниже (замедление + браузерный выбор голоса) */
  gender?: 'female' | 'male'
  /** Вызывается, когда вся очередь озвучена */
  onFinish?: () => void
}

type Emotion = 'neutral' | 'excited' | 'question' | 'sympathy' | 'thoughtful'

/**
 * Эмоциональные профили серверного нейроголоса: множитель скорости
 * воспроизведения. Изменение playbackRate сдвигает и темп, и высоту тона —
 * это даёт естественную живую просодию (радость бодрее и выше, сочувствие
 * мягче и ниже).
 */
const SERVER_EMOTION_RATE: Record<Emotion, number> = {
  neutral: 1.0,
  excited: 1.08,
  question: 1.03,
  sympathy: 0.92,
  thoughtful: 0.9,
}

/** Эмоциональные профили системного синтеза (fallback) */
const BROWSER_EMOTION_PROFILE: Record<Emotion, { pitch: number; rate: number; pause: number }> = {
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
/** Ждём появления системных голосов перед fallback-озвучкой */
const VOICES_WAIT_MS = 1500
/** Мягкий лимит длины фразы: Google TTS режет по ~200 символов */
const MAX_SENTENCE_CHARS = 185
/** Сколько серверных неудач подряд переводят голос в cooldown */
const SERVER_FAIL_THRESHOLD = 2
/** Длительность cooldown серверного голоса после неудач */
const SERVER_COOLDOWN_MS = 90_000

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

/** Выбираем лучший русский голос для fallback-синтеза */
function pickVoice(
  synth: SpeechSynthesis,
  gender: 'female' | 'male' | undefined
): SpeechSynthesisVoice | null {
  const ru = synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('ru'))
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
 * Потоковая очередь озвучки. Основной путь — серверный нейроголос (Google RU)
 * с эмоциональной просодией через Web Audio (playbackRate меняет темп и тон).
 * При сбое — автоматический fallback на системный синтез речи. Текст
 * добавляется частями (enqueue) во время стриминга: завершённые предложения
 * звучат сразу. Мгновенная остановка (перебивание) через stop().
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
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const serverFailCountRef = useRef(0)
  const serverCooldownUntilRef = useRef(0)
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

  // Отражаем выбранную резервную голосовую персону (для подсказки в UI)
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const voice = pickVoice(window.speechSynthesis, gender)
    setVoiceName(voice?.name ?? null)
  }, [gender, voiceCount])

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
    utterRef.current = null
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

  const finish = (generation: number) => {
    if (generation !== generationRef.current) return
    pumpingRef.current = false
    setSpeaking(false)
    optsRef.current.onFinish?.()
  }

  /** Ждём загрузки голосов перед fallback-фразой (иначе Chrome промолчит) */
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

  /** Проигрываем MP3 с сервера с эмоциональным playbackRate */
  const playServerAudio = useCallback(
    async (bytes: ArrayBuffer, sentence: string, generation: number): Promise<void> => {
      const ctx = ensureCtx()
      if (!ctx) throw new Error('WebAudio недоступен')
      // Если контекст не ожил (нет активации пользователя, политика
      // автовоспроизведения) — бросаем ошибку и уходим в системный fallback:
      // иначе насос очереди зависнет навсегда на источнике, который молчит
      if (ctx.state !== 'running') {
        try {
          await ctx.resume()
        } catch {
          /* ignore */
        }
        if (ctx.state !== 'running') throw new Error('AudioContext не активен')
      }
      const buffer = await ctx.decodeAudioData(bytes)
      if (generation !== generationRef.current) return

      const emotion = detectEmotion(sentence)
      const genderFactor = optsRef.current.gender === 'male' ? 0.92 : 1.0
      const playbackRate = clamp(
        SERVER_EMOTION_RATE[emotion] * genderFactor * jitter(sentence, 0.02),
        0.5,
        1.6
      )
      return new Promise<void>((resolve) => {
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.playbackRate.value = playbackRate
        sourceRef.current = source
        let settled = false
        const finishOnce = () => {
          if (settled) return
          settled = true
          clearTimeout(watchdog)
          if (sourceRef.current === source) sourceRef.current = null
          resolve()
        }
        // Страховка: если onended не придёт (подвисший контекст/устройство) —
        // развязываем насос по времени чуть больше длительности звука
        const watchdog = setTimeout(() => {
          try {
            source.stop()
          } catch {
            /* ignore */
          }
          finishOnce()
        }, (buffer.duration / Math.max(playbackRate, 0.5)) * 1000 + 4000)
        source.onended = finishOnce
        source.connect(ctx.destination)
        source.start()
      })
    },
    [ensureCtx]
  )

  /** Озвучиваем фразу системным синтезом (fallback) с эмоциональными параметрами */
  const speakBrowser = useCallback((text: string, generation: number): Promise<void> => {
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

      const prof = BROWSER_EMOTION_PROFILE[detectEmotion(text)]
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

  /** Озвучка одной фразы: серверный нейроголос, при сбое — системный */
  const speakSentence = useCallback(
    async (sentence: string, generation: number): Promise<void> => {
      const clean = cleanForSpeech(sentence)
      if (!clean) return

      const cooldownActive = Date.now() < serverCooldownUntilRef.current
      if (!cooldownActive) {
        // Таймаут fetch: подвисший запрос не должен блокировать очередь озвучки
        const controller = new AbortController()
        const fetchTimeout = setTimeout(() => controller.abort(), 10_000)
        try {
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: clean.slice(0, 800) }),
            signal: controller.signal,
          })
          if (!res.ok) throw new Error(`TTS ${res.status}`)
          const bytes = await res.arrayBuffer()
          clearTimeout(fetchTimeout)
          if (generation !== generationRef.current) return
          await playServerAudio(bytes, clean, generation)
          serverFailCountRef.current = 0
          return
        } catch (error) {
          clearTimeout(fetchTimeout)
          if (generation !== generationRef.current) return
          // Серверный голос не сработал (в т.ч. таймаут) — копим неудачи
          // и включаем cooldown, фразу произнесёт системный синтез
          serverFailCountRef.current++
          if (serverFailCountRef.current >= SERVER_FAIL_THRESHOLD) {
            serverCooldownUntilRef.current = Date.now() + SERVER_COOLDOWN_MS
            serverFailCountRef.current = 0
          }
        }
      }

      await waitVoicesReady(generation)
      if (generation !== generationRef.current) return
      await speakBrowser(clean, generation)
    },
    [playServerAudio, speakBrowser]
  )

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
            await sleep(PUMP_TICK_MS)
            continue
          }

          await speakSentence(sentence, generation)
          if (generation !== generationRef.current) return

          // Живая пауза между фразами (зависит от эмоции и финального знака)
          const hasMore =
            queueRef.current.length > 0 || !streamEndedRef.current || pendingRef.current.length > 0
          if (hasMore) {
            const clean = cleanForSpeech(sentence) || sentence
            const prof = BROWSER_EMOTION_PROFILE[detectEmotion(clean)]
            const tail = /[…]$/.test(clean) ? 160 : 0
            await sleep(prof.pause + tail)
          }
        }
        finish(generation)
      } finally {
        pumpingRef.current = false
      }
    },
    [speakSentence]
  )

  const splitIntoSentences = (text: string): string[] => {
    const raw = text
      .replace(/[*_`#]+/g, '')
      .split(/(?<=[.!?…])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
    // Длинные предложения дополнительно режем по пробелам — Google TTS
    // принимает короткие фрагменты, а паузы между кусками звучат естественно
    const result: string[] = []
    for (const sentence of raw) {
      if (sentence.length <= MAX_SENTENCE_CHARS) {
        result.push(sentence)
        continue
      }
      let rest = sentence
      while (rest.length > MAX_SENTENCE_CHARS) {
        let cut = rest.lastIndexOf(' ', MAX_SENTENCE_CHARS)
        if (cut < 60) cut = rest.lastIndexOf(',', MAX_SENTENCE_CHARS)
        if (cut < 30) cut = MAX_SENTENCE_CHARS
        result.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
      }
      if (rest) result.push(rest)
    }
    return result
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

  // Прогреваем список голосов и аудиоконтекст по первому взаимодействию
  useEffect(() => {
    const warmup = () => {
      ensureCtx()
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
  }, [ensureCtx])

  useEffect(() => stop, [stop])

  return { speak, enqueue, endStream, stop, speaking, voiceName, voiceSupported }
}
