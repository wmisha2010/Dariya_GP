# -*- coding: utf-8 -*-
"""v2.5: убрать голосовую активацию (wake-word), микрофон по кнопке,
ютуб-фолбэк: если трек не заиграл в скрытом плеере — открыть в самом YouTube.
Каждая замена обязана встретиться ровно 1 раз (иначе падаем)."""
import re, sys

P = 'src/app/page.tsx'
src = open(P, encoding='utf-8').read()

def sub_once(pat, repl, n_expected=1, flags=0):
    global src
    new, n = re.subn(pat, lambda m: repl, src, flags=flags)
    if n != n_expected:
        print(f'FAIL: {pat[:70]!r} -> {n} совпадений (ожидалось {n_expected})')
        sys.exit(1)
    src = new

# ── 1. Импорты: useMemo больше не нужен, добавляем ToastAction ──────────────
sub_once(r"import \{ useCallback, useEffect, useMemo, useRef, useState \} from 'react'",
         "import { useCallback, useEffect, useRef, useState } from 'react'\n"
         "import { ToastAction } from '@/components/ui/toast'")

# ── 2. Константы эхо-паузы и чёрного окна ───────────────────────────────────
sub_once(r"/\*\* Пауза после конца озвучки[\s\S]*?const WAKE_COMMAND_BLACKOUT_MS = 1200",
"/** Пауза после конца озвучки, прежде чем снова принимать речь (затухание эха) */\n"
"const ECHO_GRACE_MS = 3000\n"
"/** Чёрное окно после включения микрофона: финалы фраз отстают от звука на 1–3с,\n"
" *  и хвосты музыки/речи, доехавшие сразу после тапа по микрофону, не должны\n"
" *  превращаться в команду. Секунда тишины после щелчка — норма */\n"
"const MIC_TAIL_BLACKOUT_MS = 1200")

# ── 3. Метка сборки ─────────────────────────────────────────────────────────
sub_once(r"const BUILD_LABEL = 'v2\.4 · 14:10'", "const BUILD_LABEL = 'v2.5 · 14:33'")

# ── 4. Блок wake-word → isMediaCommand ──────────────────────────────────────
sub_once(r"/\* [─]+ Голосовая активация[\s\S]*?const HANDS_FREE_KEY = 'daria-hands-free'",
"/* ───────────── Микрофон = пульт во время играющей музыки ───────────────\n"
" * Пока играет радио/плеер, распознаватель всё равно слышит эфир. Принимаем\n"
" * только команды плеера и громкости — слова песни и речь ди-джея молча\n"
" * глотаются, иначе они уезжали бы в чат как сообщения пользователя.         */\n"
"\n"
"/** Во время играющей музыки микрофон принимает только команды плеера */\n"
"function isMediaCommand(text: string): boolean {\n"
"  return (\n"
"    /^\\s*(?:стоп|стой|хватит|всё)\\s*[.!?]*\\s*$/i.test(text) ||\n"
"    (MUSIC_STOP_RE.test(text) && STOP_TOPIC_RE.test(text)) ||\n"
"    MUSIC_PAUSE_RE.test(text) ||\n"
"    MUSIC_RESUME_RE.test(text) ||\n"
"    MUSIC_NEXT_RE.test(text) ||\n"
"    VOL_UP_RE.test(text) ||\n"
"    VOL_DOWN_RE.test(text) ||\n"
"    VOL_MAX_RE.test(text) ||\n"
"    VOL_MIN_RE.test(text) ||\n"
"    VOL_MUTE_RE.test(text) ||\n"
"    /включи\\s+звук|верни\\s+(?:звук|громкость)/i.test(text) ||\n"
"    (VOL_TOPIC_RE.test(text) && VOL_SET_RE.test(text)) ||\n"
"    (MUSIC_VERB_RE.test(text) && MUSIC_TOPIC_RE.test(text) && !MUSIC_NEGATION_RE.test(text))\n"
"  )\n"
"}")

# ── 5. normEchoText больше не нужен ────────────────────────────────────────
sub_once(r"/\*\* Нормализация текста для сравнения «услышанного» с произносимым \*/\n"
         r"function normEchoText\(s: string\): string \{[\s\S]*?\n\}\n\n", "")

# ── 6. Состояние awake ─────────────────────────────────────────────────────
sub_once(r"\n  /\*\* Окно внимания после «Дария»: следующая фраза — команда без имени \*/\n"
         r"  const \[awake, setAwake\] = useState\(false\)\n", "\n")

