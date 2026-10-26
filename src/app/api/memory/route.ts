import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const memories = await db.memory.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return NextResponse.json({ memories })
  } catch (error) {
    console.error('GET /api/memory error:', error)
    return NextResponse.json({ error: 'Не удалось загрузить память' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { content, source } = body as { content?: string; source?: string }
    const text = content?.trim()
    if (!text) {
      return NextResponse.json({ error: 'Пустой текст воспоминания' }, { status: 400 })
    }
    if (text.length > 500) {
      return NextResponse.json({ error: 'Слишком длинный текст (макс. 500 символов)' }, { status: 400 })
    }
    const memory = await db.memory.create({
      data: { content: text, source: source === 'manual' ? 'manual' : 'chat' },
    })
    return NextResponse.json({ memory })
  } catch (error) {
    console.error('POST /api/memory error:', error)
    return NextResponse.json({ error: 'Не удалось сохранить воспоминание' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'Не указан id' }, { status: 400 })
    }
    await db.memory.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/memory error:', error)
    return NextResponse.json({ error: 'Не удалось удалить воспоминание' }, { status: 500 })
  }
}
