'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Brain, CalendarDays, Plus, Trash2 } from 'lucide-react'
import type { DiaryItem, MemoryItem } from '@/lib/types'

interface MemoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onMemoryChanged: () => void
}

export function MemoryDialog({ open, onOpenChange, onMemoryChanged }: MemoryDialogProps) {
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [diary, setDiary] = useState<DiaryItem[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [memRes, diaryRes] = await Promise.all([fetch('/api/memory'), fetch('/api/diary')])
      const memJson = await memRes.json()
      const diaryJson = await diaryRes.json()
      setMemories(memJson.memories ?? [])
      setDiary(diaryJson.entries ?? [])
    } catch {
      // тихо игнорируем — покажем пустое состояние
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const addMemory = async () => {
    const content = draft.trim()
    if (!content) return
    setAdding(true)
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, source: 'manual' }),
      })
      if (res.ok) {
        setDraft('')
        await load()
        onMemoryChanged()
      }
    } finally {
      setAdding(false)
    }
  }

  const removeMemory = async (id: string) => {
    setMemories((prev) => prev.filter((m) => m.id !== id))
    try {
      await fetch(`/api/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      onMemoryChanged()
    } catch {
      await load()
    }
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

  const formatDay = (day: string) => {
    const [y, m, d] = day.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      weekday: 'short',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] border-white/10 bg-[#0b1219] text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Brain className="size-5 text-teal-400" />
            Память и дневник
          </DialogTitle>
          <DialogDescription className="text-sm text-white/50">
            Ассистенты запоминают факты о тебе и ведут дневник разговоров
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="memory" className="mt-1">
          <TabsList className="grid w-full grid-cols-2 bg-white/5">
            <TabsTrigger value="memory" className="data-[state=active]:bg-white/10">
              Факты ({memories.length})
            </TabsTrigger>
            <TabsTrigger value="diary" className="data-[state=active]:bg-white/10">
              Дневник ({diary.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="memory" className="mt-3">
            <div className="flex gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addMemory()
                }}
                placeholder="Например: меня зовут Алексей"
                className="border-white/10 bg-white/5 text-white placeholder:text-white/30"
                maxLength={500}
              />
              <Button
                onClick={() => void addMemory()}
                disabled={adding || !draft.trim()}
                size="icon"
                className="shrink-0 bg-teal-500 text-black hover:bg-teal-400"
                aria-label="Добавить факт"
              >
                <Plus className="size-4" />
              </Button>
            </div>

            <div className="mt-3 max-h-[42vh] space-y-2 overflow-y-auto pr-1 daria-scrollbar">
              {loading ? (
                <p className="py-6 text-center text-sm text-white/40">Загрузка…</p>
              ) : memories.length === 0 ? (
                <p className="py-6 text-center text-sm leading-relaxed text-white/40">
                  Пока ничего не помню.
                  <br />
                  Расскажи о себе в разговоре — я запомню.
                </p>
              ) : (
                memories.map((memory) => (
                  <div
                    key={memory.id}
                    className="group flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.04] px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug text-white/85">{memory.content}</p>
                      <p className="mt-1 text-[11px] text-white/30">
                        {memory.source === 'manual' ? 'Добавил ты' : 'Из разговора'} · {formatDate(memory.createdAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => void removeMemory(memory.id)}
                      className="rounded-lg p-1.5 text-white/25 transition-colors hover:bg-red-500/10 hover:text-red-400"
                      aria-label="Забыть факт"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="diary" className="mt-3">
            <div className="max-h-[48vh] space-y-2 overflow-y-auto pr-1 daria-scrollbar">
              {loading ? (
                <p className="py-6 text-center text-sm text-white/40">Загрузка…</p>
              ) : diary.length === 0 ? (
                <p className="py-6 text-center text-sm leading-relaxed text-white/40">
                  Дневник пуст. Поговори с ассистентами — и здесь появятся записи о ваших разговорах.
                </p>
              ) : (
                diary.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-white/5 bg-white/[0.04] px-3 py-2.5">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-teal-400/80">
                      <CalendarDays className="size-3.5" />
                      {formatDay(entry.day)}
                    </div>
                    <p className="text-sm leading-snug text-white/80">{entry.content}</p>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