# ── 7. Refs: awakeRef/timer/spokenText/micDesired ──────────────────────────
sub_once(r"  /\*\* Окно внимания — зеркальный ref[\s\S]*?const micDesiredRef = useRef\(false\)\n",
"  /** Остаток стрим-ответа после перебивания: в чат пишется, но молчит */\n"
"  const ttsSuppressedRef = useRef(false)\n"
"  /** AudioContext для щелчка-подтверждения включения микрофона */\n"
"  const chimeCtxRef = useRef<AudioContext | null>(null)\n"
"\n")

# ── 8. Комментарий commandBlackout ─────────────────────────────────────────
sub_once(r"  /\*\* Черное окно после активации — хвосты чужого звука не станут командами \*/",
"  /** Чёрное окно после включения микрофона — хвосты чужого звука не станут командами */")

# ── 9. wake-состояние в компоненте ─────────────────────────────────────────
sub_once(r"  // [─]+ Имя активации[\s\S]*?const wakeStripRe = useMemo\(\(\) => makeWakeStripRe\(wake\.variants\), \[wake\]\)\n\n", "")

# ── 10. Заголовок секции щелчка ────────────────────────────────────────────
sub_once(r"  // [─]+ Активация голосом: окно внимания, щелчок, перебивание[^\n]*",
"  // ─── Щелчок микрофона и перебивание ──────────────────────────────────────")

sub_once(r"  /\*\* Короткий двухнотный щелчок — подтверждение, что Дария проснулась \*/",
"  /** Короткий двухнотный щелчок — подтверждение, что микрофон включён */")

# ── 11. activateAssistant/keepAwake/deactivate/isSpokenEcho/5s-эффект ──────
sub_once(r"  /\*\* Открыть/продлить окно внимания[\s\S]*?\}, \[tts\.speaking\]\)\n\n", "")

# ── 12. assistantLocalReply: переносим выше, убираем spokenTextRef ─────────
sub_once(r"  const tts = useTtsQueue\(\{\n"
         r"    voiceId: ttsVoice,\n"
         r"    volume: ttsVolume,\n"
         r"    onPlaybackBlocked: handlePlaybackBlocked,\n"
         r"  \}\)\n",
"  const tts = useTtsQueue({\n"
"    voiceId: ttsVoice,\n"
"    volume: ttsVolume,\n"
"    onPlaybackBlocked: handlePlaybackBlocked,\n"
"  })\n"
"\n"
"  /** Локальный ответ без LLM: плеерные команды отвечают мгновенно */\n"
"  const assistantLocalReply = useCallback(\n"
"    (content: string) => {\n"
"      setMessages((prev) => [\n"
"        ...prev,\n"
"        { id: `assistant-${Date.now()}`, role: 'assistant', content, createdAt: new Date().toISOString() },\n"
"      ])\n"
"      if (voiceOnRef.current) tts.speak(content)\n"
"    },\n"
"    [tts]\n"
"  )\n")

sub_once(r"  /\*\* Локальный ответ без LLM: музыкальные команды отвечают мгновенно \*/\n"
         r"  const assistantLocalReply = useCallback\(\n[\s\S]*?\n  \)\n\n", "")

# ── 13. Музыка: currentTrackRef + ютуб-фолбэк ──────────────────────────────
sub_once(r"  const musicErrorsRef = useRef\(0\)\n",
"  const musicErrorsRef = useRef(0)\n"
"  /** Зеркало текущего трека для колбэка ошибки — он объявлен ниже по коду */\n"
"  const currentTrackRef = useRef<MusicTrack | null>(null)\n")

