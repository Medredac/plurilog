import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    { enabled: Boolean(process.env.GEMINI_API_KEY) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
