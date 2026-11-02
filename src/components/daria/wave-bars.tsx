'use client'

import { useMemo } from 'react'
import type { AssistantState } from '@/lib/types'
import { cn } from '@/lib/utils'

interface WaveBarsProps {
  state: AssistantState
  /** Сколько столбиков рисовать */
  bars?: number
  className?: string
}

/** Лерп между двумя hex-цветами — градиент волны от циан к фиолету */
function mixColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => {
    const ca = (pa >> shift) & 0xff
    const cb = (pb >> shift) & 0xff
    return Math.round(ca + (cb - ca) * t)
  }
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
}

/**
 * Живая волна голосового ввода/ответа — как в референсе: столбики с градиентом
 * циан → фиолет, пляшут только когда ассистент слушает или говорит.
 * Чистый CSS (без canvas) — дёшево и плавно даже на слабых устройствах.
 */
export function WaveBars({ state, bars = 36, className }: WaveBarsProps) {
  const items = useMemo(
    () =>
      Array.from({ length: bars }, (_, i) => {
        const t = bars > 1 ? i / (bars - 1) : 0
        const color = mixColor('#22d3ee', '#a78bfa', t)
        // Псевдослучайные, но стабильные параметры каждого столбика
        const seed = Math.sin(i * 12.9898) * 43758.5453
        const rand = seed - Math.floor(seed)
        const duration =
          state === 'speaking'
            ? 0.55 + rand * 0.5
            : state === 'listening'
              ? 0.7 + rand * 0.6
              : state === 'thinking'
                ? 1.4 + rand * 0.6
                : 2.2 + rand * 1.2
        const hi =
          state === 'speaking'
            ? 0.65 + rand * 0.35
            : state === 'listening'
              ? 0.5 + rand * 0.4
              : state === 'thinking'
                ? 0.3 + rand * 0.2
                : 0.14 + rand * 0.1
        return {
          color,
          duration,
          hi,
          lo: state === 'idle' ? 0.08 : 0.12 + rand * 0.1,
          delay: -(rand * 2 + i * 0.07),
        }
      }),
    [bars, state]
  )

  const dim = state === 'idle'

  return (
    <div
      className={cn('flex h-8 items-center gap-[3px]', dim && 'opacity-40', className)}
      role="img"
      aria-label={`Волна голоса: ${state}`}
    >
      {items.map((bar, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full"
          style={{
            height: '100%',
            backgroundColor: bar.color,
            transformOrigin: 'center',
            animation: `daria-wave ${bar.duration}s ease-in-out ${bar.delay}s infinite`,
            // Кастомные свойства читаются внутри @keyframes daria-wave
            '--wave-hi': bar.hi,
            '--wave-lo': bar.lo,
          } as React.CSSProperties}
        />
      ))}
    </div>
  )
}
