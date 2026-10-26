/* Проверка формата запроса к Gemini streamGenerateContent (фейковый ключ → ждём 400 API_KEY_INVALID) */
const KEY = 'TEST_INVALID_KEY_123'

const body = {
  systemInstruction: { parts: [{ text: 'Ты тестовый ассистент.' }] },
  contents: [{ role: 'user', parts: [{ text: 'Привет' }] }],
  generationConfig: { temperature: 0.9, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
  safetySettings: [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT',
  ].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
}

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${KEY}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
)
const text = await res.text()
console.log(`HTTP ${res.status} ${res.headers.get('content-type')?.split(';')[0]}`)
console.log(text.slice(0, 400))
