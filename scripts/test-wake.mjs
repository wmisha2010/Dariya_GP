/* Проверка логики wake-word из src/app/page.tsx — функции копируются один-в-один
 * (без типов). Запуск: node scripts/test-wake.mjs */

const WAKE_WORDS = {
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

function levenshtein(a, b) {
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

function isWakeToken(token, variants) {
  for (const v of variants) {
    if (token === v) return true
    if (token[0] === v[0] && levenshtein(token, v) <= (v.length >= 7 ? 2 : 1)) return true
  }
  return false
}

function matchesWake(clean, variants) {
  const tokens = clean.toLowerCase().match(/[а-яё]+/g) ?? []
  return tokens.some((t) => isWakeToken(t, variants))
}

function makeWakeStripRe(variants) {
  const alt = variants
    .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .join('|')
  return new RegExp(
    `(?:^|\\s)(?:(?:эй|ок(?:ей)?|слушай)\\s+)?(?:${alt})(?=$|[\\s,.!?;:—-])`,
    'gi'
  )
}

const strip = (clean, variants) =>
  clean
    .replace(makeWakeStripRe(variants), ' ')
    .replace(/\s+([,.!?;:—-])/g, '$1')
    .replace(/^[\s,.!?;:—-]+|[\s,.!?;:—-]+$/g, '')
    .trim()

let failed = 0
function check(name, actual, expected) {
  const ok = actual === expected
  if (!ok) failed += 1
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  →  ${JSON.stringify(actual)} (ожидалось ${JSON.stringify(expected)})`)
}

const D = WAKE_WORDS.dasha.variants
const R = WAKE_WORDS.daria.variants

/* ── Активация: пробуждение ── */
check('«Даша» будит (Даша)', matchesWake('даша', D), true)
check('«Дария» будит (Дария)', matchesWake('дария', R), true)
check('«далее» будит (Дария — ошибка распознавателя)', matchesWake('далее', R), true)
check('«далее» НЕ будит (Даша)', matchesWake('далее', D), false)
check('«эй Даша» будит', matchesWake('эй даша', D), true)
check('«ну Дария давай радио» будит', matchesWake('ну дария давай радио', R), true)
check('«Дарья» будит (Дария)', matchesWake('дарья', R), true)
check('«Дарию» будит (Дария)', matchesWake('дарию', R), true)
check('«Дарина» будит (Дария)', matchesWake('дарина', R), true)
check('«дэша» будит (Даша — описка)', matchesWake('дэша', D), true)
check('«Алиса» будит (Алиса)', matchesWake('алиса', WAKE_WORDS.alisa.variants), true)
check('«Дуся» будит (Дуся)', matchesWake('дуся', WAKE_WORDS.dusya.variants), true)

/* ── Активация: ложные срабатывания должны быть невозможны ── */
check('«Маша» не будит', matchesWake('маша', D), false)
check('«наша» не будит', matchesWake('наша песня', D), false)
check('«выключи» не будит', matchesWake('выключи музыку', D), false)
check('«выключи» не будит (Дария)', matchesWake('выключи музыку', R), false)
check('«дальше» не будит (Даша)', matchesWake('дальше', D), false)
check('«дальше» не будит (Дария)', matchesWake('дальше', R), false)
check('«радио» не будит', matchesWake('включи радио', D), false)
check('«включай» не будит', matchesWake('включай рок', D), false)
check('«дайте» не будит', matchesWake('дайте две', D), false)
check('«давай» не будит', matchesWake('давай до свидания', D), false)
check('«дом» не будит', matchesWake('дом', D), false)
check('«даром» не будит (Дария)', matchesWake('даром', R), false)
check('«подарю» не будит (Дария)', matchesWake('подарю', R), false)
check('«да» не будит', matchesWake('да', D), false)
check('«думать» не будит (Дуся)', matchesWake('думать', WAKE_WORDS.dusya.variants), false)
check('«малина» не будит (Алиса)', matchesWake('малина', WAKE_WORDS.alisa.variants), false)

/* ── Срезание имени перед командой ── */
check('«эй Даша, включи музыку» → команда', strip('эй даша, включи музыку', D), 'включи музыку')
check('«Дария включи радио» → команда', strip('дария включи радио', R), 'включи радио')
check('«ну Дария, давай радио» → команда', strip('ну дария, давай радио', R), 'ну, давай радио')
check('«окей даша дальше» → команда', strip('окей даша дальше', D), 'дальше')
check('«слушай Дашеньку…» срезается', strip('слушай дашенька дальше', D), 'дальше')
check('без имени команда не трогается', strip('включи музыку', D), 'включи музыку')
check('«дашенька» не режется как «даша»+хвост', strip('дашенька дальше', D), 'дальше')

/* ── Край: пустая строка, латиница ── */
check('пустая строка не будит', matchesWake('', D), false)
check('латиница не будит', matchesWake('dasha play music', D), false)

console.log(failed ? `\n${failed} ПРОВАЛОВ` : '\nВсе проверки прошли')
process.exit(failed ? 1 : 0)
