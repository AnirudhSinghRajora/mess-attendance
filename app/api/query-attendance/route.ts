// File: /app/api/query-attendance/route.ts

import { NextResponse } from "next/server"
import { Pool } from "pg"
import { NextRequest } from "next/server"

interface AttendanceRecord {
  id: number
  roll_no: string
  student_name: string
  month: string
  year: number
  days_present: number
  total_amount: number
  created_at: string
}

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
    let queryYear = searchParams.get("year")
    let mess = searchParams.get("mess")

    if (!rollNo && !queryYear) {
      return NextResponse.json(
        { error: "Roll number or year is required" },
        { status: 400 },
      )
    }

    // Since we store roll_no in uppercase on insert, normalize here:
    if (rollNo) {
      rollNo = rollNo.toUpperCase()
    }

    // —————————————————————————————
    // 2) Query Postgres for all attendance rows matching that roll number
    //    We'll order by year DESC, month DESC (month is TEXT, same as before).
    // —————————————————————————————
    let queryText = `
      SELECT 
        id,
        roll_no,
        student_name,
        month,
        year,
        mess,
        days_present,
        total_amount,
        created_at
      FROM attendance
    `
    const queryParams: (string | number)[] = []
    const conditions: string[] = []

    if (rollNo) {
      conditions.push(`roll_no = $${queryParams.length + 1}`)
      queryParams.push(rollNo)
    }

    if (queryYear) {
      // Assuming queryYear is a valid number, convert to integer
      const parsedYear = parseInt(queryYear, 10)
      if (!isNaN(parsedYear)) {
        conditions.push(`year = $${queryParams.length + 1}`)
        queryParams.push(parsedYear)
      } else {
        return NextResponse.json(
          { error: "Invalid year provided" },
          { status: 400 },
        )
      }
    }

    if (mess) {
      conditions.push(`mess = $${queryParams.length + 1}`)
      queryParams.push(mess)
    }

    if (conditions.length > 0) {
      queryText += ` WHERE ${conditions.join(' AND ')}`
    }

    queryText += ` ORDER BY year DESC, month DESC;`

    console.log("Running query with:", { rollNo, queryYear })
    const { rows: records } = await pool.query(queryText, queryParams)

    if (records.length === 0) {
      return NextResponse.json(
        { error: "No records found for this roll number or year" },
        { status: 404 },
      )
    }

    let studentName = "Unknown Student"
    if (rollNo && records.length > 0) {
      studentName = records[0].student_name
    } else if (records.length > 0) {
      // If only year is queried, we might not have a specific studentName from input
      // Use the student name from the first record found
      studentName = records[0].student_name
    }

    // Compute totals (days_present, total_amount) across all months
    const totalDaysPresent = records.reduce(
      (sum: number, rec: AttendanceRecord) => sum + Number(rec.days_present),
      0,
    )
    const totalAmount = records.reduce(
      (sum: number, rec: AttendanceRecord) => sum + Number(rec.total_amount),
      0,
    )

    return NextResponse.json({
      roll_no: rollNo,
      student_name: studentName,
      total_days_present: totalDaysPresent,
      total_amount: totalAmount,
      months_data: records,
    })
  } catch (error: any) {
    console.error("Query error:", error)
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    )
  }
}
