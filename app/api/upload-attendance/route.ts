import { type NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import Database from "better-sqlite3"
import path from "path"

// Initialize database
function initDatabase() {
  const dbPath = path.join(process.cwd(), "attendance.db")
  const db = new Database(dbPath)

  // Create table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roll_no TEXT NOT NULL,
      student_name TEXT NOT NULL,
      month TEXT NOT NULL,
      year INTEGER NOT NULL,
      days_present INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(roll_no, month, year)
    )
  `)

  return db
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      return NextResponse.json({ error: "Please upload an Excel file (.xlsx or .xls)" }, { status: 400 })
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Parse Excel file
    const workbook = XLSX.read(buffer, { type: "buffer" })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]

    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][]

    if (data.length < 2) {
      return NextResponse.json({ error: "Excel file appears to be empty or invalid" }, { status: 400 })
    }

    // Initialize database
    const db = initDatabase()

    // Prepare insert statement
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO attendance (roll_no, student_name, month, year, days_present, total_amount)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    // Extract month and year from the Excel file
    let month = "Unknown"
    let year = new Date().getFullYear()

    // Look for month and year in the first few rows
    for (let i = 0; i < Math.min(data.length, 100); i++) {
      const row = data[i]
      if (!row) continue

      for (let j = 0; j < row.length; j++) {
        const cell = String(row[j] || "").trim()

        // Look for "Month" label and adjacent cell for value
        if (cell === "Month" && row[j + 1]) {
          month = String(row[j + 1]).trim()
        }

        // Look for "Year" label and adjacent cell for value
        if (cell === "Year" && row[j + 1]) {
          year = Number.parseInt(String(row[j + 1]).trim())
        }
      }
    }

    // Find the row with "Student Name" and "Roll No." headers
    let headerRowIndex = -1
    for (let i = 0; i < data.length; i++) {
      const row = data[i]
      if (!row) continue

      const hasStudentName = row.some((cell) => String(cell || "").trim() === "Student Name")
      const hasRollNo = row.some((cell) => String(cell || "").trim() === "Roll No.")

      if (hasStudentName && hasRollNo) {
        headerRowIndex = i
        break
      }
    }

    if (headerRowIndex === -1) {
      db.close()
      return NextResponse.json(
        { error: "Could not find header row with 'Student Name' and 'Roll No.' columns" },
        { status: 400 },
      )
    }

    // Find column indices for required data
    const headerRow = data[headerRowIndex]
    const nameColIndex = headerRow.findIndex((cell) => String(cell || "").trim() === "Student Name")
    const rollNoColIndex = headerRow.findIndex((cell) => String(cell || "").trim() === "Roll No.")
    const presentColIndex = headerRow.findIndex((cell) => String(cell || "").trim() === "P")
    const totalAmountColIndex = headerRow.findIndex((cell) => String(cell || "").trim() === "Total amount")

    // If we can't find the "P" column directly, look for the "Totals" section
    let pColumnIndex = -1
    if (presentColIndex === -1) {
      for (let i = 0; i < headerRow.length; i++) {
        if (String(headerRow[i] || "").trim() === "P") {
          pColumnIndex = i
          break
        }
      }
    }

    let recordsProcessed = 0

    // Process data (starting from the row after the header)
    for (let i = headerRowIndex + 1; i < data.length; i++) {
      const row = data[i]
      if (!row || row.length < Math.max(nameColIndex, rollNoColIndex) + 1) continue

      // Extract student data
      const studentName = String(row[nameColIndex] || "").trim()
      const rollNo = String(row[rollNoColIndex] || "").trim()

      // Skip if essential data is missing
      if (!studentName || !rollNo) continue

      // Find days present (marked as "P")
      let daysPresent = 0

      // If we found the "P" column in the totals section
      if (pColumnIndex !== -1) {
        daysPresent = Number.parseInt(String(row[pColumnIndex] || "0"))
      } else {
        // Otherwise, count "P" values manually across the row
        for (let j = 0; j < row.length; j++) {
          if (String(row[j] || "").trim() === "P") {
            daysPresent++
          }
        }
      }

      // Get total amount
      let totalAmount = 0
      if (totalAmountColIndex !== -1) {
        totalAmount = Number.parseFloat(String(row[totalAmountColIndex] || "0"))
      }

      // Insert into database
      try {
        insertStmt.run(rollNo, studentName, month, year, daysPresent, totalAmount)
        recordsProcessed++
      } catch (error) {
        console.error(`Error inserting record for roll no ${rollNo}:`, error)
      }
    }

    db.close()

    return NextResponse.json({
      message: "File processed successfully",
      recordsProcessed,
      month,
      year,
    })
  } catch (error) {
    console.error("Upload error:", error)
    return NextResponse.json(
      {
        error: "Failed to process file. Please check the file format.",
      },
      { status: 500 },
    )
  }
}