sub_once(r"  const handleMusicError = useCallback\(\(\) => \{\n"
         r"    // Трек не заиграл — пробуем следующий; если весь список битый — закрываем\n"
         r"    musicErrorsRef\.current \+= 1\n"
         r"    setMusic\(\(prev\) => \{\n"
         r"      if \(!prev\) return null\n"
         r"      if \(musicErrorsRef\.current >= prev\.tracks\.length\) return null\n"
         r"      return \{ \.\.\.prev, index: \(prev\.index \+ 1\) % prev\.tracks\.length \}\n"
         r"    \}\)\n"
         r"  \}, \[\]\)",
"""  const handleMusicError = useCallback(() => {
    const failedTrack = currentTrackRef.current
    // Ютуб не заиграл в нашем скрытом плеере — открываем его в самом YouTube:
    // там он играет всегда. Нашу очередь гасим, чтобы не звучало в два голоса
    if (failedTrack?.source === 'youtube') {
      const url =
        failedTrack.url ||
        (failedTrack.videoId ? `https://www.youtube.com/watch?v=${failedTrack.videoId}` : '')
      setMusic(null)
      if (!url) return
      // Попап без свежего жеста браузер блокирует — тогда зовём кнопкой в тосте
      const win = window.open(url, '_blank')
      if (win) {
        win.opener = null
        assistantLocalReply('Здесь ютуб не заиграл — открыла его в новой вкладке, в самом YouTube ▶')
      } else {
        toast({
          title: 'Ютуб не заиграл внутри',
          description: 'Одна кнопка — и он включится в самом YouTube',
          action: (
            <ToastAction
              altText="Открыть в YouTube"
              onClick={() => {
                const w = window.open(url, '_blank')
                if (w) w.opener = null
              }}
            >
              Открыть в YouTube
            </ToastAction>
          ),
        })
      }
      return
    }
    // Остальные источники: трек не заиграл — пробуем следующий;
    // если весь список битый — закрываем плеер
    musicErrorsRef.current += 1
    setMusic((prev) => {
      if (!prev) return null
      if (musicErrorsRef.current >= prev.tracks.length) return null
      return { ...prev, index: (prev.index + 1) % prev.tracks.length }
    })
  }, [assistantLocalReply, toast])""")

sub_once(r"  const currentTrack = music \? \(music\.tracks\[music\.index\] \?\? null\) : null\n",
"  const currentTrack = music ? (music.tracks[music.index] ?? null) : null\n"
"  currentTrackRef.current = currentTrack\n")

sub_once(r"  /\*\* Зеркала для колбэков активации: pause по «Дария» без пересоздания колбэка \*/",
"  /** Зеркала для перебивания: тап по микрофону ставит музыку на паузу */")

# ── 14. Приглушение музыки: только на время речи ───────────────────────────
sub_once(r"  // Пока Дария говорит или слушает команду — музыка тише; отпустила — вернулась\n"
         r"  useEffect\(\(\) => \{\n"
         r"    const ducked = tts\.speaking \|\| awake\n"
         r"    yt\.duck\(ducked\)\n"
         r"    audioPlayer\.duck\(ducked\)\n"
         r"  \}, \[tts\.speaking, awake, yt\.duck, audioPlayer\.duck\]\)",
"  // Пока Дария говорит — музыка тише; замолчала — вернулась\n"
"  useEffect(() => {\n"
"    yt.duck(tts.speaking)\n"
"    audioPlayer.duck(tts.speaking)\n"
"  }, [tts.speaking, yt.duck, audioPlayer.duck])")

# ── 15. send(): чистка spokenText/keepAwake/deactivate ─────────────────────
sub_once(r"      spokenTextRef\.current = ''\n", "")
sub_once(r"^          keepAwake\(\)\n", "", n_expected=5, flags=re.M)
sub_once(r"^            keepAwake\(\)\n", "", n_expected=1, flags=re.M)
sub_once(r"        // Это диалог, а не пульт — окно внимания закрываем\n"
         r"        deactivateAssistant\(\)\n", "")
sub_once(r"          setStreamingText\(full\)\n"
         r"          // Эхо-щит должен знать текст, который она сейчас произносит\n"
         r"          spokenTextRef\.current = full\n",
"          setStreamingText(full)\n")
sub_once(r"tts, keepAwake, deactivateAssistant\]", "tts]")

