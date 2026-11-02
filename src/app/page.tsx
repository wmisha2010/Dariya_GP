'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAudioPlayer } from '@/hooks/use-audio-player'
import { useSpeechRecognition } from '@/hooks/use-speech-recognition'
import { useTtsQueue } from '@/hooks/use-tts-queue'
import { useYouTubeAudio } from '@/hooks/use-youtube-audio'
import { ChatPanel } from '@/components/daria/chat-panel'
import { MemoryDialog } from '@/components/daria/memory-dialog'
import { MusicPlayer } from '@/components/daria/music-player'
import { SettingsDialog } from '@/components/daria/settings-dialog'
import { VoiceOrb } from '@/components/daria/voice-orb'
import { WaveBars } from '@/components/daria/wave-bars'
import { cn } from '@/lib/utils'
import type { AssistantState, Character, ChatMessage, MusicTrack } from '@/lib/types'
import {
  AudioLines,
  Brain,
  Globe,
  Mic,
  SendHorizontal,
  Settings,
  SlidersHorizontal,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react'

/** Доступные голоса ассистента — белый список в /api/tts, id совпадают */
const TTS_VOICES = [
  { id: 'svetlana', name: 'Светлана' },
  { id: 'irina', name: 'Ирина' },
] as const

/** Ключ localStorage, где хранится выбор голоса */
const TTS_VOICE_STORAGE_KEY = 'daria-tts-voice'

/** Пауза после конца озвучки, прежде чем снова включать микрофон (затухание эха) */
const ECHO_GRACE_MS = 3000
/** …но если пользователь активен (окно внимания) — ждём меньше, он вот-вот заговорит */
const ECHO_GRACE_AWAKE_MS = 800
/** Чёрное окно после активации: финалы фраз отстают от звука на 1–3с,
 *  и хвосты музыки/речи, доехавшие сразу после «Дария», не должны
 *  превращаться в команду. Секунда тишины после щелчка — норма */
const WAKE_COMMAND_BLACKOUT_MS = 1200

/** Метка текущей сборки: тост при загрузке показывает её, и пользователь
 *  мгновенно отличает живой билд от старого кэша в браузере */
const BUILD_LABEL = 'v2.4 · 14:10'

/** Голосовое управление музыкой: глаголы команды в любом месте фразы
 *  («найди в интернете музыку…», «сама включи…», «врубай рок»).
 *  (?![а-яё]) — граница слова: «выключила» не должна совпадать с «выключи»,
 *  иначе её собственный ответ распознаётся как команда — разговор с собой */
const MUSIC_VERB_RE =
  /(включи(?:те)?|включай(?:те)?|врубай(?:те)?|вруби(?:те)?|поставь(?:те)?|запусти(?:те)?|сыграй(?:те)?|играй(?:те)?|найди(?:те)?|поищи(?:те)?|открой(?:те)?|послушаем)(?![а-яё])/i
/** «выключи/останови/хватит …» — остановить плеер (в любом месте фразы) */
const MUSIC_STOP_RE =
  /(выключи(?:те)?|выруб[а-яё]*|останови(?:те)?|заглуши[а-яё]*|хватит)(?![а-яё])/i
/** Отрицание: «не включай музыку» — это не команда играть */
const MUSIC_NEGATION_RE = /не\s+(?:включай|играй|запускай|ставь|трогай)/i
/** «пауза…» — заморозить фоновую музыку */
const MUSIC_PAUSE_RE = /пауз[а-яё]*/i
/** «продолжай (музыку)» — возобновить после паузы */
const MUSIC_RESUME_RE =
  /^\s*(?:продолж[а-яё]*|возобнов[а-яё]*|включи обратно|играй дальше)\s*(?:музык[а-яё]*|песн[а-яё]*)?\s*$/i
/** «дальше / следующий трек» — перелистать очередь */
const MUSIC_NEXT_RE =
  /^\s*(?:дальше|следующ[а-яё]*(?:\s+(?:песн|трек|музык)[а-яё]*)?|друг[а-яё]*\s+(?:песн|трек)[а-яё]*|смен[а-яё]*\s+(?:песн|трек)[а-яё]*|пропусти[а-яё]*|next)\s*$/i

/** Мусор в команде: «включи музыку из интернета» — ищем без «из интернета» */
const MUSIC_FILLER_RE =
  /\s*(?:из\s+(?:интернета?|сети|веба)|в\s+интернете?|в\s+онлайне?|онлайн|пожалуйста|что-?нибудь|что\s+нибудь|любую|любим[а-яё]*|какую-?нибудь|сама(?![а-яё])|сами(?![а-яё])|мне)\s*/gi
/** Общие слова в начале запроса: «музыку Кино» → «Кино», «лирику Сектор Газа» → «Сектор Газа» */
const MUSIC_NOUN_HEAD_RE =
  /^\s*(?:музыку|музыка|музыки|песню|песня|песенку|песни|трек|трека|треки|композицию|композиция|клип|плейлист|ремикс|альбом|сборник|хит|мелодию|мелодия|лирику|лирика|лирики|лирик[а-яё]*)\s+/i
/** Запрос состоит только из общих слов — конкретики нет, играем популярное */
const MUSIC_NOUN_ONLY_RE =
  /^\s*(?:музык[а-яё]*|песн[а-яё]*|трек[а-яё]*|клип[а-яё]*|плейлист[а-яё]*|ремикс[а-яё]*|альбом[а-яё]*|сборник[а-яё]*|хит[а-яё]*|мелоди[а-яё]*|лирик[а-яё]*|чего-?нибудь|что-?нибудь)\s*$/i

/** Что играть на «просто включи музыку» — без конкретного исполнителя */
const DEFAULT_MUSIC_QUERIES = [
  'популярная музыка',
  'новинки музыки',
  'лучшие хиты',
  'музыка для души',
  'красивая музыка',
]

/* ─────────────────────── Голосовая активация (как у Алисы) ─────────────────
 * Микрофон слушает постоянно: назови имя активации — ассистент просыпается и
 * выполняет следующую фразу. Названное во время её речи/музыки — перебивание.
 * Чтобы она не слышала саму себя: услышанное во время озвучки сравнивается
 * с текстом, который она произносит — совпадает = эхо, игнорируем.          */

/** Имя активации выбирается в настройках. Для каждого — список вариантов, как
 *  распознаватель пишет его на слух, включая свои ошибки: «Дарию» он часто
 *  слышит как «далее». Короткое «Даша» по умолчанию — распознаётся надёжнее
 *  редкого полного имени и почти не звучит в эфирах, поэтому играющее радио
 *  не будит ассистент случайно */
const WAKE_WORDS: Record<string, { label: string; variants: string[] }> = {
  dasha: { label: 'Даша', variants: ['даша', 'дашу', 'даше', 'даши', 'дэша', 'дашенька'] },
  daria: {
    label: 'Дария',
    variants: [
      'дария', 'дарья', 'дарью', 'дарьи', 'дарье', 'дарии', 'дарина', 'дарине', 'дарин', 'дэрия', 'далее',
    ],
  },
  dusya: { label: 'Дуся', variants: ['дуся', 'дуси', 'дусю', 'дусе', 'дусь', 'дюся'] },
  alisa: { label: 'Алиса', variants: ['алиса', 'алису', 'алисе', 'алисы', 'алыса', 'алиска'] },
}
/** Имя активации по умолчанию — короткое и чётко распознаваемое */
const DEFAULT_WAKE_WORD = 'dasha'
/** Ключ localStorage: выбранное имя активации */
const WAKE_WORD_KEY = 'daria-wake-word'

/** Расстояние Левенштейна — насколько одно слово «похоже» на другое */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = curr
  }
  return prev[b.length]
}

