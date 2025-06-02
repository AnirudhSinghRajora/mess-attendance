import { NextResponse } from "next/server"
import { Pool } from "pg"

// Initialize a new PG pool (or import an existing one).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

export async function GET() {
  try {
    const queryText = `
      SELECT DISTINCT month, year
      FROM attendance
      ORDER BY year DESC, month ASC;
    `
    const { rows } = await pool.query(queryText)
    return NextResponse.json(rows)
  } catch (error: any) {
    console.error("Error fetching uploaded sheets:", error)
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    )
  }
} 