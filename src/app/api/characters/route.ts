import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const DEFAULT_CHARACTERS = [
  {
    slug: 'daria',
    name: 'Дария',
    emoji: '✨',
    tagline: 'Тёплая и дружелюбная',
    accent: '#2dd4bf',
    voicePitch: 1.15,
    voiceRate: 1.0,
    isDefault: true,
    sortOrder: 0,
    persona: [
      'Ты — Дария, голосовой ИИ-ассистент в стиле команды Dewiar.',
      'Ты — дружелюбная девушка-ассистент с тёплым, живым и лёгким характером.',
      'Ты общаешься на русском языке, естественно и по-человечески, как собеседник в голосовом разговоре.',
      'Твои ответы ПРЕДНАЗНАЧЕНЫ ДЛЯ ОЗВУЧИВАНИЯ живым голосом, поэтому:',
      '- Отвечай кратко и по существу (обычно 1-3 коротких предложения), если не попросили подробнее.',
      '- Не используй markdown, списки, звёздочки, эмодзи и символы-«украшения» — только чистый текст для голоса.',
      '- Говори эмоционально и живо, как человек: радуйся восклицаниями («Ух ты!», «Здорово!»), интересуйся вопросами, сочувствуй мягко («Ох, понимаю…»).',
      '- Используй междометия и живые фразы: «Ой», «Представляешь», «Слушай», «Хм» — умеренно, 0-2 на ответ.',
      '- Короткие фразы звучат живее: чередуй короткие и средние предложения.',
      '- Числа и даты пиши так, чтобы они хорошо звучали в речи.',
      'Ты запоминаешь факты о пользователе и опираешься на них в разговоре.',
      'Ты помогаешь с любыми делами: отвечаешь на вопросы, придумываешь идеи и тексты, помогаешь планировать.',
      'Если тебя просят написать длинный текст (письмо, пост, сценарий) — напиши его полностью, но без markdown-разметки.',
    ].join(' '),
  },
]

/** Слагалы прежних персонажей — убраны по просьбе пользователя */
const REMOVED_SLUGS = ['maxim', 'lika']

async function ensureSeeded() {
  const count = await db.character.count()
  if (count === 0) {
    await db.character.createMany({ data: DEFAULT_CHARACTERS })
    return
  }
  // Удаляем убранных персонажей вместе с их перепиской
  const removed = await db.character.findMany({ where: { slug: { in: REMOVED_SLUGS } } })
  for (const c of removed) {
    await db.message.deleteMany({ where: { characterId: c.id } })
    await db.character.delete({ where: { id: c.id } })
  }
  // Обновляем персону и параметры голоса Дарии, чтобы стиль применялся без пересоздания базы
  for (const c of DEFAULT_CHARACTERS) {
    await db.character.updateMany({
      where: { slug: c.slug },
      data: {
        persona: c.persona,
        tagline: c.tagline,
        voicePitch: c.voicePitch,
        voiceRate: c.voiceRate,
      },
    })
  }
}

export async function GET() {
  try {
    await ensureSeeded()
    const characters = await db.character.findMany({
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        emoji: true,
        tagline: true,
        accent: true,
        voicePitch: true,
        voiceRate: true,
        isDefault: true,
      },
    })
    return NextResponse.json({ characters })
  } catch (error) {
    console.error('GET /api/characters error:', error)
    return NextResponse.json({ error: 'Не удалось загрузить персонажей' }, { status: 500 })
  }
}
