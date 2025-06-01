// File: /app/api/query-attendance/route.ts

import { NextResponse } from "next/server"
import { Pool } from "pg"
import { NextRequest } from "next/server"

// ————————————————
// 1) Initialize a new PG pool (or import an existing one).
//    Make sure DATABASE_URL is set in .env.local or your deployment environment.
// ————————————————
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    let rollNo = searchParams.get("rollNo")

    if (!rollNo) {
      return NextResponse.json(
        { error: "Roll number is required" },
        { status: 400 },
      )
    }

    // Since we store roll_no in uppercase on insert, normalize here:
    rollNo = rollNo.toUpperCase()

    // —————————————————————————————
    // 2) Query Postgres for all attendance rows matching that roll number
    //    We’ll order by year DESC, month DESC (month is TEXT, same as before).
    // —————————————————————————————
    const queryText = `
      SELECT 
        id,
        roll_no,
        student_name,
        month,
        year,
        days_present,
        total_amount,
        created_at
      FROM attendance
      WHERE roll_no = $1
      ORDER BY year DESC, month DESC;
    `
    const { rows: records } = await pool.query(queryText, [rollNo])

    if (records.length === 0) {
      return NextResponse.json(
        { error: "No records found for this roll number" },
        { status: 404 },
      )
    }

    // Take the student_name from the first record (they should all match)
    const studentName = records[0].student_name

    // Compute totals (days_present, total_amount) across all months
    const totalDaysPresent = records.reduce(
      (sum, rec) => sum + Number(rec.days_present),
      0,
    )
    const totalAmount = records.reduce(
      (sum, rec) => sum + Number(rec.total_amount),
      0,
    )

    return NextResponse.json({
      roll_no: rollNo,
      student_name: studentName,
      total_days_present: totalDaysPresent,
      total_amount: totalAmount,
      months_data: records,
    })
  } catch (error) {
    console.error("Query error:", error)
    return NextResponse.json(
      { error: "Failed to query attendance data" },
      { status: 500 },
    )
  }
}
