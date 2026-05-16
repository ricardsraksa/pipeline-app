import { NextRequest } from 'next/server'
import { saveFeedback } from '@/lib/stage3/learning'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    saveFeedback(body)
    return Response.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
