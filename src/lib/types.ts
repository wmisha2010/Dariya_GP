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

/** Трек фоновой музыки, найденный в интернете (один из источников) */
export interface MusicTrack {
  source: 'mp3mn' | 'radio' | 'youtube'
  title: string
  author: string
  /** Обложка (если источник её отдал) */
  artwork?: string
  /** Страница трека — «открыть в интернете» */
  url: string
  /** Прямой аудиопоток — для источников audius/radio */
  audioSrc?: string
  /** Только для youtube: id видео для скрытого плеера */
  videoId?: string
}
