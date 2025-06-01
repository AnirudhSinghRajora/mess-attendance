import { type NextRequest, NextResponse } from "next/server"
import Database from "better-sqlite3"
import path from "path"

function initDatabase() {
  const dbPath = path.join(process.cwd(), "attendance.db")
  const db = new Database(dbPath)
  return db
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const rollNo = searchParams.get("rollNo")

    if (!rollNo) {
      return NextResponse.json({ error: "Roll number is required" }, { status: 400 })
    }

    const db = initDatabase()

    // Get all records for the roll number
    const records = db
      .prepare(`
      SELECT * FROM attendance 
      WHERE roll_no = ? 
      ORDER BY year DESC, month DESC
    `)
      .all(rollNo)

    if (records.length === 0) {
      db.close()
      return NextResponse.json(
        {
          error: "No records found for this roll number",
        },
        { status: 404 },
      )
    }

    // Get student name from the first record
    const studentName = records[0].student_name

    // Calculate totals
    const totalDaysPresent = records.reduce((sum: number, record: any) => sum + record.days_present, 0)
    const totalAmount = records.reduce((sum: number, record: any) => sum + record.total_amount, 0)

    db.close()

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
      {
        error: "Failed to query attendance data",
      },
      { status: 500 },
    )
  }
}
