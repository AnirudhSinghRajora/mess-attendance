import { NextResponse } from "next/server"
import { Pool } from "pg"

// Initialize a new PG pool (or import an existing one).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

export async function DELETE(request: Request) {
  try {
    const { month, year } = await request.json()

    if (!month || !year) {
      return NextResponse.json(
        { error: "Month and year are required" },
        { status: 400 },
      )
    }

    const queryText = `
      DELETE FROM attendance
      WHERE month = $1 AND year = $2
      RETURNING *;
    `
    const { rowCount } = await pool.query(queryText, [month, year])

    if (rowCount > 0) {
      return NextResponse.json({ success: true, message: `Deleted ${rowCount} records for ${month} ${year}.` })
    } else {
      return NextResponse.json({ success: false, error: `No records found for ${month} ${year}.` }, { status: 404 })
    }
  } catch (error: any) {
    console.error("Error deleting attendance records:", error)
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    )
  }
} 