'use client'

import { ExternalLink, Music2, X } from 'lucide-react'

interface MusicPlayerProps {
  videoId: string
  title: string
  url: string
  accent: string
  onClose: () => void
}

/**
 * Встроенный YouTube-плеер: музыка играет прямо в приложении,
 * даже если панель диалога скрыта. Закрывается крестиком
 * или голосовой командой через клик по микрофону (перебивание).
 */
export function MusicPlayer({ videoId, title, url, accent, onClose }: MusicPlayerProps) {
  return (
    <div
      className="w-full overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-md"
      style={{ boxShadow: `0 0 30px -12px ${accent}` }}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Music2 className="size-4 shrink-0 animate-pulse" style={{ color: accent }} />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-white/85" title={title}>
              {title}
            </p>
            <p className="text-[10px] text-white/35">YouTube · играет сейчас</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={url}
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
      <iframe
        key={videoId}
        src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1`}
        title={title}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        className="block h-[150px] w-full border-0 sm:h-[180px]"
      />
    </div>
  )
}
