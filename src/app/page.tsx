'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useSpeechRecognition } from '@/hooks/use-speech-recognition'
import { useTtsQueue } from '@/hooks/use-tts-queue'
import { ChatPanel } from '@/components/daria/chat-panel'
import { MemoryDialog } from '@/components/daria/memory-dialog'
import { MusicPlayer } from '@/components/daria/music-player'
import { SettingsDialog } from '@/components/daria/settings-dialog'
import { VoiceOrb } from '@/components/daria/voice-orb'
import { WaveBars } from '@/components/daria/wave-bars'
import { cn } from '@/lib/utils'
import type { AssistantState, Character, ChatMessage } from '@/lib/types'
import {
  AudioLines,
  Brain,
  Globe,
  Mic,
  SendHorizontal,
  Settings,
  SlidersHorizontal,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react'

/** Доступные голоса ассистента — белый список в /api/tts, id совпадают */
const TTS_VOICES = [
  { id: 'svetlana', name: 'Светлана' },
  { id: 'irina', name: 'Ирина' },
] as const

/** Ключ localStorage, где хранится выбор голоса */
const TTS_VOICE_STORAGE_KEY = 'daria-tts-voice'

/** Пауза после конца озвучки, прежде чем снова включать микрофон (затухание эха) */
const ECHO_GRACE_MS = 700

/** Голосовое управление музыкой: «включи/поставь/запусти …» */
const MUSIC_TRIGGER_RE = /^\s*(включи(?:те)?|поставь(?:те)?|запусти(?:те)?|сыграй(?:те)?|играй(?:те)?)\s+/i
/** «выключи/стоп …» — остановить плеер */
const MUSIC_STOP_RE = /^\s*(выключи(?:те)?|останови(?:те)?|стоп|хватит)\s*/i
/** В команде должна быть музыкальная тема — чтобы «включи свет» не запускал плеер */
const MUSIC_TOPIC_RE =
  /(песн|музык|трек|плейлист|композици|ремикс|альбом|рэп|\bрок|\bпоп|джаз|блюз|классическ|инструментальн|фортепиан|гитар|металл|электро|танцевальн|спокойн|грустн|весел|весёл|романтич|колыбельн|хит|клип|мелод|исполнител|расслаб|концентрац|фонов|звук\w*\s+природ|дожд)/i

export default function Home() {
  const { toast } = useToast()

  // Данные
  const [characters, setCharacters] = useState<Character[]>([])
  const [activeCharacter, setActiveCharacter] = useState<Character | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamingText, setStreamingText] = useState('')

  // Настройки
  const [searchOn, setSearchOn] = useState(false)
  const [voiceOn, setVoiceOn] = useState(true)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Раскрытый тулбар «Дополнительно» над строкой ввода */
  const [toolsOpen, setToolsOpen] = useState(false)
  /** Сейчас играет трек (YouTube-плеер смонтирован) */
  const [music, setMusic] = useState<{ videoId: string; title: string; url: string } | null>(null)

  // Ввод
  const [inputValue, setInputValue] = useState('')
  const [interim, setInterim] = useState('')
  const [micListening, setMicListening] = useState(false)
  const [busy, setBusy] = useState(false)

  const sendingRef = useRef(false)
  const voiceOnRef = useRef(voiceOn)
  voiceOnRef.current = voiceOn
  const searchOnRef = useRef(searchOn)
  searchOnRef.current = searchOn
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ─── Эхо-защита: микрофон не должен слышать голос самого ассистента ─────
  const [micDesired, setMicDesired] = useState(false) // пользователь включил микрофон
  const micDesiredRef = useRef(false)
  const ttsSpeakingRef = useRef(false)
  const musicPlayingRef = useRef(false)
  const wasSpeakingRef = useRef(false)
  const echoMuteUntilRef = useRef(0)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastBusyToastRef = useRef(0)

  // ─── Озвучка: серверный нейроголос Edge (голос выбирается кнопкой «Голос») ─
  const [ttsVoice, setTtsVoice] = useState<string>('svetlana')

  // Восстанавливаем выбранный голос с прошлого визита
  useEffect(() => {
    const saved = window.localStorage.getItem(TTS_VOICE_STORAGE_KEY)
    if (saved && TTS_VOICES.some((v) => v.id === saved)) setTtsVoice(saved)
  }, [])

  /** Выбор голоса из настроек с сохранением */
  const setVoice = useCallback((id: string) => {
    setTtsVoice(id)
    window.localStorage.setItem(TTS_VOICE_STORAGE_KEY, id)
  }, [])

  /** Циклическое переключение голоса с сохранением выбора */
  const cycleVoice = useCallback(() => {
    setTtsVoice((prev) => {
      const idx = TTS_VOICES.findIndex((v) => v.id === prev)
      const next = TTS_VOICES[(idx + 1) % TTS_VOICES.length]
      window.localStorage.setItem(TTS_VOICE_STORAGE_KEY, next.id)
      return next.id
    })
  }, [])

  const currentVoiceLabel =
    TTS_VOICES.find((v) => v.id === ttsVoice)?.name ?? TTS_VOICES[0].name

  /** Браузер заблокировал автозапуск звука — объясняем, как включить */
  const handlePlaybackBlocked = useCallback(() => {
    toast({
      title: 'Браузер заблокировал звук',
      description: 'Коснись экрана в любом месте — и я продолжу говорить голосом.',
    })
  }, [toast])

  const tts = useTtsQueue({ voiceId: ttsVoice, onPlaybackBlocked: handlePlaybackBlocked })

  ttsSpeakingRef.current = tts.speaking
  musicPlayingRef.current = music !== null
  /** Всё услышанное во время озвучки/музыки и сразу после — эхо, а не речь пользователя */
  const isEcho = () =>
    ttsSpeakingRef.current || musicPlayingRef.current || Date.now() < echoMuteUntilRef.current

  /** Локальный ответ без LLM: музыкальные команды отвечают мгновенно */
  const assistantLocalReply = useCallback(
    (content: string) => {
      setMessages((prev) => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: 'assistant', content, createdAt: new Date().toISOString() },
      ])
      if (voiceOnRef.current) tts.speak(content)
    },
    [tts]
  )

  // ─── Отправка сообщения ─────────────────────────────────────────────────
  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim()
      if (!text || sendingRef.current || !activeCharacter) return
      sendingRef.current = true
      setBusy(true)
      setInputValue('')
      setInterim('')
      tts.stop()

      const now = new Date().toISOString()
      const localId = `local-${Date.now()}`
      setMessages((prev) => [
        ...prev,
        { id: localId, role: 'user', content: text, createdAt: now },
      ])

      try {
        // Голосовое управление музыкой: «выключи музыку» — гасим плеер без LLM
        if (MUSIC_STOP_RE.test(text) && MUSIC_TOPIC_RE.test(text)) {
          tts.stop()
          setMusic(null)
          assistantLocalReply('Хорошо, выключила музыку 🎧')
          return
        }

        // Голосовое управление музыкой: «включи песню…» — ищем и играем
        if (MUSIC_TRIGGER_RE.test(text) && MUSIC_TOPIC_RE.test(text)) {
          const query =
            text
              .replace(MUSIC_TRIGGER_RE, '')
              .replace(/\s*пожалуйста\s*/gi, ' ')
              .trim()
              .slice(0, 120) || 'музыка'
          const res = await fetch('/api/music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          })
          if (!res.ok) throw new Error('nothing found')
          const json = (await res.json()) as { track?: { videoId: string; title: string; url: string } }
          if (!json.track) throw new Error('nothing found')
          tts.stop()
          setMusic({ videoId: json.track.videoId, title: json.track.title, url: json.track.url })
          assistantLocalReply(`Включаю «${json.track.title}» 🎵\n${json.track.url}`)
          return
        }

        // Запрос к ассистенту с автоповтором: перегрузка API (429/503) обычно
        // проходит за секунды — молча ждём и пробуем снова; красная ошибка —
        // только если не помогло даже после трёх попыток
        let res: Response | null = null
        let lastErrorText = ''
        for (let attempt = 0; attempt < 3; attempt++) {
          const r = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              characterId: activeCharacter.id,
              message: text,
              search: searchOnRef.current,
            }),
          })
          if (r.ok && r.body) {
            res = r
            break
          }
          const payload = (await r.json().catch(() => null)) as { error?: string } | null
          lastErrorText = payload?.error ?? `Ошибка ${r.status}`
          const retryable = r.status === 429 || r.status === 503 || r.status >= 500
          if (!retryable || attempt === 2) break
          if (attempt === 0) toast({ title: 'Модель притормозила — пробую ещё раз…' })
          await new Promise((resolve) => setTimeout(resolve, 3500 * (attempt + 1)))
        }
        if (!res || !res.body) {
          throw new Error(lastErrorText || 'Ассистент не смог ответить')
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let full = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const delta = decoder.decode(value, { stream: true })
          if (!delta) continue
          full += delta
          setStreamingText(full)
          if (voiceOnRef.current) tts.enqueue(delta)
        }
        if (voiceOnRef.current) tts.endStream()

        setStreamingText('')
        if (!full.trim()) {
          // Пустой ответ — не тишина, а понятное сообщение
          throw new Error('Ассистент не успел ответить — попробуй ещё раз')
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: full.trim(),
            createdAt: new Date().toISOString(),
          },
        ])
      } catch (error) {
        setStreamingText('')
        toast({
          title: 'Не получилось',
          description: error instanceof Error ? error.message : 'Ассистент не смог ответить',
          variant: 'destructive',
        })
      } finally {
        sendingRef.current = false
        setBusy(false)
      }
    },
    [activeCharacter, assistantLocalReply, toast, tts]
  )

  // ─── Микрофон ───────────────────────────────────────────────────────────
  const recognition = useSpeechRecognition({
    onInterim: (text) => {
      if (isEcho()) return
      setInterim(text)
    },
    onFinal: (text) => {
      if (isEcho()) return
      const clean = text.trim()
      if (!clean) return
      if (sendingRef.current) {
        // Ассистент ещё отвечает — не теряем молча, а подсказываем
        if (Date.now() - lastBusyToastRef.current > 4000) {
          lastBusyToastRef.current = Date.now()
          toast({ title: 'Секунду…', description: 'Ассистент ещё отвечает — повтори сразу после' })
        }
        return
      }
      void send(clean)
    },
    onError: (code) => {
      toast({
        title: 'Микрофон недоступен',
        description:
          code === 'not-allowed' || code === 'service-not-allowed'
            ? 'Разреши доступ к микрофону в настройках браузера'
            : `Ошибка распознавания: ${code}`,
        variant: 'destructive',
      })
    },
  })

  const setMicOn = useCallback((on: boolean) => {
    micDesiredRef.current = on
    setMicDesired(on)
  }, [])

  const toggleMic = useCallback(() => {
    if (!recognition.supported) {
      toast({
        title: 'Голосовой ввод недоступен',
        description: 'Открой приложение в Chrome или Edge — там работает распознавание речи',
        variant: 'destructive',
      })
      return
    }
    if (recognition.listening) {
      setMicOn(false)
      recognition.stop()
      setInterim('')
      return
    }
    // Перебивание: глушим ассистента и музыку, слушаем
    setMicOn(true)
    tts.stop()
    setMusic(null)
    recognition.start()
  }, [recognition, setMicOn, toast, tts])

  useEffect(() => {
    setMicListening(recognition.listening)
  }, [recognition.listening])

  // Пока звучит голос ассистента или музыка — приглушаем микрофон (он не слышит
  // сам себя), после тишины возвращаем с паузой на затухание звука
  const audible = tts.speaking || music !== null
  useEffect(() => {
    if (audible && !wasSpeakingRef.current) {
      wasSpeakingRef.current = true
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current)
        resumeTimerRef.current = null
      }
      recognition.pause()
    } else if (!audible && wasSpeakingRef.current) {
      wasSpeakingRef.current = false
      echoMuteUntilRef.current = Date.now() + ECHO_GRACE_MS
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
      resumeTimerRef.current = setTimeout(() => {
        resumeTimerRef.current = null
        if (micDesiredRef.current) recognition.resume()
      }, ECHO_GRACE_MS)
    }
  }, [audible, recognition.pause, recognition.resume])

  useEffect(
    () => () => {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    },
    []
  )

  // ─── Состояние ассистента для орбиса ────────────────────────────────────
  const assistantState: AssistantState = micListening
    ? 'listening'
    : tts.speaking || music !== null
      ? 'speaking'
      : busy
        ? 'thinking'
        : 'idle'

  // ─── Загрузка персонажей и истории ──────────────────────────────────────
  const loadHistory = useCallback(async (characterId: string) => {
    try {
      const res = await fetch(`/api/messages?characterId=${encodeURIComponent(characterId)}`)
      const json = await res.json()
      setMessages(json.messages ?? [])
    } catch {
      setMessages([])
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/characters')
        const json = await res.json()
        const list: Character[] = json.characters ?? []
        if (cancelled) return
        setCharacters(list)
        const first = list.find((c) => c.isDefault) ?? list[0] ?? null
        if (first) {
          setActiveCharacter(first)
          await loadHistory(first.id)
        }
      } catch {
        if (!cancelled) {
          toast({
            title: 'Ошибка загрузки',
            description: 'Не удалось загрузить персонажей',
            variant: 'destructive',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ─── Очистить чат ───────────────────────────────────────────────────────
  const clearChat = useCallback(async () => {
    if (!activeCharacter) return
    tts.stop()
    setMusic(null)
    try {
      await fetch(`/api/messages?characterId=${encodeURIComponent(activeCharacter.id)}`, {
        method: 'DELETE',
      })
      setMessages([])
      toast({ title: 'История очищена', description: `${activeCharacter.name} всё ещё помнит факты о тебе` })
    } catch {
      toast({ title: 'Не удалось очистить историю', variant: 'destructive' })
    }
  }, [activeCharacter, toast, tts])

  // ─── Быстрые действия ───────────────────────────────────────────────────
  const toggleVoice = () => {
    setVoiceOn((prev) => {
      if (prev) tts.stop()
      return !prev
    })
  }

  const accent = activeCharacter?.accent ?? '#2dd4bf'

  // Динамическая статус-строка под полем ввода (как на референсе)
  const statusLine = micListening
    ? interim
      ? `Слушаю: «${interim}»`
      : 'Слушаю…'
    : music
      ? '♪ Музыка играет'
      : tts.speaking
        ? 'Говорю…'
        : busy
          ? 'Думаю…'
          : 'Чат идёт потоком | Автоскролл'

  const canSend = inputValue.trim().length > 0 && !busy

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) void send(inputValue)
    }
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#0b0817] text-white">
      {/* Фоновые свечения — тёмно-фиолетовый градиент как на референсе */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-44 left-1/3 h-[460px] w-[760px] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-[130px]" />
        <div className="absolute -bottom-48 -left-36 h-[480px] w-[580px] rounded-full bg-violet-700/15 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[300px] w-[400px] rounded-full bg-fuchsia-600/5 blur-[100px]" />
      </div>

      {/* Шапка: мини-голограмма, имя и настройки */}
      <header className="relative z-10 flex items-center justify-between gap-3 border-b border-white/5 bg-[#0d0a1c]/70 px-4 py-2.5 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3">
          {/* Голограмма-орбис: тап — активировать микрофон, Дария слушает */}
          <button
            onClick={toggleMic}
            aria-label={micListening ? 'Остановить микрофон' : 'Активировать голосового помощника'}
            title={micListening ? 'Я уже слушаю — нажми, чтобы остановить' : 'Нажми на голограмму — я слушаю'}
            className="grid size-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/5 outline-none transition-all duration-200 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/20 active:scale-95"
            style={{ boxShadow: `0 0 26px -10px ${accent}` }}
          >
            <VoiceOrb state={assistantState} accent={accent} size={42} />
          </button>
          <div className="leading-tight">
            <h1 className="text-lg font-bold tracking-wide">ДАРИЯ</h1>
            <p className="text-[11px] text-white/40">голосовой ИИ-ассистент</p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setSettingsOpen(true)}
          className="gap-1.5 rounded-full border-white/15 bg-white/5 text-[11px] font-semibold uppercase tracking-wider text-white/80 hover:bg-white/10 hover:text-white"
        >
          <Settings className="size-4" />
          Настройки
        </Button>
      </header>

      {/* Основная область: диалог сверху, композер снизу */}
      <main className="relative z-10 mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-3 pt-2 sm:px-6">
        {/* Диалог — занимает верх и скроллится по мере заполнения */}
        <div className="min-h-0 flex-1">
          <ChatPanel
            messages={messages}
            streamingText={streamingText}
            accent={accent}
            emptyHint={`Начни разговор — ${activeCharacter?.name ?? 'ассистент'} услышит и запомнит важное о тебе`}
          />
        </div>

        {/* Композер: плеер, тулбар «Дополнительно» и строка ввода */}
        <div className="shrink-0 pb-2 pt-2">
          {/* Плеер: музыка играет даже во время переписки */}
          {music && (
            <div className="mb-2.5">
              <MusicPlayer
                videoId={music.videoId}
                title={music.title}
                url={music.url}
                accent={accent}
                onClose={() => setMusic(null)}
              />
            </div>
          )}

          {/* Звук заблокирован autoplay-политикой — ждём первого касания */}
          {tts.blocked && (
            <p
              role="status"
              className="mx-auto mb-2.5 w-fit animate-pulse rounded-full border border-amber-400/40 bg-amber-400/10 px-3.5 py-1.5 text-xs font-medium text-amber-300"
            >
              Коснись экрана — включу голос
            </p>
          )}

          {/* Тулбар «Дополнительно»: раскрывается над строкой ввода */}
          {toolsOpen && (
            <div className="mx-auto mb-2.5 w-fit rounded-2xl border border-white/10 bg-[#151126]/95 px-2 py-2 shadow-xl backdrop-blur-md">
              <div className="flex items-center gap-1">
                <ToolButton
                  icon={<Globe className="size-4" />}
                  label="Поиск"
                  active={searchOn}
                  onClick={() => setSearchOn((v) => !v)}
                />
                <ToolButton
                  icon={<AudioLines className="size-4" />}
                  label={currentVoiceLabel}
                  onClick={cycleVoice}
                />
                <ToolButton
                  icon={voiceOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                  label="Озвучка"
                  active={voiceOn}
                  onClick={toggleVoice}
                />
                <ToolButton
                  icon={<Brain className="size-4" />}
                  label="Память"
                  onClick={() => {
                    setToolsOpen(false)
                    setMemoryOpen(true)
                  }}
                />
                <ToolButton
                  icon={<Trash2 className="size-4" />}
                  label="Очистить"
                  danger
                  onClick={() => {
                    setToolsOpen(false)
                    void clearChat()
                  }}
                />
              </div>
              <p className="mt-1 text-center text-[10px] text-white/35">Дополнительно</p>
            </div>
          )}

          {/* Строка ввода: микрофон · волна/текст · дополнительно · отправить */}
          <div
            className="flex items-center gap-2 rounded-full border border-white/10 bg-[#151126]/90 p-1.5 backdrop-blur-md"
            style={{ boxShadow: `0 10px 36px -18px ${accent}80` }}
          >
            {/* Микрофон: циановый круг, при записи — красный пульс */}
            <button
              onClick={toggleMic}
              className={cn(
                'grid size-11 shrink-0 place-items-center rounded-full text-white transition-all duration-200 active:scale-95',
                micListening
                  ? 'animate-pulse bg-red-500/90 shadow-[0_0_24px_-4px_rgba(239,68,68,0.7)]'
                  : 'hover:brightness-110'
              )}
              style={micListening ? undefined : { backgroundColor: accent }}
              aria-label={micListening ? 'Остановить микрофон' : 'Говорить'}
              title={
                micListening
                  ? 'Остановить запись'
                  : micDesired && (tts.speaking || music !== null)
                    ? 'Играет музыка или мой голос — кликни, чтобы перебить'
                    : 'Говорить голосом'
              }
            >
              {micListening ? <Square className="size-4" /> : <Mic className="size-5" />}
            </button>

            {/* Волна во время записи — тап по ней тоже останавливает */}
            {micListening ? (
              <button
                onClick={toggleMic}
                title="Нажми, чтобы остановить запись"
                className="flex h-11 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-full px-2 outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              >
                <WaveBars state="listening" className="max-w-full" />
              </button>
            ) : (
              <Textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  recognition.supported
                    ? 'Напиши или скажи голосом…'
                    : 'Напиши сообщение… (голос работает в Chrome/Edge)'
                }
                rows={1}
                className="max-h-32 min-h-11 flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm text-white placeholder:text-white/30 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            )}

            <button
              onClick={() => setToolsOpen((v) => !v)}
              aria-expanded={toolsOpen}
              aria-label="Дополнительно"
              title="Дополнительно"
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-full transition-colors',
                toolsOpen ? 'bg-white/15 text-white' : 'text-white/50 hover:bg-white/10 hover:text-white'
              )}
            >
              <SlidersHorizontal className="size-4" />
            </button>

            <Button
              onClick={() => void send(inputValue)}
              disabled={!canSend}
              size="icon"
              className={cn(
                'size-11 shrink-0 rounded-full border transition-all disabled:opacity-30',
                canSend
                  ? 'border-transparent text-black hover:brightness-110'
                  : 'border-white/20 bg-transparent text-white/70 hover:bg-white/10'
              )}
              style={canSend ? { backgroundColor: accent } : undefined}
              aria-label="Отправить"
            >
              <SendHorizontal className="size-4" />
            </Button>
          </div>

          {/* Статус: состояние ассистента / автоскролл */}
          <p className="mt-2 text-center text-[11px] text-white/30" role="status">
            {statusLine}
          </p>
        </div>
      </main>

      <MemoryDialog open={memoryOpen} onOpenChange={setMemoryOpen} onMemoryChanged={() => {}} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        voiceId={ttsVoice}
        onVoiceChange={setVoice}
        voiceOn={voiceOn}
        onVoiceToggle={toggleVoice}
        searchOn={searchOn}
        onSearchToggle={() => setSearchOn((v) => !v)}
        onOpenMemory={() => {
          setSettingsOpen(false)
          setMemoryOpen(true)
        }}
        onClearChat={() => {
          setSettingsOpen(false)
          void clearChat()
        }}
      />
    </div>
  )
}

interface ToolButtonProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
  danger?: boolean
}

/** Кнопка тулбара «Дополнительно»: иконка + подпись снизу */
function ToolButton({ icon, label, onClick, active, danger }: ToolButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-[62px] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] transition-colors',
        danger
          ? 'text-white/55 hover:bg-red-400/10 hover:text-red-300'
          : active
            ? 'bg-teal-400/10 text-teal-300'
            : 'text-white/55 hover:bg-white/10 hover:text-white'
      )}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </button>
  )
}
