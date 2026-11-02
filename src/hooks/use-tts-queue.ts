'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseTtsQueueOptions {
  /** Вызывается, когда вся очередь озвучена */
  onFinish?: () => void
  /** Браузер заблокировал звук (autoplay-политика) — фразы ждут касания экрана.
   * Вызывается один раз на эпизод блокировки */
  onPlaybackBlocked?: () => void
  /** Выбранный пользователем голос (id из белого списка сервера).
   * Меняется только вручную — тембр в разговоре сам не «скачет» */
  voiceId?: string
}

/** Подписи голосов для тултипа в UI (белый список = /api/tts) */
const VOICE_LABELS: Record<string, string> = {
  svetlana: 'Microsoft SvetlanaNeural (Edge)',
  irina: 'Piper Irina (локальный голос)',
}
const DEFAULT_VOICE_ID = 'svetlana'

type Emotion = 'neutral' | 'excited' | 'question' | 'sympathy' | 'thoughtful'

/**
 * Эмоциональные профили серверного нейроголоса (Edge SvetlanaNeural):
 * абсолютные значения скорости (%) и высоты тона (Гц) для SSML-просодии.
 * Просодия на стороне синтеза звучит естественно, в отличие от смены playbackRate.
 */
const SERVER_EMOTION_PROSODY: Record<Emotion, { rate: number; pitch: number }> = {
  neutral: { rate: 12, pitch: 2 },
  excited: { rate: 20, pitch: 12 },
  question: { rate: 14, pitch: 8 },
  sympathy: { rate: 8, pitch: -6 },
  thoughtful: { rate: 7, pitch: -8 },
}

/**
 * Пауза между предложениями (мс). Нейроголос уже интонирует конец фразы,
 * поэтому пауза короткая — длинные технические зазоры звучат как «затык».
 * Реальный зазор = пауза + хвостовая тишина внутри MP3 (~80-120мс).
 */
const INTER_PHRASE_PAUSE: Record<Emotion, number> = {
  neutral: 70,
  excited: 50,
  question: 110,
  sympathy: 150,
  thoughtful: 170,
}

const EXCITED_RE =
  /(ура|здорово|отлично|класс|круто|супер|обожаю|прекрасно|замечательно|восхитительно|великолепно|получилось|молодец|с удовольствием|с радостью)/i
const SYMPATHY_RE =
  /(жаль|грустно|сочувствую|переживаю|устал|тяжело|извини|прости|сожалею|не грусти|держись|обнимаю|болею за тебя|как ты)/i
const THOUGHTFUL_RE = /(хм+|так-так|интересно|любопытно|давай подумаем|знаешь что|смотри|загадка)/i
const EMOJI_RE = /[\p{Extended_Pictographic}\u200d\uFE0F\u20E3]/gu

const PUMP_TICK_MS = 40
const SENTENCE_END = /[.!?…]$/
/** Сколько фраз одновременно качаем фоном (сокет Edge мультиплексируется по requestId) */
const MAX_PREFETCH = 3

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Мягкий лимит длины фразы: Edge Neural спокойно тянет длинные фрагменты,
 * а меньше кусков — меньше технических пауз между ними */
const MAX_SENTENCE_CHARS = 260

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

/** Чистим фразу от markdown, эмодзи, ссылок и служебных тегов моделей —
 * в голос они не нужны */
