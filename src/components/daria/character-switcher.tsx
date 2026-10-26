'use client'

import { memo } from 'react'
import type { Character } from '@/lib/types'
import { cn } from '@/lib/utils'

interface CharacterSwitcherProps {
  characters: Character[]
  activeId: string | null
  onSelect: (character: Character) => void
}

export const CharacterSwitcher = memo(function CharacterSwitcher({
  characters,
  activeId,
  onSelect,
}: CharacterSwitcherProps) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 p-1.5 backdrop-blur-md"
      role="tablist"
      aria-label="Выбор ассистента"
    >
      {characters.map((character) => {
        const active = character.id === activeId
        return (
          <button
            key={character.id}
            role="tab"
            aria-selected={active}
            title={`${character.name} — ${character.tagline}`}
            onClick={() => onSelect(character)}
            className={cn(
              'group flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-200',
              active
                ? 'bg-white/10 text-white shadow-[0_0_18px_-6px_var(--accent-glow)]'
                : 'text-white/50 hover:bg-white/5 hover:text-white/80'
            )}
            style={{ '--accent-glow': `${character.accent}66` } as React.CSSProperties}
          >
            <span
              className="grid size-7 place-items-center rounded-full text-[13px]"
              style={{
                backgroundColor: active ? `${character.accent}26` : 'rgba(255,255,255,0.06)',
                boxShadow: active ? `0 0 12px -2px ${character.accent}88` : 'none',
              }}
            >
              {character.emoji}
            </span>
            <span className="hidden sm:inline">{character.name}</span>
          </button>
        )
      })}
    </div>
  )
})
