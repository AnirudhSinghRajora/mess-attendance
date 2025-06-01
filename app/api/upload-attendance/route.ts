// /app/api/upload-attendance/route.ts   (or wherever your Next.js “POST” handler lives)

import { NextResponse } from "next/server"
import { Pool } from "pg"
import * as XLSX from "xlsx"
import { NextRequest } from "next/server"

// ----------------------------------------------------------------------------
// 1) Set up a single Pool instance, using your DATABASE_URL environment variable.
// ----------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // neon.tech / AWS-hosted Neon often requires this:
  ssl: { rejectUnauthorized: false },
})

// ----------------------------------------------------------------------------
// 2) (Optional) At startup, create the “attendance” table if it doesn’t exist.
//    Because Next.js “route.ts” files are re-used across requests, we can run
//    this once in a top-level async IIFE. This will only run once per cold start.
// ----------------------------------------------------------------------------
;(async () => {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS attendance (
      id            SERIAL PRIMARY KEY,
      roll_no       TEXT NOT NULL,
      student_name  TEXT NOT NULL,
      month         TEXT NOT NULL,
      year          INTEGER NOT NULL,
      days_present  INTEGER NOT NULL,
      total_amount  NUMERIC NOT NULL,
      created_at    TIMESTAMP WITH TIME ZONE DEFAULT now(),
      UNIQUE (roll_no, month, year)
    );
  `
  try {
    await pool.query(createTableSQL)
    console.log("✅ attendance table is ready.")
  } catch (err) {
    console.error("❌ Failed to ensure attendance table exists:", err)
  }
})()

// ----------------------------------------------------------------------------
// 3) Export your POST handler exactly like before, except using `pg` instead of sqlite.
// ----------------------------------------------------------------------------
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

    // ---- Convert uploaded file into a Buffer ----
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // ---- Parse the workbook and grab the first sheet ----
    const workbook = XLSX.read(buffer, { type: "buffer" })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]

    // ---- Read the entire sheet as a 2D array ----
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

    // ---------------------------------------------
    // STEP 1: EXTRACT “Month” and “Year” (scan up to 100 rows)
    // ---------------------------------------------
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

        // If cell exactly “month” or “month:”
        if (!foundMonth && (lower === "month" || lower === "month:")) {
          for (let k = j + 1; k < row.length; k++) {
            const candidate = String(row[k] || "").trim()
            if (candidate !== "") {
              month = candidate
              foundMonth = true
              break
            }
          }
        }

        // If cell exactly “year” or “year:”
        if (!foundYear && (lower === "year" || lower === "year:")) {
          for (let k = j + 1; k < row.length; k++) {
            const candidate = String(row[k] || "").trim()
            const parsed = Number.parseInt(candidate, 10)
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

    // ---------------------------------------------
    // STEP 2: LOCATE the two-row “STUDENT DATA” header
    //   • First header row contains either:
    //       – “Student Name” & “Roll No.”  (old format)
    //       – OR “Name” & “Enrollment No”  (new format)
    //   • Next header row (row+1) contains daily-columns plus “A” and “P”
    // ---------------------------------------------
    let headerRowIndex = -1
    for (let i = 0; i < fullData.length; i++) {
      const row = fullData[i]
      if (!row) continue

      // Detect old-format labels:
      const hasOldName = row.some(
        (c) => String(c || "").trim().toLowerCase() === "student name",
      )
      const hasOldRoll = row.some(
        (c) => String(c || "").trim().toLowerCase() === "roll no.",
      )

      // Detect new-format labels:
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
      return NextResponse.json(
        {
          error:
            "Could not find header row. Expected either 'Student Name' & 'Roll No.' or 'Name' & 'Enrollment No'.",
        },
        { status: 400 },
      )
    }

    const headerRow = fullData[headerRowIndex]
    const nextHeaderRow = fullData[headerRowIndex + 1] || []

    // ---------------------------------------------
    // STEP 3: DETERMINE COLUMN INDICES
    // ---------------------------------------------
    // 1) student_name  → either “Student Name” or “Name”
    const nameColIndex = headerRow.findIndex((cell) => {
      const txt = String(cell || "").trim().toLowerCase()
      return txt === "student name" || txt === "name"
    })

    // 2) roll_no  → either “Roll No.” or “Enrollment No”
    const rollNoColIndex = headerRow.findIndex((cell) => {
      const txt = String(cell || "").trim().toLowerCase()
      return txt === "roll no." || txt === "enrollment no"
    })

    // 3) total_amount  → any header that “includes” “total amount”
    const totalAmountColIndex = headerRow.findIndex((cell) => {
      const txt = String(cell || "").trim().toLowerCase()
      return txt.includes("total amount")
    })

    // 4) present (“P”)  → in the nextHeaderRow
    const presentColIndex = nextHeaderRow.findIndex((cell) => {
      return String(cell || "").trim().toLowerCase() === "p"
    })

    // 5) absent (“A”)  → in the nextHeaderRow
    const absentColIndex = nextHeaderRow.findIndex((cell) => {
      return String(cell || "").trim().toLowerCase() === "a"
    })

    // If any required column is missing, return 400
    if (
      nameColIndex === -1 ||
      rollNoColIndex === -1 ||
      presentColIndex === -1 ||
      absentColIndex === -1 ||
      totalAmountColIndex === -1
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required columns. Need: student name (or name), roll/enrollment no., 'P', 'A', and total-amount column.",
        },
        { status: 400 },
      )
    }

    // ---------------------------------------------
    // STEP 4: PROCESS each student row (start at headerRowIndex + 2)
    //   • Uppercase the roll number & student name before storing.
    // ---------------------------------------------
    let recordsProcessed = 0

    // We will reuse a single parameterized SQL for “INSERT OR REPLACE”.  
    // PostgreSQL: “ON CONFLICT (roll_no, month, year) DO UPDATE SET …”
    const upsertSQL = `
      INSERT INTO attendance
        (roll_no, student_name, month, year, days_present, total_amount)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (roll_no, month, year)
      DO UPDATE SET
        student_name  = EXCLUDED.student_name,
        days_present  = EXCLUDED.days_present,
        total_amount  = EXCLUDED.total_amount
      RETURNING id;
    `

    // Loop over student data rows
    for (let i = headerRowIndex + 2; i < fullData.length; i++) {
      const row = fullData[i]
      if (!row) continue

      // Prevent out-of-bounds
      const maxIdx = Math.max(
        nameColIndex,
        rollNoColIndex,
        presentColIndex,
        totalAmountColIndex,
      )
      if (row.length <= maxIdx) continue

      let studentName = String(row[nameColIndex] || "").trim()
      let rollNo = String(row[rollNoColIndex] || "").trim()
      if (!studentName || !rollNo) continue  // skip blanks

      // Force uppercase, so “lit2024042” → “LIT2024042”
      studentName = studentName.toUpperCase()
      rollNo = rollNo.toUpperCase()

      const daysPresent =
        Number.parseInt(String(row[presentColIndex] || "0"), 10) || 0
      const totalAmount =
        Number.parseFloat(String(row[totalAmountColIndex] || "0")) || 0

      // Execute the UPSERT into Postgres
      try {
        await pool.query(upsertSQL, [
          rollNo,
          studentName,
          month,
          year,
          daysPresent,
          totalAmount,
        ])
        recordsProcessed++
      } catch (err) {
        console.error(`Failed to upsert attendance for ${rollNo}:`, err)
      }
    }

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