# ── 16. Обработчики распознавания ──────────────────────────────────────────
sub_once(r"    onInterim: \(text\) => \{[\s\S]*?      void send\(command\)\n    \},",
"""    onInterim: (text) => {
      const clean = text.trim()
      // Говорит Дария или звук только-только стих — это её эхо, глотаем
      if (ttsSpeakingRef.current || Date.now() < echoMuteUntilRef.current) {
        setInterim('')
        return
      }
      // Текст песни/эфира не показываем как «Слушаю: …» — это не слова человека
      if (musicPlayingRef.current) {
        setInterim('')
        return
      }
      setInterim(clean)
    },
    onFinal: (text) => {
      const clean = text.trim()
      if (!clean) return
      // Хвосты чужого звука сразу после включения микрофона — не команды
      if (Date.now() < commandBlackoutUntilRef.current) return
      // Щит от «разговора с самой собой»: её голос и пауза на затухание после
      if (ttsSpeakingRef.current || Date.now() < echoMuteUntilRef.current) return
      // Играет музыка/эфир — микрофон работает пультом плеера: принимаем
      // только команды, слова песни и речь ди-джея молча глотаем
      if (musicPlayingRef.current && !isMediaCommand(clean)) return
      if (sendingRef.current) {
        // Ассистент ещё отвечает — не теряем молча, а подсказываем
        if (Date.now() - lastBusyToastRef.current > 4000) {
          lastBusyToastRef.current = Date.now()
          toast({ title: 'Секунду…', description: 'Ассистент ещё отвечает — повтори сразу после' })
        }
        return
      }
      void send(clean)
    },""")

sub_once(r"  // [─]+ Микрофон: постоянное слушание \+ активация голосом[^\n]*",
"  // ─── Микрофон: слушает, пока включён кнопкой ─────────────────────────────")

# ── 17. toggleMic: ручное включение/выключение ─────────────────────────────
sub_once(r"  const setMicOn = useCallback\(\(on: boolean\) => \{[\s\S]*?\}, \[setMicOn, startRecognition\]\)\n",
"""  const toggleMic = useCallback(() => {
    if (!recognition.supported) {
      toast({
        title: 'Голосовой ввод недоступен',
        description: 'Открой приложение в Chrome или Edge — там работает распознавание речи',
        variant: 'destructive',
      })
      return
    }
    if (recognition.listening) {
      setMicListening(false)
      recognition.stop()
      setInterim('')
      return
    }
    // Включаю микрофон. Если Дария говорит — перебиваем: остаток ответа
    // дописывается в чат, но молчит
    if (ttsSpeakingRef.current) {
      tts.stop()
      ttsSuppressedRef.current = true
    }
    // Играющая музыка ставится на паузу, чтобы команду было слышно чисто
    // (вернуть: «продолжай музыку» или кнопка плеера)
    if (musicPlaybackRef.current === 'playing') musicToggleRef.current()
    playChime()
    // Хвосты чужого звука сразу после включения — не команды
    commandBlackoutUntilRef.current = Date.now() + MIC_TAIL_BLACKOUT_MS
    setMicListening(true)
    recognition.start()
  }, [recognition, toast, tts, playChime])
""")

# ── 18. Эхо-пауза: единая для всех ─────────────────────────────────────────
sub_once(r"  // Микрофон при безруком режиме НЕ выключается во время речи/музыки — иначе\n"
         r"  // не услышит «Дария»\. Вместо отключения работает эхо-щит в обработчиках,\n"
         r"  // а сразу после тишины — пауза на затухание звука: если пользователь активен\n"
         r"  // \(окно внимания\) — короткая, если звуки кончились сами — подлиннее\n"
         r"  const audible = tts\.speaking \|\| musicAudible\n"
         r"  useEffect\(\(\) => \{\n"
         r"    if \(audible && !wasAudibleRef\.current\) \{\n"
         r"      wasAudibleRef\.current = true\n"
         r"    \} else if \(!audible && wasAudibleRef\.current\) \{\n"
         r"      wasAudibleRef\.current = false\n"
         r"      echoMuteUntilRef\.current =\n"
         r"        Date\.now\(\) \+ \(awakeRef\.current \? ECHO_GRACE_AWAKE_MS : ECHO_GRACE_MS\)\n"
         r"    \}\n"
         r"  \}, \[audible\]\)",
"  // Микрофон на время речи не выключаем — эхо отсекают обработчики, а сразу\n"
"  // после тишины держится короткая пауза на затухание звука\n"
"  const audible = tts.speaking || musicAudible\n"
"  useEffect(() => {\n"
"    if (audible && !wasAudibleRef.current) {\n"
"      wasAudibleRef.current = true\n"
"    } else if (!audible && wasAudibleRef.current) {\n"
"      wasAudibleRef.current = false\n"
"      echoMuteUntilRef.current = Date.now() + ECHO_GRACE_MS\n"
"    }\n"
"  }, [audible])")

