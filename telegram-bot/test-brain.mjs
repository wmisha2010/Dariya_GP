/**
 * Тесты мозга Дарии-бота: node test-brain.mjs
 * Тот же подход, что в scripts/test-wake.mjs веб-версии (v2.4).
 */
import {
  levenshtein,
  isTriggerToken,
  extractCommand,
  resolveCommand,
  askLLM,
} from './src/brain.js'

let passed = 0
let failed = 0

function check(name, cond, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

console.log('── Триггеры ──')
check('levenshtein(кот, код)=1', levenshtein('кот', 'код') === 1)
check('«дария» — триггер', isTriggerToken('дария'))
check('«Дария» в любом регистре', isTriggerToken('ДаРиЯ'))
check('«далее» → «дария» (опечатка из v2.4)', isTriggerToken('далее'))
check('«даря» → нечётко совпадает', isTriggerToken('даря'))
check('«даша» — триггер', isTriggerToken('даша'))
check('«алиса» — триггер', isTriggerToken('алиса'))
check('«малина» — НЕ триггер (первая буква)', !isTriggerToken('малина'))
check('«дорога» — НЕ триггер (слишком далеко)', !isTriggerToken('дорога'))
check('«погода» — НЕ триггер', !isTriggerToken('погода'))

console.log('── Обращение ──')
{
  const r = extractCommand('Дария, привет')
  check('«Дария, привет» → привет', r.found && r.command === 'привет')
}
{
  const r = extractCommand('дарья включи радио')
  check('«дарья включи радио» → включи радио', r.found && r.command === 'включи радио')
}
{
  const r = extractCommand('далее, как дела?')
  check('«далее, как дела?» → как дела', r.found && r.command === 'как дела')
}
{
  const r = extractCommand('Дария,как дела')
  check('без пробела после имени', r.found && r.command === 'как дела')
}
{
  const r = extractCommand('привет')
  check('без имени — не обращение', !r.found)
}
{
  const r = extractCommand('дорога, привет')
  check('«дорога» — не обращение', !r.found)
}
{
  const r = extractCommand('ну даша, привет')
  check('«ну даша, привет» → привет', r.found && r.command === 'привет')
}

console.log('── Быстрые ответы ──')
const W = 'https://daria.example.workers.dev'
{
  const r = resolveCommand('', { webAppUrl: W })
  check('пустая команда → приветствие', r.handled && /привет/i.test(r.text))
}
{
  const r = resolveCommand('помощь')
  check('«помощь» → список умений', r.handled && r.text.includes('умею'))
}
{
  const r = resolveCommand('/start')
  check('«/start» → список умений', r.handled && r.text.includes('умею'))
}
{
  const r = resolveCommand('привет')
  check('«привет» → приветствие', r.handled && /привет/i.test(r.text))
}
{
  const r = resolveCommand('как дела')
  check('«как дела» → ответ', r.handled && r.text.length > 5)
}
{
  const r = resolveCommand('кто ты')
  check('«кто ты» → представление', r.handled && /Дария/i.test(r.text))
}
{
  const r = resolveCommand('спасибо')
  check('«спасибо» → ответ', r.handled && r.text.length > 3)
}
{
  const r = resolveCommand('сколько времени')
  check('«сколько времени» → часы ЧЧ:ММ', r.handled && /\d{1,2}:\d{2}/.test(r.text))
}
{
  const r = resolveCommand('какое сегодня число')
  check('«какое сегодня число» → дата', r.handled && /Сегодня/i.test(r.text))
}

console.log('── Медиа-команды ──')
{
  const r = resolveCommand('включи радио', { webAppUrl: W })
  check('«включи радио» → ссылка на веб-версию', r.handled && r.text.includes(W) && /радио/i.test(r.text))
}
{
  const r = resolveCommand('включи музыку', { webAppUrl: W })
  check('«включи музыку» → ссылка на веб-версию', r.handled && r.text.includes(W))
}
{
  const r = resolveCommand('выключи музыку', { webAppUrl: W })
  check('«выключи музыку» → стоп-ответ без переключения', r.handled && r.text.includes(W))
}
{
  const r = resolveCommand('выключи ютуб')
  check('«выключи ютуб» → стоп-ответ', r.handled && /выключать нечего|не включаю/i.test(r.text))
}
{
  const r = resolveCommand('выключила музыку вчера')
  check('«выключила» не ловится как стоп', !r.handled)
}
{
  const r = resolveCommand('включи ютуб')
  check('«включи ютуб» → просит ссылку', r.handled && /ссылк/i.test(r.text))
}
{
  const r = resolveCommand('глянь https://www.youtube.com/watch?v=abc123')
  check('ютуб-ссылка → «Лови ▶»', r.handled && r.text.includes('youtube.com/watch?v=abc123'))
}
{
  const r = resolveCommand('youtu.be/dQw4w9WgXcQ')
  check('короткая youtu.be-ссылка → https', r.handled && r.text.includes('https://youtu.be/dQw4w9WgXcQ'))
}

console.log('── Без ИИ-ключей ──')
{
  const r = await askLLM([{ role: 'user', content: 'тест' }], {})
  check('askLLM без ключей → null', r === null)
  const quick = resolveCommand('что такое звезда', {})
  check('свободная тема без ключей → ушла бы в LLM', !quick.handled)
}

console.log(`\nИтого: ${passed} прошло, ${failed} упало`)
process.exit(failed ? 1 : 0)
