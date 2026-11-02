# Дария в Telegram — бот для Cloudflare Workers

Текстовая версия Дарии: живёт в вашей группе, отвечает, когда к ней обращаются
(«**Дария, привет**», «**Дария, как дела**», «**Дария, включи радио**»).
Голос не нужен — всё текстом. Хостинг: Cloudflare Workers (бесплатно, 100 000
запросов/день, без «засыпания»).

## Что умеет

- 💬 **Свободное общение** — тот же характер, что у голосовой Дарии (через
  OpenRouter/Gemini; если ключей нет — вежливо скажет, что мозг не подключен).
- ⚡ **Быстрые ответы без ИИ-ключей** — привет, как дела, кто ты, время, дата, помощь.
- 🎵 **Медиа-команды** — «включи радио/музыку» → даёт ссылку на веб-версию
  с плеером (в Telegram фоновый плеер невозможен); ютуб-ссылки распознаёт и
  отвечает.
- 🎯 **Обращение** — в группе отвечает только когда её позвали по имени
  (Дария/Даша/Дуся/Алиса + опечатки вроде «далее»), упомянули @юзернеймом или
  ответили на её сообщение.

## Установка за 15 минут (без программирования)

### Шаг 1. Создайте бота в Telegram (2 мин)

1. В Telegram найдите **@BotFather** → команда `/newbot`.
2. Имя: `Дария`, юзернейм: любой свободный (например `daria_wm_bot`).
3. BotFather пришлёт **токен** вида `1234567890:AAEhBOweik6ad9r_QXMENQjcrGbqCrGtK4M`
   — скопируйте его.

### Шаг 2. Аккаунт Cloudflare (3 мин)

1. Зайдите на **dash.cloudflare.com** → зарегистрируйтесь бесплатно (только почта).
2. Слева: **Workers & Pages**.

### Шаг 3. Подключите репозиторий GitHub (5 мин)

1. Workers & Pages → **Create** → вкладка **Workers** → **Import a repository**
   (понадобится один раз войти в GitHub и разрешить доступ к `Dariya_GP`).
2. Project name: `daria-bot`.
3. В настройках сборки (Build settings) укажите:

| Поле | Значение |
|---|---|
| Repository | `wmisha2010/Dariya_GP` |
| Branch | `main` |
| Install command | `cd telegram-bot && npm install` |
| Deploy command | `cd telegram-bot && npx wrangler deploy` |

   (Build command оставьте пустым.)
4. Нажмите **Create and deploy** — через пару минут воркер будет жить на
   `https://daria-bot.<ваш-поддомен>.workers.dev`.

### Шаг 4. Дайте боту токен (1 мин)

1. Откройте вашего воркера → **Settings** → **Variables and Secrets**.
2. **Add variable**: тип **Secret**, имя `TELEGRAM_BOT_TOKEN`, значение — токен
   из шага 1. Сохранить → воркер перезапустится.

*(опционально, для «умных» ответов: так же добавьте `OPENROUTER_API_KEY` —
ключ с openrouter.ai/keys, или `GEMINI_API_KEY` — с aistudio.google.com/apikey)*

### Шаг 5. Включите webhook (1 мин)

Откройте в браузере:

```
https://daria-bot.<ваш-поддомен>.workers.dev/setup?bot_token=ВАШ_ТОКЕН
```

Должно появиться «**Webhook установлен ✅**».

### Шаг 6. Проверка (1 мин)

1. ⚠️ **Обязательно для группы**: у @BotFather → `/mybots` → ваш бот →
   **Bot Settings** → **Group Privacy** → **Turn off**.
   Иначе Telegram вообще не доставит боту «Дария, привет» в группе — она увидит
   только команды и ответы на её сообщения.
2. Уберите бота из группы и добавьте заново (настройка privacy применяется
   после переприглашения).
3. Напишите в группе: **Дария, привет** — она ответит. Всё, она жива 🎉

## Переменные окружения

| Переменная | Обязательна | Зачем |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | токен от @BotFather |
| `OPENROUTER_API_KEY` | — | мозг для свободных тем (основной) |
| `OPENROUTER_MODEL` | — | своя модель (по умолч. `poolside/laguna-s-2.1:free`) |
| `GEMINI_API_KEY` | — | запасной мозг (Google Gemini) |
| `GEMINI_BASE_URL` | — | релей для Gemini при гео-блоке |
| `WEB_APP_URL` | — | ссылка, которую бот даёт на веб-версию с плеером |
| `TIMEZONE` | — | часовой пояс для «который час» (по умолч. Europe/Moscow) |

## Файлы

```
telegram-bot/
├── src/index.ts     # воркер: /setup, /telegram-webhook, статус-страница
├── src/brain.js     # мозг: триггеры, интенты, персона, LLM-клиент
├── test-brain.mjs   # 36 тестов мозга (npm test)
├── wrangler.toml    # конфиг Cloudflare Workers
└── package.json
```

## Локальная разработка (необязательно)

```bash
cd telegram-bot
npm install
npm test                          # тесты мозга
npx wrangler dev                  # локальный воркер на http://localhost:8787
TELEGRAM_BOT_TOKEN=... npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler deploy               # деплой из консоли
```