# ── 19. Cleanup-эффект awake-таймера ───────────────────────────────────────
sub_once(r"  useEffect\(\n"
         r"    \(\) => \(\) => \{\n"
         r"      if \(awakeTimerRef\.current\) clearTimeout\(awakeTimerRef\.current\)\n"
         r"    \},\n"
         r"    \[\]\n"
         r"  \)\n\n", "")

# ── 20. Орбис: состояние без awake ─────────────────────────────────────────
sub_once(r"      : awake \|\| micListening", "      : micListening")

# ── 21. Статус-строка ──────────────────────────────────────────────────────
sub_once(r"  const statusLine = tts\.speaking[\s\S]*?: 'Чат идёт потоком \| Автоскролл'",
"""  const statusLine = tts.speaking
    ? 'Говорю… тапни по микрофону, чтобы перебить'
    : micListening
      ? interim
        ? `Слушаю: «${interim}»`
        : music
          ? '♪ Музыка на фоне · говори команду плеера'
          : 'Слушаю… говори'
      : music
        ? musicPlayback === 'paused'
          ? '♪ Музыка на паузе'
          : '♪ Музыка на фоне'
        : busy
          ? 'Думаю…'
          : 'Чат идёт потоком | Автоскролл'""")

# ── 22. Подсказки кнопок микрофона ─────────────────────────────────────────
sub_once(r"aria-label=\{micListening \? 'Остановить безрукой режим' : 'Включить безрукой режим'\}",
         "aria-label={micListening ? 'Выключить микрофон' : 'Включить микрофон'}")
sub_once(r"            title=\{\n"
         r"              micListening\n"
         r"                \? 'Слушаю постоянно — нажми, чтобы остановить'\n"
         r"                : `Включи — я буду слушать постоянно, активация словом «\$\{wake\.label\}»`\n"
         r"            \}",
"""            title={
              micListening
                ? 'Слушаю — нажми, чтобы выключить микрофон'
                : 'Нажми — я слушаю и выполняю голосовые команды'
            }""")
sub_once(r"              title=\{\n"
         r"                micListening\n"
         r"                  \? 'Слушаю постоянно — нажми, чтобы выключить'\n"
         r"                  : `Включить голосовую активацию: скажи «\$\{wake\.label\}» — и я слушаю`\n"
         r"              \}",
"""              title={
                micListening
                  ? 'Слушаю — нажми, чтобы выключить'
                  : 'Включить микрофон: говори команду голосом'
              }""")

# ── 23. Настройки: без wake-пропсов ────────────────────────────────────────
sub_once(r"        wakeWordId=\{wakeWordId\}\n        onWakeChange=\{setWakeWord\}\n", "")

open(P, 'w', encoding='utf-8').write(src)
print('page.tsx: все замены применены')

# ── settings-dialog.tsx ────────────────────────────────────────────────────
S = 'src/components/daria/settings-dialog.tsx'
s = open(S, encoding='utf-8').read()

def sub_s(pat, repl, n_expected=1):
    global s
    new, n = re.subn(pat, lambda m: repl, s)
    if n != n_expected:
        print(f'FAIL(settings): {pat[:70]!r} -> {n}')
        sys.exit(1)
    s = new

sub_s(r"import \{ AudioLines, Brain, Globe, Mic, Sparkles, Trash2, Volume2, VolumeX \} from 'lucide-react'",
      "import { AudioLines, Brain, Globe, Sparkles, Trash2, Volume2, VolumeX } from 'lucide-react'")
sub_s(r"  /\*\* Имя активации \(id из WAKE_OPTIONS ниже\) \*/\n"
      r"  wakeWordId: string\n"
      r"  onWakeChange: \(id: string\) => void\n", "")
sub_s(r"/\*\* Имена активации: id совпадают с WAKE_WORDS в page\.tsx \*/\n"
      r"const WAKE_OPTIONS = \[[\s\S]*?\] as const\n\n", "")
sub_s(r"  wakeWordId,\n  onWakeChange,\n", "")
sub_s(r"        \{/\* Активация голосом: имя, на которое просыпается ассистент \*/\n[\s\S]*?        \{/\* Переключатели \*/\}",
      "        {/* Переключатели */}")
sub_s(r"Дария · интерфейс v2\.4 · сборка 14:10", "Дария · интерфейс v2.5 · сборка 14:33")

open(S, 'w', encoding='utf-8').write(s)
print('settings-dialog.tsx: все замены применены')
