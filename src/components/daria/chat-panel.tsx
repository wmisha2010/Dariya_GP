'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import type { ChatMessage } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Ссылки в тексте (http/https/www) делаем кликабельными */
const URL_RE = /(https?:\/\/[^\s<>"')\]]+|www\.[^\s<>"')\]]+)/gi

function LinkifiedText({ text, accent }: { text: string; accent: string }) {
  const parts: Array<string | { url: string; label: string }> = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const idx = match.index ?? 0
    const raw = match[0]
    // Отделяем хвостовую пунктуацию от самой ссылки: «https://…».
    const trimmed = raw.replace(/[.,!?;:…]+$/, '')
    if (!trimmed) continue
    if (idx > last) parts.push(text.slice(last, idx))
    parts.push({ url: trimmed.startsWith('www.') ? `https://${trimmed}` : trimmed, label: trimmed })
    if (trimmed.length < raw.length) parts.push(raw.slice(trimmed.length))
    last = idx + raw.length
  }
  if (last < text.length) parts.push(text.slice(last))

  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : (
          <a
            key={i}
            href={part.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
            style={{ color: accent }}
          >
            {part.label}
          </a>
        )
      )}
    </p>
  )
}

interface ChatPanelProps {
  messages: ChatMessage[]
  streamingText: string
  accent: string
  emptyHint: string
}

/**
 * Диалог в стиле мессенджера: новое сообщение прокручивает список вниз
 * только если пользователь и так внизу; если листает историю — не дёргаем,
 * а показываем плавающую кнопку «К новым».
 */
export const ChatPanel = memo(function ChatPanel({
  messages,
  streamingText,
  accent,
  emptyHint,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const prevCountRef = useRef(0)
  const [atBottom, setAtBottom] = useState(true)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    atBottomRef.current = near
    setAtBottom((prev) => (prev === near ? prev : near))
  }, [])

  // Новое сообщение или загруженная история — скролл вниз (мгновенно для истории)
  useEffect(() => {
    const jump = messages.length - prevCountRef.current
    prevCountRef.current = messages.length
    if (!atBottomRef.current || messages.length === 0 || jump === 0) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: jump > 1 ? 'auto' : 'smooth' })
  }, [messages.length])

  // Стриминг: подтыкаем вниз без плавности — обновления приходят часто
  useEffect(() => {
    if (!atBottomRef.current || streamingText.length === 0) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight })
  }, [streamingText])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = true
    setAtBottom(true)
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [])

  const hasContent = messages.length > 0 || streamingText.length > 0

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-4 daria-scrollbar"
        aria-live="polite"
      >
        {!hasContent ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center">
            <span className="text-3xl">💬</span>
            <p className="max-w-56 text-sm leading-relaxed text-white/35">{emptyHint}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                role={message.role}
                content={message.content}
                accent={accent}
              />
            ))}
            {streamingText.length > 0 && (
              <MessageBubble role="assistant" content={streamingText} accent={accent} streaming />
            )}
          </div>
        )}
      </div>

      {/* Читаешь историю — всплывает кнопка возврата к свежим сообщениям */}
      {!atBottom && hasContent && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-3 right-4 flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0b1120]/90 px-3 py-2 text-xs text-white/70 shadow-lg backdrop-blur-md transition-all hover:border-white/20 hover:text-white"
          aria-label="Прокрутить к новым сообщениям"
        >
          <ArrowDown className="size-3.5" />
          К новым
        </button>
      )}
    </div>
  )
})

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  accent: string
  streaming?: boolean
}

function MessageBubble({ role, content, accent, streaming }: MessageBubbleProps) {
  const isUser = role === 'user'
  // Мелкие free-модели иногда вставляют служебные теги вроде <arg_value> —
  // в сообщении и в озвучке им не место
  const safeContent = content.replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]{0,24}>\s*/g, '')
  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm',
          isUser
            ? 'rounded-br-md bg-zinc-600/85 text-white'
            : 'rounded-bl-md bg-white text-zinc-900'
        )}
      >
        <LinkifiedText text={safeContent} accent={accent} />
        {streaming && (
          <span
            className="ml-1 inline-block size-1.5 animate-pulse rounded-full align-middle"
            style={{ backgroundColor: accent }}
          />
        )}
      </div>
    </div>
  )
}
