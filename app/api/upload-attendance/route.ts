import { type NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import Database from "better-sqlite3"
import path from "path"

// Initialize (or create) the SQLite database and attendance table
function initDatabase() {
  const dbPath = path.join(process.cwd(), "attendance.db")
  const db = new Database(dbPath)

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
      return NextResponse.json(
        { error: "Please upload an Excel file (.xlsx or .xls)" },
        { status: 400 },
      )
    }

    // Convert uploaded file into a Buffer
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Parse the workbook, read the first sheet
    const workbook = XLSX.read(buffer, { type: "buffer" })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]

    // Read the entire sheet into a 2D array
    const fullData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: "",
    }) as any[][]

    if (fullData.length < 2) {
      return NextResponse.json(
        { error: "Excel file appears to be empty or invalid" },
        { status: 400 },
      )
    }

    // Open (or create) DB and prepare INSERT
    const db = initDatabase()
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO attendance
      (roll_no, student_name, month, year, days_present, total_amount)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    // ------------------------------------------------------------------------
    // STEP 1: EXTRACT “Month” and “Year”
    // ------------------------------------------------------------------------
    let month = "Unknown"
    let year = new Date().getFullYear()
    let foundMonth = false
    let foundYear = false

    for (let i = 0; i < Math.min(fullData.length, 100); i++) {
      const row = fullData[i]
      if (!row) continue

      for (let j = 0; j < row.length; j++) {
        const raw = String(row[j] || "").trim()
        const lower = raw.toLowerCase()

        // If the cell is exactly "month" or "month:", grab next non-empty cell
        if (!foundMonth && (lower === "month" || lower === "month:")) {
          for (let k = j + 1; k < row.length; k++) {
            const cand = String(row[k] || "").trim()
            if (cand !== "") {
              month = cand
              foundMonth = true
              break
            }
          }
        }

        // If the cell is exactly "year" or "year:", scan to the right until we parse an integer
        if (!foundYear && (lower === "year" || lower === "year:")) {
          for (let k = j + 1; k < row.length; k++) {
            const cand = String(row[k] || "").trim()
            const parsed = Number.parseInt(cand, 10)
            if (!isNaN(parsed)) {
              year = parsed
              foundYear = true
              break
            }
          }
        }

        if (foundMonth && foundYear) break
      }
      if (foundMonth && foundYear) break
    }

    // ------------------------------------------------------------------------
    // STEP 2: LOCATE THE TWO-ROW “STUDENT DATA” HEADER
    // ------------------------------------------------------------------------
    let headerRowIndex = -1
    for (let i = 0; i < fullData.length; i++) {
      const row = fullData[i]
      if (!row) continue

      // Check if row contains either set of labels:
      //  • “Student Name” AND “Roll No.”
      //  • or “Name” AND “Enrollment No”
      const hasOldName = row.some(
        (c) => String(c || "").trim().toLowerCase() === "student name",
      )
      const hasOldRoll = row.some(
        (c) => String(c || "").trim().toLowerCase() === "roll no.",
      )
      const hasNewName = row.some(
        (c) => String(c || "").trim().toLowerCase() === "name",
      )
      const hasNewRoll = row.some(
        (c) => String(c || "").trim().toLowerCase() === "enrollment no",
      )

      if ((hasOldName && hasOldRoll) || (hasNewName && hasNewRoll)) {
        headerRowIndex = i
        break
      }
    }

    if (headerRowIndex === -1) {
      db.close()
      return NextResponse.json(
        {
          error:
            "Could not find header row. Expected either 'Student Name' & 'Roll No.' or 'Name' & 'Enrollment No'.",
        },
        { status: 400 },
      )
    }

    // Extract the first header row (N)
    const headerRow = fullData[headerRowIndex]
    // Extract the second header row (N+1), where “A”/“P” totals live
    const nextHeaderRow = fullData[headerRowIndex + 1] || []

    // ------------------------------------------------------------------------
    // STEP 3: DETERMINE COLUMN INDICES (works for both old & new formats)
    // ------------------------------------------------------------------------
    // 1) student_name column:
    //    old → "Student Name"
    //    new → "Name"
    const nameColIndex = headerRow.findIndex((cell) => {
      const txt = String(cell || "").trim().toLowerCase()
      return txt === "student name" || txt === "name"
    })

    // 2) roll_no column:
    //    old → "Roll No."
    //    new → "Enrollment No"
    const rollNoColIndex = headerRow.findIndex((cell) => {
      const txt = String(cell || "").trim().toLowerCase()
      return txt === "roll no." || txt === "enrollment no"
    })

    // 3) total_amount column (could be labeled "Total amount" or "Total Amounts")
    const totalAmountColIndex = headerRow.findIndex((cell) => {
      const txt = String(cell || "").trim().toLowerCase()
      return txt.includes("total amount")
    })

    // 4) present (“P”) & absent (“A”) columns live in nextHeaderRow
    const presentColIndex = nextHeaderRow.findIndex((cell) => {
      return String(cell || "").trim().toLowerCase() === "p"
    })
    const absentColIndex = nextHeaderRow.findIndex((cell) => {
      return String(cell || "").trim().toLowerCase() === "a"
    })

    // If any required index is missing, error out
    if (
      nameColIndex === -1 ||
      rollNoColIndex === -1 ||
      presentColIndex === -1 ||
      absentColIndex === -1 ||
      totalAmountColIndex === -1
    ) {
      db.close()
      return NextResponse.json(
        {
          error:
            "Missing required columns. Need: student name (or name), roll/enrollment no., 'P', 'A', and total-amount column.",
        },
        { status: 400 },
      )
    }

    // ------------------------------------------------------------------------
    // STEP 4: LOOP OVER STUDENT ROWS (start two rows below headerRowIndex)
    //   → UPPERCASE rollNo & studentName before storing
    // ------------------------------------------------------------------------
    let recordsProcessed = 0
    for (let i = headerRowIndex + 2; i < fullData.length; i++) {
      const row = fullData[i]
      if (!row) continue

      // Ensure we don’t go out of bounds
      const maxIdx = Math.max(
        nameColIndex,
        rollNoColIndex,
        presentColIndex,
        totalAmountColIndex,
      )
      if (row.length <= maxIdx) continue

      // Extract raw strings
      let studentName = String(row[nameColIndex] || "").trim()
      let rollNo = String(row[rollNoColIndex] || "").trim()
      if (!studentName || !rollNo) {
        // skip blank or summary rows
        continue
      }

      // --- NEW: force uppercase here ---
      studentName = studentName.toUpperCase()
      rollNo = rollNo.toUpperCase()

      // Read “P” total directly
      const daysPresent = Number.parseInt(
        String(row[presentColIndex] || "0"),
        10,
      ) || 0

      // Read “Total amount” directly
      const totalAmount = Number.parseFloat(
        String(row[totalAmountColIndex] || "0"),
      ) || 0

      try {
        insertStmt.run(
          rollNo,
          studentName,
          month,
          year,
          daysPresent,
          totalAmount,
        )
        recordsProcessed++
      } catch (err) {
        console.error(`Error inserting (${rollNo}):`, err)
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
      { error: "Failed to process file. Please check the file format." },
      { status: 500 },
    )
  }
}
