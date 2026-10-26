import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const entries = await db.diaryEntry.findMany({
      orderBy: { day: 'desc' },
      take: 30,
    })
    return NextResponse.json({ entries })
  } catch (error) {
    console.error('GET /api/diary error:', error)
    return NextResponse.json({ error: 'Не удалось загрузить дневник' }, { status: 500 })
  }
}
