'use client'

import { AudioLines, Brain, Globe, Sparkles, Trash2, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Выбранный голос (id из белого списка /api/tts) */
  voiceId: string
  onVoiceChange: (id: string) => void
  voiceOn: boolean
  onVoiceToggle: () => void
  searchOn: boolean
  onSearchToggle: () => void
  onOpenMemory: () => void
  onClearChat: () => void
}

const VOICE_OPTIONS = [
  {
    id: 'svetlana',
    name: 'Светлана',
    engine: 'Microsoft Edge · нейроголос',
    description: 'Самое естественное звучание, эмоциональные интонации',
  },
  {
    id: 'irina',
    name: 'Ирина',
    engine: 'Piper · локальный синтез',
    description: 'Работает без интернета, без лимитов и ключей',
  },
] as const

function SwitchRow({
  icon,
  title,
  description,
  checked,
  onToggle,
}: {
  icon: React.ReactNode
  title: string
  description: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={checked}
      className="flex w-full items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3.5 py-3 text-left transition-colors hover:bg-white/[0.06]"
    >
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-xl transition-colors',
          checked ? 'bg-teal-400/15 text-teal-300' : 'bg-white/5 text-white/40'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-white/90">{title}</span>
        <span className="block truncate text-xs text-white/40">{description}</span>
      </span>
      <span
        className={cn(
          'relative h-6 w-10 shrink-0 rounded-full transition-colors',
          checked ? 'bg-teal-400/80' : 'bg-white/15'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
            checked ? 'left-[18px]' : 'left-0.5'
          )}
        />
      </span>
    </button>
  )
}

/** Настройки: голос, имя активации, озвучка, поиск, память и очистка истории */
export function SettingsDialog({
  open,
  onOpenChange,
  voiceId,
  onVoiceChange,
  voiceOn,
  onVoiceToggle,
  searchOn,
  onSearchToggle,
  onOpenMemory,
  onClearChat,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] gap-0 overflow-y-auto border-white/10 bg-[#12101f] p-5 text-white sm:max-w-md daria-scrollbar">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Настройки</DialogTitle>
          <DialogDescription className="text-white/45">
            Голос и поведение ассистента
          </DialogDescription>
        </DialogHeader>

        {/* Голос ассистента */}
        <section className="mt-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/35">
            <AudioLines className="size-3.5" />
            Голос ассистента
          </h3>
          <div className="flex flex-col gap-2">
            {VOICE_OPTIONS.map((voice) => {
              const active = voiceId === voice.id
              return (
                <button
                  key={voice.id}
                  onClick={() => onVoiceChange(voice.id)}
                  aria-pressed={active}
                  className={cn(
                    'flex items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all',
                    active
                      ? 'border-teal-400/50 bg-teal-400/10'
                      : 'border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
                  )}
                >
                  <Sparkles
                    className={cn('mt-0.5 size-4 shrink-0', active ? 'text-teal-300' : 'text-white/30')}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white/90">{voice.name}</span>
                      <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/45">
                        {voice.engine}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-white/40">
                      {voice.description}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'mt-1 size-4 shrink-0 rounded-full border-2 transition-colors',
                      active ? 'border-teal-300 bg-teal-300' : 'border-white/25'
                    )}
                  />
                </button>
              )
            })}
          </div>
        </section>

        {/* Переключатели */}
        <section className="mt-4 flex flex-col gap-2">
          <SwitchRow
            icon={voiceOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            title="Озвучка ответов"
            description={voiceOn ? 'Дария отвечает голосом' : 'Только текст, без звука'}
            checked={voiceOn}
            onToggle={onVoiceToggle}
          />
          <SwitchRow
            icon={<Globe className="size-4" />}
            title="Поиск в интернете"
            description={searchOn ? 'Ответы со свежими данными из сети' : 'Только память Дарии'}
            checked={searchOn}
            onToggle={onSearchToggle}
          />
        </section>

        {/* Действия */}
        <section className="mt-4 grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={onOpenMemory}
            className="h-auto flex-col gap-1 rounded-2xl border-white/10 bg-white/[0.03] py-3 hover:bg-white/[0.08]"
          >
            <Brain className="size-4 text-teal-300" />
            <span className="text-xs">Память и дневник</span>
          </Button>
          <Button
            variant="outline"
            onClick={onClearChat}
            className="h-auto flex-col gap-1 rounded-2xl border-red-400/20 bg-red-400/[0.04] py-3 text-red-300 hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-200"
          >
            <Trash2 className="size-4" />
            <span className="text-xs">Очистить чат</span>
          </Button>
        </section>

        {/* Версия интерфейса: маркер свежего билда — если её видно, кэш побеждён */}
        <p className="mt-4 text-center text-[10px] tracking-wide text-white/25">
          Дария · интерфейс v2.5 · сборка 14:33 · 2 ноября 2026
        </p>
      </DialogContent>
    </Dialog>
  )
}
