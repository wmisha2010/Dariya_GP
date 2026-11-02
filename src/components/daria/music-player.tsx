'use client'

import { ExternalLink, Music2, Pause, Play, SkipForward, X } from 'lucide-react'
import type { YtPlayback } from '@/hooks/use-youtube-audio'

export interface MusicTrackInfo {
  videoId: string
  title: string
  author: string
  url: string
}

interface MusicPlayerProps {
  track: MusicTrackInfo
  playback: YtPlayback
  /** YouTube-плеер не загрузился (нет доступа к youtube.com) */
  failed: boolean
  accent: string
  onToggle: () => void
  onNext: () => void
  onClose: () => void
}

/**
 * Панель фоновой музыки: играет аудио, видео скрыто. Кнопка на обложке —
 * пауза/продолжить, «дальше» листает очередь, крестик выключает совсем.
 */
export function MusicPlayer({ track, playback, failed, accent, onToggle, onNext, onClose }: MusicPlayerProps) {
  const playing = playback === 'playing'

  const status = failed
    ? 'Плеер не загрузился — открой на YouTube'
    : playing
      ? 'играет на фоне'
      : playback === 'paused'
        ? 'на паузе'
        : 'загружаю…'

  return (
    <div
      className="w-full overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-md"
      style={{ boxShadow: `0 0 30px -12px ${accent}` }}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Обложка — она же кнопка пауза/продолжить */}
        <button
          onClick={onToggle}
          title={playing ? 'Пауза' : 'Продолжить'}
          aria-label={playing ? 'Пауза' : 'Продолжить'}
          className="group relative size-11 shrink-0 overflow-hidden rounded-2xl border border-white/10 outline-none focus-visible:ring-2 focus-visible:ring-white/30 active:scale-95"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${track.videoId}/mqdefault.jpg`}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
          <span className="absolute inset-0 grid place-items-center bg-black/50 text-white transition-colors group-hover:bg-black/35">
            {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white/90" title={track.title}>
            {track.title}
          </p>
          <p className="flex min-w-0 items-center gap-1 text-[11px] text-white/40">
            <Music2
              className={`size-3 shrink-0 ${playing ? 'animate-pulse' : 'opacity-60'}`}
              style={{ color: accent }}
            />
            <span className="truncate">
              {status}
              {track.author && !failed ? ` · ${track.author}` : ''}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={onNext}
            title="Следующий трек"
            aria-label="Следующий трек"
            className="grid size-8 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <SkipForward className="size-4" />
          </button>
          <a
            href={track.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Открыть на YouTube"
            aria-label="Открыть на YouTube"
            className="grid size-8 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ExternalLink className="size-4" />
          </a>
          <button
            onClick={onClose}
            title="Выключить музыку"
            aria-label="Выключить музыку"
            className="grid size-8 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
