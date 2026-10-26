export interface Character {
  id: string
  slug: string
  name: string
  emoji: string
  tagline: string
  accent: string
  voicePitch: number
  voiceRate: number
  isDefault: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface MemoryItem {
  id: string
  content: string
  source: string
  createdAt: string
}

export interface DiaryItem {
  id: string
  day: string
  content: string
  updatedAt: string
}

export type AssistantState =
  | 'idle' // ждёт
  | 'listening' // слушает микрофон
  | 'thinking' // обдумывает
  | 'speaking' // говорит
