'use client'

import { memo, useEffect, useRef } from 'react'
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
  characterName: string
  emptyHint: string
}

export const ChatPanel = memo(function ChatPanel({
  messages,
  streamingText,
  accent,
  characterName,
  emptyHint,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages.length, streamingText])

  const hasContent = messages.length > 0 || streamingText.length > 0

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto scroll-smooth px-4 py-4 daria-scrollbar"
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
              characterName={characterName}
            />
          ))}
          {streamingText.length > 0 && (
            <MessageBubble role="assistant" content={streamingText} accent={accent} characterName={characterName} streaming />
          )}
        </div>
      )}
    </div>
  )
})

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  accent: string
  characterName: string
  streaming?: boolean
}

function MessageBubble({ role, content, accent, characterName, streaming }: MessageBubbleProps) {
  const isUser = role === 'user'
  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'rounded-br-md bg-white/10 text-white/90'
            : 'rounded-bl-md border border-white/5 bg-white/[0.04] text-white/85'
        )}
        style={
          isUser
            ? undefined
            : { borderLeft: `2px solid ${accent}${streaming ? 'aa' : '55'}` }
        }
      >
        {!isUser && (
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: accent }}>
            {streaming && (
              <span className="inline-block size-1.5 animate-pulse rounded-full" style={{ backgroundColor: accent }} />
            )}
            {characterName}
          </div>
        )}
        <LinkifiedText text={content} accent={accent} />
      </div>
    </div>
  )
}