function cleanForSpeech(text: string): string {
  return text
    .replace(/`{3}[\s\S]*?`{3}/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'ссылка')
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]{0,24}>\s*/g, ' ')
    .replace(/[*_~#>|]+/g, '')
    .replace(EMOJI_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Потоковая очередь озвучки. Единственный провайдер — серверный нейроголос
 * Microsoft Edge с эмоциональной SSML-просодией; конкретный голос выбирает
 * пользователь вручную (voiceId). Никаких резервных синтезаторов: при сбое
 * сети фраза повторно качается, а если сервер совсем недоступен — фраза
 * пропускается молча, но тембр в разговоре никогда не меняется сам. Текст
 * добавляется частями (enqueue) во время стриминга: завершённые предложения
 * звучат сразу. Мгновенная остановка (перебивание) через stop().
 *
 * Autoplay-политика: если браузер держит AudioContext заблокированным (свежая
 * вкладка без «доверенных» взаимодействий — в отличие от iframe предпросмотра),
 * очередь НЕ пропускает фразы молча, а встаёт на паузу: показываем подсказку,
 * а после первого касания экрана продолжаем говорить ровно с прерванного места.
 */
export function useTtsQueue(options: UseTtsQueueOptions = {}) {
  const { onFinish, onPlaybackBlocked } = options
  const voiceId = options.voiceId ?? DEFAULT_VOICE_ID

  const [speaking, setSpeaking] = useState(false)
  /** true, когда звук заблокирован браузером и мы ждём касания экрана */
  const [blocked, setBlocked] = useState(false)
  const voiceName = VOICE_LABELS[voiceId] ?? VOICE_LABELS[DEFAULT_VOICE_ID]

  const generationRef = useRef(0)
  const queueRef = useRef<string[]>([])
  const pendingRef = useRef('')
  const streamEndedRef = useRef(false)
  const pumpingRef = useRef(false)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  /** Prefetch: аудио фраз, скачанных заранее — убирает паузы между предложениями.
   * Ключ включает голос, чтобы после ручной смены голоса не играли старые фразы */
  const audioPrefetchRef = useRef(new Map<string, Promise<ArrayBuffer | null>>())
  const inflightPrefetchRef = useRef(0)
  const optsRef = useRef({ onFinish, onPlaybackBlocked, voiceId })
  const blockedRef = useRef(false)
  /** Разблокировка по statechange контекста: присваивается после объявления pump */
  const tryUnblockRef = useRef<() => void>(() => {})

  useEffect(() => {
    optsRef.current = { onFinish, onPlaybackBlocked, voiceId }
  }, [onFinish, onPlaybackBlocked, voiceId])

  const ensureCtx = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      ctxRef.current = new Ctor()
      // Контекст снова разрешён (вернулись на вкладку, дали разрешение
      // микрофону и т.п.) — снимаем блокировку и продолжаем говорить
      ctxRef.current.onstatechange = () => {
        if ((ctxRef.current?.state as string) === 'running') tryUnblockRef.current()
      }
    }
    // 'interrupted' на части Safari тоже нужно будить — будим всё, кроме running
    if (ctxRef.current.state !== 'running') {
      void ctxRef.current.resume().catch(() => {
        /* разблокируем жестом */
      })
    }
    return ctxRef.current
  }, [])

  const stop = useCallback(() => {
    generationRef.current++
    pumpingRef.current = false
    streamEndedRef.current = true
    blockedRef.current = false
    setBlocked(false)
    queueRef.current = []
    pendingRef.current = ''
    audioPrefetchRef.current.clear()
    if (sourceRef.current) {
      try {
        sourceRef.current.stop()
      } catch {
        /* ignore */
      }
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    setSpeaking(false)
  }, [])

  const finish = (generation: number) => {
    if (generation !== generationRef.current) return
    pumpingRef.current = false
    setSpeaking(false)
    optsRef.current.onFinish?.()
  }

  /** Проигрываем MP3 с сервера (просодия эмоций уже в SSML на сервере) */
  const playServerAudio = useCallback(
    async (bytes: ArrayBuffer, sentence: string, generation: number): Promise<void> => {
      const ctx = ensureCtx()
      if (!ctx) throw new Error('WebAudio недоступен')
      // Если контекст не ожил (нет активации пользователя, политика
      // автовоспроизведения) — бросаем ошибку и фразу пропускаем:
      // иначе насос очереди зависнет навсегда на источнике, который молчит
      // (state приводим к string: lib-типы окружения не знают 'running')
      if ((ctx.state as string) !== 'running') {
        try {
          await ctx.resume()
        } catch {
          /* ignore */
        }
        if ((ctx.state as string) !== 'running') throw new Error('AudioContext не активен')
      }
      const buffer = await ctx.decodeAudioData(bytes)
      if (generation !== generationRef.current) return

      return new Promise<void>((resolve) => {
        const source = ctx.createBufferSource()
        source.buffer = buffer
        // Просодия эмоций теперь считается на сервере (SSML) — здесь только
        // лёгкий детерминированный джиттер, чтобы голос звучал живее
        source.playbackRate.value = clamp(jitter(sentence, 0.02), 0.9, 1.1)
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
        }, (buffer.duration / 0.9) * 1000 + 4000)
        source.onended = finishOnce
        source.connect(ctx.destination)
        source.start()
      })
    },
    [ensureCtx]
  )

  /** Ключ prefetch-кэша: текст + голос (после смены голоса старое аудио не играет) */
  const prefetchKey = useCallback(
    (clean: string) => `${optsRef.current.voiceId}|${clean}`,
    []
  )

  /** Скачиваем аудио фразы с сервера. До двух попыток: короткий сетевой сбой
   * не должен оставлять фразу без голоса. null — сервер недоступен, фразу
   * пропускаем молча (голос всегда один, менять тембр на другой движок — нельзя) */
  const fetchServerAudio = useCallback(async (clean: string): Promise<ArrayBuffer | null> => {
    // Просодия эмоций считается на сервере и попадает в ключ кэша
    const prosody = SERVER_EMOTION_PROSODY[detectEmotion(clean)]
    for (let attempt = 0; attempt < 2; attempt++) {
      // Таймаут fetch: подвисший запрос не должен блокировать очередь озвучки
      const controller = new AbortController()
      const fetchTimeout = setTimeout(() => controller.abort(), 10_000)
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: clean.slice(0, 800),
            rate: prosody.rate,
            pitch: prosody.pitch,
            voice: optsRef.current.voiceId,
          }),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`TTS ${res.status}`)
        return await res.arrayBuffer()
      } catch {
        // Сетевой сбой/таймаут — вторая попытка через короткую паузу
        if (attempt === 0) await sleep(400)
      } finally {
        clearTimeout(fetchTimeout)
      }
    }
    return null
  }, [])

  /** Стартует фоновую загрузку аудио фразы (если она ещё не качается) */
  const startPrefetch = useCallback(
    (clean: string): boolean => {
      const key = prefetchKey(clean)
      if (audioPrefetchRef.current.has(key)) return false
      if (inflightPrefetchRef.current >= MAX_PREFETCH) return false
      inflightPrefetchRef.current++
      const promise = fetchServerAudio(clean).finally(() => {
        inflightPrefetchRef.current--
      })
      audioPrefetchRef.current.set(key, promise)
      return true
    },
    [fetchServerAudio, prefetchKey]
  )

  /** Качаем аудио первых фраз очереди заранее — между предложениями не будет тишины */
  const ensurePrefetch = useCallback(
    (generation: number) => {
      if (generation !== generationRef.current) return
      let freeSlots = MAX_PREFETCH - inflightPrefetchRef.current
      for (const item of queueRef.current) {
        if (freeSlots <= 0) return
        const clean = cleanForSpeech(item)
        if (!clean || audioPrefetchRef.current.has(prefetchKey(clean))) continue
        if (startPrefetch(clean)) freeSlots--
      }
    },
    [prefetchKey, startPrefetch]
  )

  /**
   * Озвучка одной фразы серверным нейроголосом (голос — выбор пользователя).
   * Аудио почти всегда уже скачано фоном (prefetch) — играем
   * сразу, без сетевой тишины между предложениями. При недоступности
   * сервера фраза пропускается молча: тембр в разговоре не меняется.
   */
  const speakSentence = useCallback(
    async (sentence: string, generation: number): Promise<'played' | 'blocked' | 'skipped'> => {
      const clean = cleanForSpeech(sentence)
      if (!clean) return 'skipped'

      const key = prefetchKey(clean)
      let prefetched = audioPrefetchRef.current.get(key) ?? null
      audioPrefetchRef.current.delete(key)
      // Не успели prefetch'нуть (первая фраза, лимит одновременных) — качаем сейчас
      if (!prefetched) {
        prefetched = fetchServerAudio(clean)
      }

      const bytes = await prefetched
      if (generation !== generationRef.current) return 'skipped'
      if (!bytes) return 'skipped'

      try {
        await playServerAudio(bytes, clean, generation)
        return 'played'
      } catch (error) {
        // Контекст заблокирован autoplay-политикой браузера: возвращаем фразу
        // в начало очереди и ждём касания экрана — после него продолжим
        // говорить ровно с этого места (текст ответа и так виден в чате)
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('не активен')) {
          queueRef.current.unshift(sentence)
          if (!blockedRef.current) {
            blockedRef.current = true
            setBlocked(true)
            optsRef.current.onPlaybackBlocked?.()
          }
          return 'blocked'
        }
        // Иной сбой воспроизведения — фразу пропускаем молча:
        // другой голос включать нельзя
        return 'skipped'
      }
    },
    [fetchServerAudio, playServerAudio, prefetchKey]
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

          const status = await speakSentence(sentence, generation)
          if (generation !== generationRef.current) return
          if (status === 'blocked') {
            // Ждём касания: выходим из насоса, очередь и генерация сохранены.
            // pumpingRef сбросится в finally — разблокировка перезапустит pump
            return
          }

          // Следующие фразы качаем фоном прямо сейчас — пока звучит пауза
          ensurePrefetch(generation)

          // Живая пауза между фразами (короткая — разговор бодрее)
          const hasMore =
            queueRef.current.length > 0 || !streamEndedRef.current || pendingRef.current.length > 0
          if (hasMore) {
            const clean = cleanForSpeech(sentence) || sentence
            const tail = /[…]$/.test(clean) ? 120 : 0
            await sleep(INTER_PHRASE_PAUSE[detectEmotion(clean)] + tail)
          }
        }
        finish(generation)
      } finally {
        pumpingRef.current = false
      }
    },
    [ensurePrefetch, speakSentence]
  )

  /** Контекст ожил (жест/statechange) — снимаем блокировку и продолжаем говорить */
  const tryUnblock = useCallback(() => {
    if (!blockedRef.current) return
    blockedRef.current = false
    setBlocked(false)
    void pump(generationRef.current)
  }, [pump])
  tryUnblockRef.current = tryUnblock

  const splitIntoSentences = (text: string): string[] => {
    const raw = text
      .replace(/[*_`#]+/g, '')
      .split(/(?<=[.!?…])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
    // Длинные предложения дополнительно режем по пробелам — короткие куски
    // звучат живее, а паузы между ними минимальны
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
        audioPrefetchRef.current.clear()
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
      // Аудио новых фраз качается фоном, пока звучит текущая
      ensurePrefetch(generationRef.current)
      void pump(generationRef.current)
    },
    [ensurePrefetch, pump]
  )

  /** Сообщить, что стрим закончен — доигрываем накопленный хвост */
  const endStream = useCallback(() => {
    if (pendingRef.current) {
      queueRef.current.push(pendingRef.current)
      pendingRef.current = ''
    }
    streamEndedRef.current = true
    ensurePrefetch(generationRef.current)
    void pump(generationRef.current)
  }, [ensurePrefetch, pump])

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

  // Прогреваем серверный нейроголос сразу при загрузке: Edge-сокет откроется
  // заранее, и первая фраза ответа не будет ждать установку соединения 1-2с
  useEffect(() => {
    fetch('/api/tts').catch(() => {
      /* прогрев не критичен */
    })
  }, [])

  // ─── Разблокировка звука (autoplay-политика браузеров) ──────────────────
  // Слушаем ВСЕ взаимодействия постоянно, а не только первое: мобильные
  // браузеры и Safari приостанавливают контекст повторно — после запроса
  // разрешения микрофона, сворачивания вкладки, открытия клавиатуры.
  // Если озвучка стояла на паузе из-за блокировки — продолжаем её.
  useEffect(() => {
    const unlock = () => {
      const ctx = ensureCtx()
      if (!ctx) return
      // iOS-трюк: беззвучный буфер прямо в жесте — Safari не «отпускает»
      // контекст только от resume()
      try {
        const silent = ctx.createBuffer(1, 1, 22050)
        const src = ctx.createBufferSource()
        src.buffer = silent
        src.connect(ctx.destination)
        src.start(0)
      } catch {
        /* не критично */
      }
      tryUnblockRef.current()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') unlock()
    }
    window.addEventListener('pointerdown', unlock, { passive: true })
    window.addEventListener('touchend', unlock, { passive: true })
    window.addEventListener('keydown', unlock)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchend', unlock)
      window.removeEventListener('keydown', unlock)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ensureCtx])

  useEffect(() => stop, [stop])

  return { speak, enqueue, endStream, stop, speaking, voiceName, blocked }
}
