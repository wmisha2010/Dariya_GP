'use client'

import { useEffect, useRef } from 'react'
import type { AssistantState } from '@/lib/types'

interface VoiceOrbProps {
  state: AssistantState
  accent: string
  size?: number
}

/** Плавный псевдослучайный шум для живости волны */
function makeNoise(seed: number) {
  let t = seed
  return (speed: number) => {
    t += speed
    return (
      0.5 +
      0.25 * Math.sin(t * 1.7) +
      0.15 * Math.sin(t * 3.1 + 1.3) +
      0.1 * Math.sin(t * 5.3 + 2.7)
    )
  }
}

export function VoiceOrb({ state, accent, size = 260 }: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  const accentRef = useRef(accent)

  useEffect(() => {
    stateRef.current = state
    accentRef.current = accent
  }, [state, accent])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const baseRadius = size * 0.22

    const noiseA = makeNoise(0.4)
    const noiseB = makeNoise(2.1)
    let raf = 0
    let time = 0

    const hexToRgb = (hex: string): [number, number, number] => {
      const clean = hex.replace('#', '')
      const num = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16)
      return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
    }

    const draw = () => {
      time += 0.016
      const st = stateRef.current
      const [r, g, b] = hexToRgb(accentRef.current)
      const accent = `${r},${g},${b}`

      ctx.clearRect(0, 0, size, size)

      const energy =
        st === 'speaking'
          ? 0.85
          : st === 'listening'
            ? 0.65
            : st === 'thinking'
              ? 0.45
              : 0.18

      // Внешнее мягкое свечение
      const glowRadius = baseRadius * (2.4 + energy * 0.9 + 0.08 * Math.sin(time * 1.4))
      const glow = ctx.createRadialGradient(cx, cy, baseRadius * 0.4, cx, cy, glowRadius)
      glow.addColorStop(0, `rgba(${accent},${0.10 + energy * 0.14})`)
      glow.addColorStop(1, `rgba(${accent},0)`)
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, size, size)

      // Кольца-эхо
      const ringCount = st === 'idle' ? 2 : 3
      for (let i = 0; i < ringCount; i++) {
        const phase = (time * (st === 'thinking' ? 0.9 : 0.55) + i / ringCount) % 1
        const ringR = baseRadius * (1.25 + phase * 1.5)
        const alpha = (1 - phase) * (st === 'idle' ? 0.10 : 0.22)
        ctx.beginPath()
        ctx.arc(cx, cy, ringR, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(${accent},${alpha})`
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // Дуга-«мысли» при thinking
      if (st === 'thinking') {
        for (let i = 0; i < 2; i++) {
          const start = time * (2 + i) + i * 2.4
          ctx.beginPath()
          ctx.arc(cx, cy, baseRadius * (1.55 + i * 0.25), start, start + Math.PI * 0.7)
          ctx.strokeStyle = `rgba(${accent},${0.5 - i * 0.2})`
          ctx.lineWidth = 2.5
          ctx.lineCap = 'round'
          ctx.stroke()
        }
      }

      // Ядро
      const corePulse = 0.03 * Math.sin(time * (st === 'idle' ? 1.2 : 3.2))
      const coreR = baseRadius * (1 + corePulse + energy * 0.05)
      const core = ctx.createRadialGradient(cx, cy - coreR * 0.25, coreR * 0.1, cx, cy, coreR)
      core.addColorStop(0, `rgba(${Math.min(r + 40, 255)},${Math.min(g + 40, 255)},${Math.min(b + 40, 255)},0.95)`)
      core.addColorStop(0.6, `rgba(${accent},0.85)`)
      core.addColorStop(1, `rgba(${accent},0.25)`)
      ctx.beginPath()
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
      ctx.fillStyle = core
      ctx.fill()

      // Волновая окружность (бары по кругу)
      const bars = 72
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(time * (st === 'listening' ? 0.15 : 0.05))
      for (let i = 0; i < bars; i++) {
        const angle = (i / bars) * Math.PI * 2
        const n =
          st === 'listening'
            ? 0.45 * noiseA(0.09) + 0.3 * noiseB(0.14) + 0.25 * Math.sin(i * 0.9 + time * 2)
            : st === 'speaking'
              ? 0.55 * noiseA(0.16) + 0.45 * noiseB(0.23) + 0.2 * Math.sin(i * 1.3 + time * 6)
              : st === 'thinking'
                ? 0.3 * noiseA(0.06) + 0.2 * Math.sin(i * 2 + time * 3)
                : 0.22 * noiseA(0.03) + 0.12 * Math.sin(i + time)
        const amp = baseRadius * (0.14 + Math.max(0, n) * (0.18 + energy * 0.55))
        const inner = baseRadius * 1.18
        const x1 = Math.cos(angle) * inner
        const y1 = Math.sin(angle) * inner
        const x2 = Math.cos(angle) * (inner + amp)
        const y2 = Math.sin(angle) * (inner + amp)
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.strokeStyle = `rgba(${accent},${0.25 + energy * 0.5})`
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.stroke()
      }
      ctx.restore()

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [size])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="max-w-full"
      role="img"
      aria-label={`Визуализация состояния: ${state}`}
    />
  )
}
