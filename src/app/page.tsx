'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useSpeechRecognition } from '@/hooks/use-speech-recognition'
import { useTtsQueue } from '@/hooks/use-tts-queue'
import { CharacterSwitcher } from '@/components/daria/character-switcher'
import { ChatPanel } from '@/components/daria/chat-panel'
import { MemoryDialog } from '@/components/daria/memory-dialog'
import { VoiceOrb } from '@/components/daria/voice-orb'
import { cn } from '@/lib/utils'
import type { AssistantState, Character, ChatMessage } from '@/lib/types'
import {
  Brain,
  Globe,
  Mic,
  SendHorizontal,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react'

const QUICK_PROMPTS = [
  'Расскажи, что ты умеешь',
  'Помоги спланировать день',
  'Придумай 5 названий для блога о путешествиях',
]

const STATUS_TEXT: Record<AssistantState, string> = {
  idle: 'Нажми микрофон или напиши сообщение',
  listening: 'Слушаю…',
  thinking: 'Думаю…',
  speaking: 'Говорю…',
}

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

  // ─── Озвучка: системный русский голос + эмоции ──────────────────────────
  const characterGender = (activeCharacter?.voicePitch ?? 1) < 0.95 ? 'male' : 'female'
  const tts = useTtsQueue({
    pitch: activeCharacter?.voicePitch ?? 1,
    rate: activeCharacter?.voiceRate ?? 1,
    gender: characterGender,
  })

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
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            characterId: activeCharacter.id,
            message: text,
            search: searchOnRef.current,
          }),
        })

        if (!res.ok || !res.body) {
          const payload = await res.json().catch(() => null)
          throw new Error(payload?.error ?? `Ошибка ${res.status}`)
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
    [activeCharacter, toast, tts]
  )

  // ─── Микрофон ───────────────────────────────────────────────────────────
  const recognition = useSpeechRecognition({
    onInterim: (text) => setInterim(text),
    onFinal: (text) => {
      if (text.trim()) void send(text)
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
      recognition.stop()
      setInterim('')
      return
    }
    // Перебивание: глушим ассистента и слушаем
    tts.stop()
    recognition.start()
  }, [recognition, toast, tts])

  useEffect(() => {
    setMicListening(recognition.listening)
  }, [recognition.listening])

  // ─── Состояние ассистента для орбиса ────────────────────────────────────
  const assistantState: AssistantState = micListening
    ? 'listening'
    : tts.speaking
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

  const selectCharacter = useCallback(
    async (character: Character) => {
      if (character.id === activeCharacter?.id) return
      tts.stop()
      recognition.stop()
      setActiveCharacter(character)
      setStreamingText('')
      await loadHistory(character.id)
    },
    [activeCharacter?.id, loadHistory, recognition, tts]
  )

  // ─── Очистить чат ───────────────────────────────────────────────────────
  const clearChat = useCallback(async () => {
    if (!activeCharacter) return
    tts.stop()
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
  const greeting = activeCharacter
    ? `${activeCharacter.emoji} Я ${activeCharacter.name} — ${activeCharacter.tagline.toLowerCase()}`
    : 'Загружаю ассистентов…'

  const canSend = inputValue.trim().length > 0 && !busy

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) void send(inputValue)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#070b12] text-white">
      {/* Фоновые свечения */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full opacity-20 blur-[120px] transition-colors duration-700"
          style={{ backgroundColor: accent }}
        />
        <div className="absolute bottom-0 right-0 h-[300px] w-[400px] rounded-full bg-teal-500/5 blur-[100px]" />
      </div>

      {/* Шапка */}
      <header className="relative z-10 flex items-center justify-between gap-3 border-b border-white/5 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div
            className="grid size-10 place-items-center rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md"
            style={{ boxShadow: `0 0 20px -8px ${accent}` }}
          >
            <Sparkles className="size-5" style={{ color: accent }} />
          </div>
          <div className="leading-tight">
            <h1 className="text-lg font-bold tracking-wide">ДАРИЯ</h1>
            <p className="text-[11px] text-white/40">голосовой ИИ-ассистент</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <CharacterSwitcher
            characters={characters}
            activeId={activeCharacter?.id ?? null}
            onSelect={(c) => void selectCharacter(c)}
          />
        </div>
      </header>

      {/* Основная область */}
      <main className="relative z-10 flex flex-1 flex-col gap-4 p-4 lg:flex-row lg:gap-6 lg:p-6">
        {/* HUD: орбис + ввод */}
        <section className="flex min-h-[62vh] flex-1 flex-col items-center justify-between gap-6 lg:min-h-0">
          {/* Орбис и статус */}
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <VoiceOrb state={assistantState} accent={accent} size={300} />

            <div className="flex flex-col items-center gap-1.5 text-center">
              <p className="text-sm font-medium text-white/85">
                {assistantState === 'idle' ? greeting : STATUS_TEXT[assistantState]}
              </p>
              {interim ? (
                <p className="max-w-md text-sm italic text-white/45">«{interim}»</p>
              ) : (
                <p className="max-w-md text-xs text-white/30">{STATUS_TEXT[assistantState]}</p>
              )}
            </div>

            {/* Быстрые подсказки — только в покое и пустой истории */}
            {assistantState === 'idle' && messages.length === 0 && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => void send(prompt)}
                    className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs text-white/60 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white/90"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Панель ввода */}
          <div className="w-full max-w-2xl">
            {/* Переключатели */}
            <div className="mb-2.5 flex flex-wrap items-center justify-center gap-2">
              <ToggleChip
                active={searchOn}
                onClick={() => setSearchOn((v) => !v)}
                icon={<Globe className="size-3.5" />}
                label="Поиск в интернете"
              />
              <ToggleChip
                active={voiceOn}
                onClick={toggleVoice}
                icon={voiceOn ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
                label="Озвучка ответов"
                title={
                  tts.voiceName
                    ? `Озвучка: нейроголос сервера (Google RU) · резерв браузера: ${tts.voiceName}`
                    : 'Озвучка: нейроголос сервера (Google RU) · резерв — системный голос'
                }
              />
              <ToggleChip
                active={memoryOpen}
                onClick={() => setMemoryOpen(true)}
                icon={<Brain className="size-3.5" />}
                label="Память и дневник"
              />
              <ToggleChip
                active={false}
                onClick={() => void clearChat()}
                icon={<Trash2 className="size-3.5" />}
                label="Очистить чат"
              />
            </div>

            <div className="flex items-end gap-2 rounded-3xl border border-white/10 bg-white/[0.04] p-2 backdrop-blur-md">
              <button
                onClick={toggleMic}
                className={cn(
                  'grid size-11 shrink-0 place-items-center rounded-full transition-all duration-200',
                  micListening
                    ? 'animate-pulse bg-red-500/90 text-white shadow-[0_0_24px_-4px_rgba(239,68,68,0.7)]'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                )}
                style={
                  micListening
                    ? undefined
                    : { boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.08)` }
                }
                aria-label={micListening ? 'Остановить микрофон' : 'Говорить'}
                title={micListening ? 'Остановить' : 'Говорить голосом'}
              >
                {micListening ? <Square className="size-4" /> : <Mic className="size-5" />}
              </button>

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
                className="max-h-32 min-h-11 flex-1 resize-none border-0 bg-transparent py-2.5 text-sm text-white placeholder:text-white/30 focus-visible:ring-0 focus-visible:ring-offset-0"
              />

              <Button
                onClick={() => void send(inputValue)}
                disabled={!canSend}
                size="icon"
                className="size-11 shrink-0 rounded-full text-black transition-opacity disabled:opacity-30"
                style={{ backgroundColor: accent }}
                aria-label="Отправить"
              >
                <SendHorizontal className="size-4" />
              </Button>
            </div>

            <p className="mt-2 text-center text-[11px] text-white/25">
              Enter — отправить · Shift+Enter — новая строка · Клик по микрофону во время ответа — перебить
            </p>
          </div>
        </section>

        {/* Чат */}
        <aside className="flex h-[46vh] w-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-md lg:h-[calc(100vh-7.5rem)] lg:min-h-0 lg:w-[400px] lg:shrink-0">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: accent, boxShadow: `0 0 8px ${accent}` }}
              />
              <h2 className="text-sm font-semibold">
                Диалог с {activeCharacter?.name ?? '…'}
              </h2>
            </div>
            <span className="text-[11px] text-white/30">{messages.length} сообщений</span>
          </div>
          <div className="min-h-0 flex-1">
            <ChatPanel
              messages={messages}
              streamingText={streamingText}
              accent={accent}
              characterName={activeCharacter?.name ?? 'Ассистент'}
              emptyHint={`Начни разговор — ${activeCharacter?.name ?? 'ассистент'} услышит и запомнит важное о тебе`}
            />
          </div>
        </aside>
      </main>

      <MemoryDialog open={memoryOpen} onOpenChange={setMemoryOpen} onMemoryChanged={() => {}} />
    </div>
  )
}

interface ToggleChipProps {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  title?: string
}

function ToggleChip({ active, onClick, icon, label, title }: ToggleChipProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-all duration-200',
        active
          ? 'border-teal-400/40 bg-teal-400/10 text-teal-300'
          : 'border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white/75'
      )}
      aria-pressed={active}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