/** Слово совпадает с именем активации: точно или с опиской распознавателя
 *  (не дальше 1–2 букв). Первая буква обязана совпадать, иначе «Маша» будила
 *  бы «Дашу» */
function isWakeToken(token: string, variants: string[]): boolean {
  for (const v of variants) {
    if (token === v) return true
    if (token[0] === v[0] && levenshtein(token, v) <= (v.length >= 7 ? 2 : 1)) return true
  }
  return false
}

/** Есть ли имя активации в распознанной фразе (любое слово целиком):
 *  «даша», «эй даша», «ну даша включай» — всё активирует */
function matchesWake(clean: string, variants: string[]): boolean {
  const tokens = clean.toLowerCase().match(/[а-яё]+/g) ?? []
  return tokens.some((t) => isWakeToken(t, variants))
}

/** Срезаем имя активации из фразы — и в начале («эй Дария, включи музыку»),
 *  и в середине («ну Дария, давай радио») — чтобы оно не попало в поиск */
function makeWakeStripRe(variants: string[]): RegExp {
  const alt = variants
    .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .join('|')
  return new RegExp(
    `(?:^|\\s)(?:(?:эй|ок(?:ей)?|слушай)\\s+)?(?:${alt})(?=$|[\\s,.!?;:—-])`,
    'gi'
  )
}

/** Сколько после активации ждём команду, прежде чем снова «заснуть» */
const ATTENTION_MS = 12_000
/** Ключ localStorage: запоминать ли безрукой режим между визитами */
const HANDS_FREE_KEY = 'daria-hands-free'

/* ───────────────────── Громкость голосом («сделай тише») ───────────────── */
const VOL_UP_RE =
  /(?:сделай\s+)?(?:погромче|громче)|(?:подними|прибавь|увеличь|добавь|выкрути)\s+(?:громкость|звук)/i
const VOL_DOWN_RE =
  /(?:сделай\s+)?(?:потише|тише)|(?:убавь|уменьши|снизь|опусти|прикрути)\s+(?:громкость|звук)/i
const VOL_MAX_RE =
  /(?:максимальн[а-яё]*\s+громкость|громкость\s+(?:на\s+)?максимум|полн[а-яё]*\s+громкость|громкость\s+(?:на\s+)?полн(?:ую|ую)|выкрути\s+громкость)/i
const VOL_MIN_RE = /(?:минимальн[а-яё]*\s+громкость|громкость\s+(?:на\s+)?минимум)/i
const VOL_SET_RE = /(?:громкость|звук)\s*(?:на\s*)?(\d{1,3})\s*(?:%|процент[а-яё]*)?/i
const VOL_MUTE_RE = /(?:выключи|убери|отключи)\s+звук/i
const VOL_TOPIC_RE = /(?:громкость|звук)/i

const MUSIC_VOL_KEY = 'daria-music-volume'
const TTS_VOL_KEY = 'daria-tts-volume'

/** Нормализация текста для сравнения «услышанного» с произносимым */
function normEchoText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/g, ' ')
    .trim()
}

/** «найди в интернете музыку Сектор Газа, пожалуйста» → «сектор газа», «включи лирику» → '' (популярное) */
function extractMusicQuery(raw: string): string {
  let q = raw.replace(MUSIC_VERB_RE, ' ').replace(MUSIC_FILLER_RE, ' ')
  let prev = ''
  while (prev !== q) {
    prev = q
    q = q.replace(MUSIC_NOUN_HEAD_RE, '')
  }
  q = q.replace(/^[\s,.:;!?—-]+|[\s,.:;!?—-]+$/g, '').trim()
  if (!q || MUSIC_NOUN_ONLY_RE.test(q)) return ''
  return q.slice(0, 120)
}
/** В команде должна быть музыкальная тема — чтобы «включи свет» не запускал плеер */
const MUSIC_TOPIC_RE =
  /(песн|музык|трек|плейлист|композици|ремикс|альбом|рэп|лирик|фонк|шансон|кантри|панк|(?:^|\s)(?:рок|поп|рэп|радио)(?![а-яё])|джаз|блюз|классическ|инструментальн|фортепиан|гитар|металл|электро(?![а-яё])|танцевальн|спокойн|грустн|весел|весёл|романтич|колыбельн|хит|клип|мелод|исполнител|расслаб|концентрац|фонов|звук[а-яё]*\s+природ|дожд|ютуб|youtube|видео|эфир|плеер)/i
/** Тема для выключения: шире — «выключи ютуб/радио/видео» тоже гасит плеер */
const STOP_TOPIC_RE =
  /(песн|музык|трек|плейлист|композици|ремикс|альбом|радио|ютуб|youtube|видео|клип|эфир|плеер|мелод|лирик|хит|рэп|рок|поп|джаз|блюз|шансон|фонк)/i

