import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const characterId = req.nextUrl.searchParams.get('characterId')
    if (!characterId) {
      return NextResponse.json({ error: 'Не указан characterId' }, { status: 400 })
    }
    const messages = await db.message.findMany({
      where: { characterId },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, role: true, content: true, createdAt: true },
    })
    return NextResponse.json({ messages })
  } catch (error) {
    console.error('GET /api/messages error:', error)
    return NextResponse.json({ error: 'Не удалось загрузить историю' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const characterId = req.nextUrl.searchParams.get('characterId')
    if (!characterId) {
      return NextResponse.json({ error: 'Не указан characterId' }, { status: 400 })
    }
    await db.message.deleteMany({ where: { characterId } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/messages error:', error)
    return NextResponse.json({ error: 'Не удалось очистить историю' }, { status: 500 })
  }
}
