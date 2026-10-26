# Worklog

---
Task ID: 1
Agent: Main agent (Z.ai)
Task: Разбор репозитория dwr-git/dewiar-app и создание веб-аналога голосового ассистента «Дария»

Work Log:
- Изучил репозиторий https://github.com/dwr-git/dewiar-app (WebFetch: README, LICENSE, структура)
- Вывод: Dewiar — проприетарный голосовой ИИ-ассистент (Python/pywebview/Vosk/LLM), код копировать запрещено лицензией
- Уточнил требования пользователя через AskUserQuestion: веб-приложение, голос+чат+персонажи+память, тёмный HUD, ассистент «Дария»
- Инициализировал fullstack-окружение (Next.js 16 + TypeScript + Prisma/SQLite + shadcn/ui)
- Протестировал z-ai-web-dev-sdk: чат-стриминг (SSE), TTS (audio/wav через Response), веб-поиск (functions.invoke)
- Схема БД (prisma/schema.prisma): Character (персона, акцентный цвет, параметры голоса), Message, Memory, DiaryEntry; db:push применён
- API-маршруты: /api/characters (с автозасевом Дарии/Максима/Лики), /api/chat (стриминг + память + поиск + фоновое извлечение фактов и дневник), /api/messages (GET/DELETE), /api/memory (CRUD), /api/diary (GET), /api/tts (WAV с кэшем и ретраями на 429)
- Фронтенд: тёмный HUD (#070b12, бирюзовый акцент), canvas-орбис с 4 состояниями (idle/listening/thinking/speaking), панель чата, переключатель персонажей, диалог «Память и дневник», чипы (поиск/озвучка/память/очистка)
- Голос: use-speech-recognition (Web Speech API, ru-RU, живой интерим, автоотправка финала, фильтр галлюцинаций <2 символов), use-tts-queue (потоковая очередь предложений, серверный нейроголос + запасной speechSynthesis, перебивание через stop)
- Исправил ошибки ESLint (refs в рендере, set-state-in-effect) — линт чистый
- Верификация Agent Browser: рендер, отправка сообщений, стриминг, память («Меня зовут Алексей» → факт), дневник (автосводка дня), переключение персонажей (акцент меняется), TTS-воспроизведение (состояние «Говорю…»), мобильный вид 390px, консоль без ошибок
- Починил 429 rate-limit TTS: серверный кэш фраз + 3 ретрая с backoff + клиентская пауза 250мс между фразами
- Очистил тестовые данные (сообщения, память, дневник)

Stage Summary:
- Приложение «Дария» — функциональный веб-аналог Dewiar готово и проверено в браузере
- Ключевые файлы: prisma/schema.prisma; src/app/api/{chat,tts,characters,memory,messages,diary}/route.ts; src/app/page.tsx; src/components/daria/{voice-orb,chat-panel,character-switcher,memory-dialog}.tsx; src/hooks/{use-speech-recognition,use-tts-queue}.ts; src/lib/types.ts
- Ограничения: голосовой ввод работает в Chrome/Edge (Web Speech API), в остальных браузерах — текстовый ввод; TTS имеет внешние rate-лимиты (защищено кэшем и ретраями с запасным браузерным синтезом)