export default function Home() {
  const { toast } = useToast()

  // Данные
  const [characters, setCharacters] = useState<Character[]>([])
  const [activeCharacter, setActiveCharacter] = useState<Character | null>(null)
  /** Персонажи так и не загрузились после автоповторов — показываем кнопку «Повторить» */
  const [charactersError, setCharactersError] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamingText, setStreamingText] = useState('')

  // Настройки
  const [searchOn, setSearchOn] = useState(false)
  const [voiceOn, setVoiceOn] = useState(true)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Раскрытый тулбар «Дополнительно» над строкой ввода */
  const [toolsOpen, setToolsOpen] = useState(false)
  /** Сессия фоновой музыки: очередь треков из интернета + индекс текущего */
  const [music, setMusic] = useState<{ tracks: MusicTrack[]; index: number } | null>(null)

  // Ввод
  const [inputValue, setInputValue] = useState('')
  const [interim, setInterim] = useState('')
  const [micListening, setMicListening] = useState(false)
  const [busy, setBusy] = useState(false)
  /** Окно внимания после «Дария»: следующая фраза — команда без имени */
  const [awake, setAwake] = useState(false)
  /** Громкость музыки и голоса 0-100 — голосовые команды + localStorage */
  const [musicVolume, setMusicVolume] = useState(100)
  const [ttsVolume, setTtsVolume] = useState(100)

  const sendingRef = useRef(false)
  const voiceOnRef = useRef(voiceOn)
  voiceOnRef.current = voiceOn
  const searchOnRef = useRef(searchOn)
  searchOnRef.current = searchOn
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** Окно внимания — зеркальный ref, чтобы читать в колбэках распознавания */
  const awakeRef = useRef(false)
  awakeRef.current = awake
  const awakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Текст, который Дария сейчас произносит: для отбрасывания собственного
   * эха — если услышанное совпадает с ним, микрофон слушает её, а не человека */
  const spokenTextRef = useRef('')
  /** Остаток стрим-ответа после перебивания: в чат пишется, но молчит */
  const ttsSuppressedRef = useRef(false)
  /** AudioContext для щелчка-подтверждения активации */
  const chimeCtxRef = useRef<AudioContext | null>(null)

  // ─── Эхо-защита: микрофон не должен слышать голос самого ассистента ─────
  const [micDesired, setMicDesired] = useState(false) // пользователь включил микрофон
  const micDesiredRef = useRef(false)
  const ttsSpeakingRef = useRef(false)
  const musicPlayingRef = useRef(false)
  /** Зеркала состояния плеера для колбэков без перерегистрации
   *  (yt: 'loading' | 'playing' | 'paused' | 'idle'; audio: 'playing' | 'paused' | 'stopped') */
  const musicPlaybackRef = useRef<string>('stopped')
  const musicToggleRef = useRef<() => void>(() => {})
  const wasAudibleRef = useRef(false)
  const echoMuteUntilRef = useRef(0)
  /** Черное окно после активации — хвосты чужого звука не станут командами */
  const commandBlackoutUntilRef = useRef(0)
  const lastBusyToastRef = useRef(0)

  // ─── Озвучка: серверный нейроголос Edge (голос выбирается кнопкой «Голос») ─
  const [ttsVoice, setTtsVoice] = useState<string>('svetlana')

  // Восстанавливаем выбранный голос с прошлого визита
  useEffect(() => {
    const saved = window.localStorage.getItem(TTS_VOICE_STORAGE_KEY)
    if (saved && TTS_VOICES.some((v) => v.id === saved)) setTtsVoice(saved)
  }, [])

  /** Выбор голоса из настроек с сохранением */
  const setVoice = useCallback((id: string) => {
    setTtsVoice(id)
    window.localStorage.setItem(TTS_VOICE_STORAGE_KEY, id)
  }, [])

  /** Циклическое переключение голоса с сохранением выбора */
  const cycleVoice = useCallback(() => {
    setTtsVoice((prev) => {
      const idx = TTS_VOICES.findIndex((v) => v.id === prev)
      const next = TTS_VOICES[(idx + 1) % TTS_VOICES.length]
      window.localStorage.setItem(TTS_VOICE_STORAGE_KEY, next.id)
      return next.id
    })
  }, [])

  const currentVoiceLabel =
    TTS_VOICES.find((v) => v.id === ttsVoice)?.name ?? TTS_VOICES[0].name

  // ─── Имя активации: выбирается в настройках, помним с прошлого визита ───
  const [wakeWordId, setWakeWordId] = useState<string>(DEFAULT_WAKE_WORD)
  useEffect(() => {
    const saved = window.localStorage.getItem(WAKE_WORD_KEY)
    if (saved && WAKE_WORDS[saved]) setWakeWordId(saved)
  }, [])
  /** Смена имени активации с сохранением выбора */
  const setWakeWord = useCallback((id: string) => {
    setWakeWordId(id)
    window.localStorage.setItem(WAKE_WORD_KEY, id)
  }, [])
  const wake = WAKE_WORDS[wakeWordId] ?? WAKE_WORDS[DEFAULT_WAKE_WORD]
  /** Срезальщик имени из фразы — пересобирается под выбранное имя */
  const wakeStripRe = useMemo(() => makeWakeStripRe(wake.variants), [wake])

  // Восстанавливаем громкости с прошлого визита.
  // ВАЖНО: Number(null) === 0 — пустой localStorage «делал» громкость нулём,
  // и музыка играла беззвучно. Считаем только реально сохранённые значения.
  useEffect(() => {
    const restore = (key: string, apply: (v: number) => void) => {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 0 && n <= 100) apply(Math.round(n))
    }
    restore(MUSIC_VOL_KEY, setMusicVolume)
    restore(TTS_VOL_KEY, setTtsVolume)
  }, [])

  /** Изменить громкость музыки с запоминанием */
  const changeMusicVolume = useCallback((value: number) => {
    const v = Math.min(100, Math.max(0, Math.round(value / 5) * 5))
    setMusicVolume(v)
    window.localStorage.setItem(MUSIC_VOL_KEY, String(v))
    return v
  }, [])

  /** Изменить громкость голоса Дарии с запоминанием */
  const changeTtsVolume = useCallback((value: number) => {
    const v = Math.min(100, Math.max(0, Math.round(value / 5) * 5))
    setTtsVolume(v)
    window.localStorage.setItem(TTS_VOL_KEY, String(v))
    return v
  }, [])

  /** Браузер заблокировал автозапуск звука — объясняем, как включить */
  const handlePlaybackBlocked = useCallback(() => {
    toast({
      title: 'Браузер заблокировал звук',
      description: 'Коснись экрана в любом месте — и я продолжу говорить голосом.',
    })
  }, [toast])

  const tts = useTtsQueue({
    voiceId: ttsVoice,
    volume: ttsVolume,
    onPlaybackBlocked: handlePlaybackBlocked,
  })

  // ─── Активация голосом: окно внимания, щелчок, перебивание ─────────────

  /** Короткий двухнотный щелчок — подтверждение, что Дария проснулась */
  const playChime = useCallback(() => {
    try {
      if (!chimeCtxRef.current) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        chimeCtxRef.current = new Ctor()
      }
      const ctx = chimeCtxRef.current
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
      const now = ctx.currentTime
      for (const [i, freq] of [784, 1174.7].entries()) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        const t0 = now + i * 0.11
        gain.gain.setValueAtTime(0, t0)
        gain.gain.linearRampToValueAtTime(0.12, t0 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(t0)
        osc.stop(t0 + 0.24)
      }
    } catch {
      /* без щелчка тоже ок */
    }
  }, [])

  /** Открыть/продлить окно внимания; во время речи Дарии — это перебивание */
  const activateAssistant = useCallback(() => {
    if (ttsSpeakingRef.current) {
      tts.stop()
      ttsSuppressedRef.current = true // остаток ответа пишется в чат, но молчит
    }
    // Как у Алисы: назвала имя при играющей музыке — музыка встаёт на паузу,
    // чтобы команда слышалась чисто (вернуть: «продолжай музыку»)
    if (musicPlaybackRef.current === 'playing') musicToggleRef.current()
    playChime()
    setAwake(true)
    // Хвосты, распознанные сразу после активации, — чужой звук, не команды
    commandBlackoutUntilRef.current = Date.now() + WAKE_COMMAND_BLACKOUT_MS
    if (awakeTimerRef.current) clearTimeout(awakeTimerRef.current)
    awakeTimerRef.current = setTimeout(() => {
      awakeTimerRef.current = null
      setAwake(false)
    }, ATTENTION_MS)
  }, [tts, playChime])

  /** Продлить окно внимания после выполненной команды — «громче», «дальше»,
 *  «выключи» идут цепочкой без повторного «Дария» (как у Алисы) */
  const keepAwake = useCallback(() => {
    if (!micDesiredRef.current) return
    setAwake(true)
    if (awakeTimerRef.current) clearTimeout(awakeTimerRef.current)
    awakeTimerRef.current = setTimeout(() => {
      awakeTimerRef.current = null
      setAwake(false)
    }, ATTENTION_MS)
  }, [])

  /** Закрыть окно внимания (команда принята или микрофон выключен) */
  const deactivateAssistant = useCallback(() => {
    if (awakeTimerRef.current) {
      clearTimeout(awakeTimerRef.current)
      awakeTimerRef.current = null
    }
    setAwake(false)
  }, [])

  /** Эхо-щит: совпадает ли услышанное с тем, что Дария сейчас говорит */
  const isSpokenEcho = useCallback((text: string) => {
    const spoken = normEchoText(spokenTextRef.current)
    if (!spoken) return false
    const heard = normEchoText(text)
    if (!heard) return false
    if (heard.length >= 6 && spoken.includes(heard)) return true
    const heardWords = heard.split(' ').filter((w) => w.length > 1)
    if (heardWords.length < 2) return false
    const spokenWords = new Set(spoken.split(' ').filter((w) => w.length > 1))
    let hits = 0
    for (const w of heardWords) if (spokenWords.has(w)) hits += 1
    return hits / heardWords.length >= 0.6
  }, [])

  // Текст произнесённой реплики живёт ещё 5с после конца речи — за это время
  // распознавание может отдать финал её же фразы, и он будет отброшен как эхо
  useEffect(() => {
    if (tts.speaking) return
    const timer = setTimeout(() => {
      spokenTextRef.current = ''
    }, 5000)
    return () => clearTimeout(timer)
  }, [tts.speaking])

  // ─── Фоновая музыка: очередь из интернета + два движка ─────────────────
  // Аудио-движок (Audius/радио — прямые потоки) и YouTube-движок (скрытый
  // iframe, запасной вариант): включается тот, чей трек сейчас в очереди.
  const musicErrorsRef = useRef(0)
  const handleMusicEnded = useCallback(() => {
    setMusic((prev) => (prev ? { ...prev, index: (prev.index + 1) % prev.tracks.length } : prev))
  }, [])
  const handleMusicError = useCallback(() => {
    // Трек не заиграл — пробуем следующий; если весь список битый — закрываем
    musicErrorsRef.current += 1
    setMusic((prev) => {
      if (!prev) return null
      if (musicErrorsRef.current >= prev.tracks.length) return null
      return { ...prev, index: (prev.index + 1) % prev.tracks.length }
    })
  }, [])

  const currentTrack = music ? (music.tracks[music.index] ?? null) : null
  const currentIsYt = currentTrack?.source === 'youtube'

  const yt = useYouTubeAudio({
    videoId: currentIsYt ? currentTrack?.videoId ?? null : null,
    volume: musicVolume,
    onEnded: handleMusicEnded,
    onError: handleMusicError,
  })
  const audioPlayer = useAudioPlayer({
    src: currentTrack && !currentIsYt ? currentTrack.audioSrc ?? null : null,
    volume: musicVolume,
    onEnded: handleMusicEnded,
    onError: handleMusicError,
  })

  const musicPlayback = currentIsYt ? yt.playback : audioPlayer.playback
  const musicToggle = currentIsYt ? yt.toggle : audioPlayer.toggle
  /** Музыка сейчас реально слышна (сессия активна и не на паузе) */
  const musicAudible = music !== null && musicPlayback !== 'paused'
  /** Зеркала для колбэков активации: pause по «Дария» без пересоздания колбэка */
  musicPlaybackRef.current = musicPlayback
  musicToggleRef.current = musicToggle

  // Пока Дария говорит или слушает команду — музыка тише; отпустила — вернулась
  useEffect(() => {
    const ducked = tts.speaking || awake
    yt.duck(ducked)
    audioPlayer.duck(ducked)
  }, [tts.speaking, awake, yt.duck, audioPlayer.duck])

  ttsSpeakingRef.current = tts.speaking
  musicPlayingRef.current = musicAudible

  /** Локальный ответ без LLM: музыкальные команды отвечают мгновенно */
  const assistantLocalReply = useCallback(
    (content: string) => {
      setMessages((prev) => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: 'assistant', content, createdAt: new Date().toISOString() },
      ])
      // Эхо-щит должен знать, что она произносит
      spokenTextRef.current = content
      if (voiceOnRef.current) tts.speak(content)
    },
    [tts]
  )

  // ─── Отправка сообщения ─────────────────────────────────────────────────
  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim()
      if (!text || sendingRef.current || !activeCharacter) return
      sendingRef.current = true
      setBusy(true)
      setInputValue('')
      setInterim('')
      tts.stop()
      ttsSuppressedRef.current = false // новая реплика — снова говорим голосом
      spokenTextRef.current = ''

      const now = new Date().toISOString()
      const localId = `local-${Date.now()}`
      setMessages((prev) => [
        ...prev,
        { id: localId, role: 'user', content: text, createdAt: now },
      ])

      try {
        // ─── Громкость голосом: «громче», «тише», «громкость на 40» ────────
        const unmuteHit = /включи\s+звук|верни\s+(?:звук|громкость)/i.test(text)
        const volumeWanted =
          unmuteHit ||
          VOL_UP_RE.test(text) ||
          VOL_DOWN_RE.test(text) ||
          VOL_MAX_RE.test(text) ||
          VOL_MIN_RE.test(text) ||
          VOL_MUTE_RE.test(text) ||
          (VOL_TOPIC_RE.test(text) && VOL_SET_RE.test(text))
        if (volumeWanted) {
          // Играет музыка — крутим её громкость, иначе — громкость голоса Дарии
          const musicTarget = music !== null
          const current = musicTarget ? musicVolume : ttsVolume
          let next = current
          if (VOL_MAX_RE.test(text)) next = 100
          else if (VOL_MIN_RE.test(text)) next = 5
          else if (VOL_MUTE_RE.test(text)) next = 0
          else if (unmuteHit) next = current === 0 ? 40 : current
          else if (VOL_UP_RE.test(text)) next = current + 20
          else if (VOL_DOWN_RE.test(text)) next = current - 20
          else {
            const m = VOL_SET_RE.exec(text)
            if (m?.[1]) next = parseInt(m[1], 10)
          }
          const applied = musicTarget ? changeMusicVolume(next) : changeTtsVolume(next)
          const arrow = applied > current ? '🔊' : applied < current ? '🔉' : '🔊'
          keepAwake()
          assistantLocalReply(
            applied === 0
              ? 'Выключила звук 🔇'
              : `Громкость ${musicTarget ? 'музыки' : 'моего голоса'} — ${applied}% ${arrow}`
          )
          return
        }

        // «Стоп / стой / хватит / всё» при играющем плеере — глушим без темы:
        // так команда работает и на радио, и на ютубе, и на плейлисте
        if (music && /^\s*(?:стоп|стой|хватит|всё)\s*[.!?]*\s*$/i.test(text)) {
          tts.stop()
          setMusic(null)
          keepAwake()
          assistantLocalReply('Всё, выключила 🎧')
          return
        }

        // Голосовое управление музыкой: «выключи музыку/радио/ютуб» — гасим
        // плеер без LLM, что бы там ни играло (аудио, радио или YouTube)
        if (MUSIC_STOP_RE.test(text) && STOP_TOPIC_RE.test(text)) {
          const hadPlayback = music !== null
          tts.stop()
          setMusic(null)
          keepAwake()
          assistantLocalReply(hadPlayback ? 'Всё, выключила 🎧' : 'Музыка и так не играет 🎧')
          return
        }

        // «Пауза» — заморозить фон, «продолжай» — возобновить после паузы
        if (
          music &&
          (MUSIC_PAUSE_RE.test(text) ||
            (musicPlayback === 'paused' && MUSIC_RESUME_RE.test(text)))
        ) {
          const wasPlaying = musicPlayback === 'playing'
          musicToggle()
          keepAwake()
          assistantLocalReply(wasPlaying ? 'Поставила музыку на паузу ⏸' : 'Продолжаю музыку ▶')
          return
        }

        // «Дальше / следующий трек» — листаем очередь
        if (music && MUSIC_NEXT_RE.test(text)) {
          const nextIndex = (music.index + 1) % music.tracks.length
          setMusic({ ...music, index: nextIndex })
          keepAwake()
          assistantLocalReply(`Ставлю следующую: «${music.tracks[nextIndex].title}» 🎵`)
          return
        }

        // «Включи музыку / найди песню… из интернета» — ищем и играем фоном
        if (
          MUSIC_VERB_RE.test(text) &&
          MUSIC_TOPIC_RE.test(text) &&
          !MUSIC_NEGATION_RE.test(text)
        ) {
          const query = extractMusicQuery(text)
          const chosen =
            query || DEFAULT_MUSIC_QUERIES[Math.floor(Math.random() * DEFAULT_MUSIC_QUERIES.length)]
          try {
            const res = await fetch('/api/music', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: chosen, mode: query ? 'specific' : 'generic' }),
            })
            if (!res.ok) throw new Error('nothing found')
            const json = (await res.json()) as { tracks?: MusicTrack[] }
            // «включи радио» — станции вперёд живого эфира
            const wantRadio = /радио/i.test(text)
            const raw = (json.tracks ?? []).filter((t) => t.audioSrc || t.videoId)
            const tracks = wantRadio
              ? [...raw.filter((t) => t.source === 'radio'), ...raw.filter((t) => t.source !== 'radio')]
              : raw
            if (!tracks.length) throw new Error('nothing found')
            tts.stop()
            musicErrorsRef.current = 0
            setMusic({ tracks, index: 0 })
            keepAwake()
            const first = tracks[0]
            assistantLocalReply(
              `Включаю «${first.title}»${first.author ? ` — ${first.author}` : ''} 🎵`
            )
          } catch {
            assistantLocalReply(
              'Не нашла музыку в интернете — попробуй назвать исполнителя или трек 🙈'
            )
          }
          return
        }

        // Запрос к ассистенту с автоповтором: перегрузка API (429/503) обычно
        // проходит за секунды — молча ждём и пробуем снова; красная ошибка —
        // только если не помогло даже после трёх попыток.
        // Это диалог, а не пульт — окно внимания закрываем
        deactivateAssistant()
        let res: Response | null = null
        let lastErrorText = ''
        for (let attempt = 0; attempt < 3; attempt++) {
          const r = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              characterId: activeCharacter.id,
              message: text,
              search: searchOnRef.current,
            }),
          })
          if (r.ok && r.body) {
            res = r
            break
          }
          const payload = (await r.json().catch(() => null)) as { error?: string } | null
          lastErrorText = payload?.error ?? `Ошибка ${r.status}`
          const retryable = r.status === 429 || r.status === 503 || r.status >= 500
          if (!retryable || attempt === 2) break
          if (attempt === 0) toast({ title: 'Модель притормозила — пробую ещё раз…' })
          await new Promise((resolve) => setTimeout(resolve, 3500 * (attempt + 1)))
        }
        if (!res || !res.body) {
          throw new Error(lastErrorText || 'Ассистент не смог ответить')
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let full = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const delta = decoder.decode(value, { stream: true })
          if (!delta) continue
          full += delta
          setStreamingText(full)
          // Эхо-щит должен знать текст, который она сейчас произносит
          spokenTextRef.current = full
          if (voiceOnRef.current && !ttsSuppressedRef.current) tts.enqueue(delta)
        }
        if (voiceOnRef.current && !ttsSuppressedRef.current) tts.endStream()

        setStreamingText('')
        if (!full.trim()) {
          // Пустой ответ — не тишина, а понятное сообщение
          throw new Error('Ассистент не успел ответить — попробуй ещё раз')
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: full.trim(),
            createdAt: new Date().toISOString(),
          },
        ])
      } catch (error) {
        setStreamingText('')
        toast({
          title: 'Не получилось',
          description: error instanceof Error ? error.message : 'Ассистент не смог ответить',
          variant: 'destructive',
        })
      } finally {
        sendingRef.current = false
        setBusy(false)
      }
    },
    [activeCharacter, assistantLocalReply, music, musicPlayback, musicToggle, musicVolume, ttsVolume, changeMusicVolume, changeTtsVolume, toast, tts, keepAwake, deactivateAssistant]
  )

  // ─── Микрофон: постоянное слушание + активация голосом ─────────────────
  const recognition = useSpeechRecognition({
    onInterim: (text) => {
      if (Date.now() < echoMuteUntilRef.current) return
      const clean = text.trim()
      // Пока Дария говорит (или играет музыка вне окна внимания) — ловим ТОЛЬКО
      // имя активации: это перебивание. Всё остальное услышанное — её голос
      // или текст песни, молча глотаем (защита от слуха самой себя)
      if (ttsSpeakingRef.current || (musicPlayingRef.current && !awakeRef.current)) {
        if (clean && matchesWake(clean, wake.variants) && !isSpokenEcho(clean)) activateAssistant()
        setInterim('')
        return
      }
      if (matchesWake(clean, wake.variants) && !awakeRef.current) activateAssistant()
      setInterim(clean)
    },
    onFinal: (text) => {
      const clean = text.trim()
      if (!clean) return
      // Чёрное окно сразу после активации: доезжают хвосты чужого звука
      if (Date.now() < commandBlackoutUntilRef.current) return
      const wakeHit = matchesWake(clean, wake.variants)
      const command = wakeHit
        ? clean
            .replace(wakeStripRe, ' ')
            .replace(/\s+([,.!?;:—-])/g, '$1') // «ну , давай» → «ну, давай»
            .replace(/^[\s,.!?;:—-]+|[\s,.!?;:—-]+$/g, '')
            .trim()
        : clean.trim()
      const audible = ttsSpeakingRef.current || musicPlayingRef.current
      const inGrace = Date.now() < echoMuteUntilRef.current

      // Щит от «разговора с самой собой»: пока Дария говорит/играет музыка
      // или звук только-только стих — принимаем ТОЛЬКО имя активации.
      // Всё остальное — её голос, текст песни или их хвосты
      if ((audible || inGrace) && !wakeHit) return
      if (wakeHit) {
        // Имя во время её речи/музыки = перебивание; в тишине = активация.
        // Сначала — эхо-щит: не её ли это собственные слова
        if (isSpokenEcho(clean)) return
        activateAssistant()
      } else if (!awakeRef.current) {
        // Без имени команда принимается только в окне внимания
        return
      }

      if (!command) {
        // Просто «Дария» — продлеваем окно внимания
        if (awakeRef.current) {
          if (awakeTimerRef.current) clearTimeout(awakeTimerRef.current)
          awakeTimerRef.current = setTimeout(() => {
            awakeTimerRef.current = null
            setAwake(false)
          }, ATTENTION_MS)
        }
        return
      }
      if (sendingRef.current) {
        // Ассистент ещё отвечает — не теряем молча, а подсказываем
        if (Date.now() - lastBusyToastRef.current > 4000) {
          lastBusyToastRef.current = Date.now()
          toast({ title: 'Секунду…', description: 'Ассистент ещё отвечает — повтори сразу после' })
        }
        return
      }
      // Окно внимания закрывает сам send(): для музыкальных команд оно
      // остаётся открытым (цепочки «громче», «дальше»), для чата — закрывается
      void send(command)
    },
    onError: (code) => {
      toast({
        title: 'Микрофон недоступен',
        description:
          code === 'not-allowed' || code === 'service-not-allowed'
            ? 'Разреши доступ к микрофону в настройках браузера'
            : `Ошибка распознавания: ${code}`,
        variant: 'destructive',
      })
    },
  })

  const setMicOn = useCallback((on: boolean) => {
    micDesiredRef.current = on
    setMicDesired(on)
  }, [])

  const toggleMic = useCallback(() => {
    if (!recognition.supported) {
      toast({
        title: 'Голосовой ввод недоступен',
        description: 'Открой приложение в Chrome или Edge — там работает распознавание речи',
        variant: 'destructive',
      })
      return
    }
    if (recognition.listening) {
      setMicOn(false)
      window.localStorage.setItem(HANDS_FREE_KEY, '0')
      recognition.stop()
      setInterim('')
      deactivateAssistant()
      return
    }
    // Безрукой режим: слушаю постоянно, активируюсь по имени активации.
    // Тап по микрофону, пока я говорю — тоже перебивание
    setMicOn(true)
    window.localStorage.setItem(HANDS_FREE_KEY, '1')
    activateAssistant()
    recognition.start()
  }, [recognition, setMicOn, toast, activateAssistant, deactivateAssistant])

  // Возвращаем безрукой режим с прошлого визита — микрофон снова постоянно слушает
  const startRecognition = recognition.start
  useEffect(() => {
    if (window.localStorage.getItem(HANDS_FREE_KEY) !== '1') return
    setMicOn(true)
    const timer = setTimeout(() => startRecognition(), 500)
    return () => clearTimeout(timer)
  }, [setMicOn, startRecognition])

  useEffect(() => {
    setMicListening(recognition.listening)
  }, [recognition.listening])

  // Микрофон при безруком режиме НЕ выключается во время речи/музыки — иначе
  // не услышит «Дария». Вместо отключения работает эхо-щит в обработчиках,
  // а сразу после тишины — пауза на затухание звука: если пользователь активен
  // (окно внимания) — короткая, если звуки кончились сами — подлиннее
  const audible = tts.speaking || musicAudible
  useEffect(() => {
    if (audible && !wasAudibleRef.current) {
      wasAudibleRef.current = true
    } else if (!audible && wasAudibleRef.current) {
      wasAudibleRef.current = false
      echoMuteUntilRef.current =
        Date.now() + (awakeRef.current ? ECHO_GRACE_AWAKE_MS : ECHO_GRACE_MS)
    }
  }, [audible])

  useEffect(
    () => () => {
      if (awakeTimerRef.current) clearTimeout(awakeTimerRef.current)
    },
    []
  )

  // ─── Состояние ассистента для орбиса ────────────────────────────────────
  const assistantState: AssistantState = tts.speaking
    ? 'speaking'
    : musicAudible
      ? 'speaking'
      : awake || micListening
        ? 'listening'
        : busy
          ? 'thinking'
          : 'idle'

  // ─── Загрузка персонажей и истории ──────────────────────────────────────
  const loadHistory = useCallback(async (characterId: string) => {
    try {
      const res = await fetch(`/api/messages?characterId=${encodeURIComponent(characterId)}`)
      const json = await res.json()
      setMessages(json.messages ?? [])
    } catch {
      setMessages([])
    }
  }, [])

  /** Грузим персонажей с автоповторами: dev-сервер мог перезапускаться, сеть —
   *  мигать. Без повторов одна неудача оставляла приложение навсегда на «Загрузке…» */
  const loadCharacters = useCallback(
    async (attempt = 0): Promise<boolean> => {
      try {
        const res = await fetch('/api/characters')
        if (!res.ok) throw new Error(`status ${res.status}`)
        const json = await res.json()
        const list: Character[] = json.characters ?? []
        if (!list.length) throw new Error('empty list')
        setCharacters(list)
        setCharactersError(false)
        // Раз персонажи загрузились — страница точно живая. Один раз за сессию
        // показываем метку сборки: увидел тост «v2.2» — значит кэш побеждён.
        try {
          if (sessionStorage.getItem('daria-build-toast') !== BUILD_LABEL) {
            sessionStorage.setItem('daria-build-toast', BUILD_LABEL)
            toast({
              title: `Дария · сборка ${BUILD_LABEL}`,
              description: 'Свежая версия загружена — старый кэш не активен',
            })
          }
        } catch {
          /* без sessionStorage тост просто покажется чаще */
        }
        const first = list.find((c) => c.isDefault) ?? list[0] ?? null
        if (first) {
          setActiveCharacter(first)
          await loadHistory(first.id)
        }
        return true
      } catch {
        // 5 попыток с нарастающей паузой 0.8с → 1.6с → 3.2с → 6.4с → 12.8с
        if (attempt < 5) {
          await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt))
          return loadCharacters(attempt + 1)
        }
        setCharactersError(true)
        return false
      }
    },
    [loadHistory, toast]
  )

  useEffect(() => {
    void loadCharacters()
  }, [loadCharacters])

  // ─── Очистить чат ───────────────────────────────────────────────────────
  const clearChat = useCallback(async () => {
    if (!activeCharacter) return
    tts.stop()
    setMusic(null)
    try {
      await fetch(`/api/messages?characterId=${encodeURIComponent(activeCharacter.id)}`, {
        method: 'DELETE',
      })
      setMessages([])
      toast({ title: 'История очищена', description: `${activeCharacter.name} всё ещё помнит факты о тебе` })
    } catch {
      toast({ title: 'Не удалось очистить историю', variant: 'destructive' })
    }
  }, [activeCharacter, toast, tts])

  // ─── Быстрые действия ───────────────────────────────────────────────────
  const toggleVoice = () => {
    setVoiceOn((prev) => {
      if (prev) tts.stop()
      return !prev
    })
  }

  const accent = activeCharacter?.accent ?? '#2dd4bf'

  // Динамическая статус-строка под полем ввода (как на референсе)
  const statusLine = tts.speaking
    ? `Говорю… скажи «${wake.label}», чтобы перебить`
    : awake
      ? interim
        ? `Слушаю: «${interim}»`
        : 'Слушаю! Говори команду…'
      : micListening
        ? interim
          ? `Слушаю: «${interim}»`
          : music
            ? `♪ Музыка на фоне · скажи «${wake.label}» и команду`
            : `Слушаю… скажи «${wake.label}»`
        : music
          ? musicPlayback === 'paused'
            ? '♪ Музыка на паузе'
            : '♪ Музыка на фоне'
          : busy
            ? 'Думаю…'
            : 'Чат идёт потоком | Автоскролл'

  const canSend = inputValue.trim().length > 0 && !busy

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) void send(inputValue)
    }
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#0b0817] text-white">
      {/* Фоновые свечения — тёмно-фиолетовый градиент как на референсе */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-44 left-1/3 h-[460px] w-[760px] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-[130px]" />
        <div className="absolute -bottom-48 -left-36 h-[480px] w-[580px] rounded-full bg-violet-700/15 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[300px] w-[400px] rounded-full bg-fuchsia-600/5 blur-[100px]" />
      </div>

      {/* Шапка: мини-голограмма, имя и настройки */}
      <header className="relative z-10 flex items-center justify-between gap-3 border-b border-white/5 bg-[#0d0a1c]/70 px-4 py-2.5 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3">
          {/* Голограмма-орбис: тап — активировать микрофон, Дария слушает */}
          <button
            onClick={toggleMic}
            aria-label={micListening ? 'Остановить безрукой режим' : 'Включить безрукой режим'}
            title={
              micListening
                ? 'Слушаю постоянно — нажми, чтобы остановить'
                : `Включи — я буду слушать постоянно, активация словом «${wake.label}»`
            }
            className="grid size-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/5 outline-none transition-all duration-200 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/20 active:scale-95"
            style={{ boxShadow: `0 0 26px -10px ${accent}` }}
          >
            <VoiceOrb state={assistantState} accent={accent} size={42} />
          </button>
          <div className="leading-tight">
            <h1 className="text-lg font-bold tracking-wide">ДАРИЯ</h1>
            <p className="text-[11px] text-white/40">голосовой ИИ-ассистент</p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setSettingsOpen(true)}
          className="gap-1.5 rounded-full border-white/15 bg-white/5 text-[11px] font-semibold uppercase tracking-wider text-white/80 hover:bg-white/10 hover:text-white"
        >
          <Settings className="size-4" />
          Настройки
        </Button>
      </header>

      {/* Основная область: диалог сверху, композер снизу */}
      <main className="relative z-10 mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-3 pt-2 sm:px-6">
        {/* Диалог — занимает верх и скроллится по мере заполнения */}
        <div className="min-h-0 flex-1">
          <ChatPanel
            messages={messages}
            streamingText={streamingText}
            accent={accent}
            emptyHint={`Начни разговор — ${activeCharacter?.name ?? 'ассистент'} услышит и запомнит важное о тебе`}
          />
        </div>

        {/* Композер: плеер, тулбар «Дополнительно» и строка ввода */}
        <div className="shrink-0 pb-2 pt-2">
          {/* Плеер: музыка играет на фоне даже во время переписки */}
          {music && currentTrack && (
            <div className="mb-2.5">
              <MusicPlayer
                track={currentTrack}
                playback={musicPlayback}
                failed={currentIsYt ? yt.failed : false}
                accent={accent}
                onToggle={musicToggle}
                onNext={() =>
                  setMusic((prev) =>
                    prev ? { ...prev, index: (prev.index + 1) % prev.tracks.length } : prev
                  )
                }
                onClose={() => setMusic(null)}
              />
            </div>
          )}

          {/* Скрытый контейнер YouTube-плеера: слышим музыку, видео не видно */}
          {music && currentIsYt && (
            <div
              id={yt.containerId}
              aria-hidden="true"
              className="pointer-events-none fixed left-0 top-0 z-0 size-1.5 overflow-hidden opacity-[0.01]"
            />
          )}

          {/* Персонажи не загрузились после автоповторов — повтор вручную */}
          {charactersError && !activeCharacter && (
            <div className="mx-auto mb-2.5 w-fit rounded-2xl border border-red-400/30 bg-red-400/[0.06] px-4 py-2.5 text-center backdrop-blur-md">
              <p className="text-xs text-red-200/90">Не удалось загрузить персонажей</p>
              <button
                onClick={() => {
                  setCharactersError(false)
                  void loadCharacters()
                }}
                className="mt-1.5 rounded-full border border-teal-400/40 bg-teal-400/10 px-3.5 py-1 text-xs font-medium text-teal-300 transition-colors hover:bg-teal-400/20"
              >
                Повторить
              </button>
            </div>
          )}

          {/* Звук заблокирован autoplay-политикой — ждём первого касания */}
          {tts.blocked && (
            <p
              role="status"
              className="mx-auto mb-2.5 w-fit animate-pulse rounded-full border border-amber-400/40 bg-amber-400/10 px-3.5 py-1.5 text-xs font-medium text-amber-300"
            >
              Коснись экрана — включу голос
            </p>
          )}

          {/* Тулбар «Дополнительно»: раскрывается над строкой ввода */}
          {toolsOpen && (
            <div className="mx-auto mb-2.5 w-fit rounded-2xl border border-white/10 bg-[#151126]/95 px-2 py-2 shadow-xl backdrop-blur-md">
              <div className="flex items-center gap-1">
                <ToolButton
                  icon={<Globe className="size-4" />}
                  label="Поиск"
                  active={searchOn}
                  onClick={() => setSearchOn((v) => !v)}
                />
                <ToolButton
                  icon={<AudioLines className="size-4" />}
                  label={currentVoiceLabel}
                  onClick={cycleVoice}
                />
                <ToolButton
                  icon={voiceOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                  label="Озвучка"
                  active={voiceOn}
                  onClick={toggleVoice}
                />
                <ToolButton
                  icon={<Brain className="size-4" />}
                  label="Память"
                  onClick={() => {
                    setToolsOpen(false)
                    setMemoryOpen(true)
                  }}
                />
                <ToolButton
                  icon={<Trash2 className="size-4" />}
                  label="Очистить"
                  danger
                  onClick={() => {
                    setToolsOpen(false)
                    void clearChat()
                  }}
                />
              </div>
              <p className="mt-1 text-center text-[10px] text-white/35">Дополнительно</p>
            </div>
          )}

          {/* Строка ввода: микрофон · волна/текст · дополнительно · отправить */}
          <div
            className="flex items-center gap-2 rounded-full border border-white/10 bg-[#151126]/90 p-1.5 backdrop-blur-md"
            style={{ boxShadow: `0 10px 36px -18px ${accent}80` }}
          >
            {/* Микрофон: циановый круг, при записи — красный пульс */}
            <button
              onClick={toggleMic}
              className={cn(
                'grid size-11 shrink-0 place-items-center rounded-full text-white transition-all duration-200 active:scale-95',
                micListening
                  ? 'animate-pulse bg-red-500/90 shadow-[0_0_24px_-4px_rgba(239,68,68,0.7)]'
                  : 'hover:brightness-110'
              )}
              style={micListening ? undefined : { backgroundColor: accent }}
              aria-label={micListening ? 'Остановить запись' : 'Говорить голосом'}
              title={
                micListening
                  ? 'Слушаю постоянно — нажми, чтобы выключить'
                  : `Включить голосовую активацию: скажи «${wake.label}» — и я слушаю`
              }
            >
              {micListening ? <Square className="size-4" /> : <Mic className="size-5" />}
            </button>

            {/* Волна во время записи — тап по ней тоже останавливает */}
            {micListening ? (
              <button
                onClick={toggleMic}
                title="Нажми, чтобы остановить запись"
                className="flex h-11 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-full px-2 outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              >
                <WaveBars state="listening" className="max-w-full" />
              </button>
            ) : (
              <Textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  recognition.supported
                    ? 'Напиши или скажи голосом…'
                    : 'Напиши сообщение… (голос работает в Chrome/Edge)'
                }
                rows={1}
                className="max-h-32 min-h-11 flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm text-white placeholder:text-white/30 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            )}

            <button
              onClick={() => setToolsOpen((v) => !v)}
              aria-expanded={toolsOpen}
              aria-label="Дополнительно"
              title="Дополнительно"
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-full transition-colors',
                toolsOpen ? 'bg-white/15 text-white' : 'text-white/50 hover:bg-white/10 hover:text-white'
              )}
            >
              <SlidersHorizontal className="size-4" />
            </button>

            <Button
              onClick={() => void send(inputValue)}
              disabled={!canSend}
              size="icon"
              className={cn(
                'size-11 shrink-0 rounded-full border transition-all disabled:opacity-30',
                canSend
                  ? 'border-transparent text-black hover:brightness-110'
                  : 'border-white/20 bg-transparent text-white/70 hover:bg-white/10'
              )}
              style={canSend ? { backgroundColor: accent } : undefined}
              aria-label="Отправить"
            >
              <SendHorizontal className="size-4" />
            </Button>
          </div>

          {/* Статус: состояние ассистента / автоскролл */}
          <p className="mt-2 text-center text-[11px] text-white/30" role="status">
            {statusLine}
          </p>
        </div>
      </main>

      <MemoryDialog open={memoryOpen} onOpenChange={setMemoryOpen} onMemoryChanged={() => {}} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        voiceId={ttsVoice}
        onVoiceChange={setVoice}
        wakeWordId={wakeWordId}
        onWakeChange={setWakeWord}
        voiceOn={voiceOn}
        onVoiceToggle={toggleVoice}
        searchOn={searchOn}
        onSearchToggle={() => setSearchOn((v) => !v)}
        onOpenMemory={() => {
          setSettingsOpen(false)
          setMemoryOpen(true)
        }}
        onClearChat={() => {
          setSettingsOpen(false)
          void clearChat()
        }}
      />
    </div>
  )
}

interface ToolButtonProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
  danger?: boolean
}

/** Кнопка тулбара «Дополнительно»: иконка + подпись снизу */
function ToolButton({ icon, label, onClick, active, danger }: ToolButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-[62px] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] transition-colors',
        danger
          ? 'text-white/55 hover:bg-red-400/10 hover:text-red-300'
          : active
            ? 'bg-teal-400/10 text-teal-300'
            : 'text-white/55 hover:bg-white/10 hover:text-white'
      )}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </button>
  )
}
