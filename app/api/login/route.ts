import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { username, password } = await request.json()

  const HARDCODED_USERNAME = process.env.APP_AUTH_USERNAME
  const HARDCODED_PASSWORD = process.env.APP_AUTH_PASSWORD


  // In a real application, you'd fetch user from a database
  // and compare hashed passwords.

  if (username === HARDCODED_USERNAME && password === HARDCODED_PASSWORD) {
    return NextResponse.json({ success: true })
  } else {
    return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 })
  }
} 