'use client'

import { memo, useEffect, useRef } from 'react'
import type { ChatMessage } from '@/lib/types'
import { cn } from '@/lib/utils'

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
        <p className="whitespace-pre-wrap break-words">{content}</p>
      </div>
    </div>
  )
}
