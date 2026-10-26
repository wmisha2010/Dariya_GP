/* Проверка: какие model= принимает шлюз z-ai-web-dev-sdk (безопасный мини-запрос) */
import ZAI from 'z-ai-web-dev-sdk'

const candidates = [undefined, 'glm-4.5-air', 'glm-4.5-flash', 'glm-4-flash-250414', 'glm-4.5']

const zai = await ZAI.create()
for (const model of candidates) {
  try {
    const res = await zai.chat.completions.create({
      ...(model ? { model } : {}),
      messages: [{ role: 'user', content: 'Скажи только: ок' }],
      stream: false,
      thinking: { type: 'disabled' },
    })
    const text = res?.choices?.[0]?.message?.content ?? ''
    console.log(`OK   model=${model ?? '(default)'} → "${String(text).slice(0, 30)}"`)
  } catch (err) {
    console.log(`FAIL model=${model ?? '(default)'} → ${String(err?.message ?? err).slice(0, 140)}`)
  }
}
process.exit(0)
