// File: /app/api/upload-attendance/route.ts

import { NextResponse } from "next/server"
import { Pool } from "pg"
import * as XLSX from "xlsx"
import { NextRequest } from "next/server"

// ---------------------------------------------------------
// 1) Create a single Pool using your DATABASE_URL variable
// ---------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Supabase
})

// ---------------------------------------------------------
// 2) (Optional) On cold start, create the `attendance` table
//    if it doesn’t already exist. This runs only once per
//    server‐process, so subsequent calls will be fast.
// ---------------------------------------------------------
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
      created_at    TIMESTAMPTZ DEFAULT now(),
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

// ---------------------------------------------------------
// 3) The POST handler: parse Excel, find “Total Amount” col,
//    discover headers, then upsert each student row.
// ---------------------------------------------------------
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

    // ---- Convert uploaded file into Buffer ----
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // ---- Parse the workbook, read the first sheet ----
    const workbook = XLSX.read(buffer, { type: "buffer" })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]

    // ---- Convert the sheet into a 2D array of strings ----
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

    // ------------------------------------------
    // STEP 1: EXTRACT “Month” and “Year” labels
    //         (scan up to the first 100 rows)
    // ------------------------------------------
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

        // If the cell text is exactly “month” or “month:”
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

        // If the cell text is exactly “year” or “year:”
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

    // ------------------------------------------
    // STEP 2: LOCATE the “Student Header” row
    //
    //   • That row must contain either:
    //        – “Student Name” & “Roll No.”   (old format) 
    //     OR – “Name” & “Enrollment No”      (new format)
    // ------------------------------------------
    let headerRowIndex = -1
    for (let i = 0; i < fullData.length; i++) {
      const row = fullData[i]
      if (!row) continue

      // Does this row contain “student name” + “roll no.” ?
      const hasOldName = row.some(
        (c) => String(c || "").trim().toLowerCase() === "student name",
      )
      const hasOldRoll = row.some(
        (c) => String(c || "").trim().toLowerCase() === "roll no.",
      )

      // OR does it contain “name” + “enrollment no” ?
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
            "Could not find a header row. Expected either 'Student Name' & 'Roll No.' or 'Name' & 'Enrollment No'.",
        },
        { status: 400 },
      )
    }

    const headerRow = fullData[headerRowIndex]
    const nextHeaderRow = fullData[headerRowIndex + 1] || []

    // ------------------------------------------
    // STEP 3: DETERMINE COLUMN INDICES
    //
    //   (a) student_name column → “Student Name” OR “Name”
    //   (b) roll_no column      → “Roll No.” OR “Enrollment No”
    //   (c) days_present (P)    → look for “P” in nextHeaderRow
    //   (d) days_absent  (A)    → look for “A” in nextHeaderRow
    //   (e) total_amount        → SCAN the entire sheet for “Total Amount”
    // ------------------------------------------

    // (a) student_name
    const nameColIndex = headerRow.findIndex((cell) => {
      const txt = String(cell || "").trim().toLowerCase()
      return txt === "student name" || txt === "name"
    })

    // (b) roll_no
    const rollNoColIndex = headerRow.findIndex((cell) => {
      const txt = String(cell || "").trim().toLowerCase()
      return txt === "roll no." || txt === "enrollment no"
    })

    // (c) present (“P”) in the nextHeaderRow
    const presentColIndex = nextHeaderRow.findIndex((cell) => {
      return String(cell || "").trim().toLowerCase() === "p"
    })

    // (d) absent (“A”) in the nextHeaderRow
    const absentColIndex = nextHeaderRow.findIndex((cell) => {
      return String(cell || "").trim().toLowerCase() === "a"
    })

    // (e) total_amount: scan the whole sheet for an *exact* "total amount"
    let totalAmountColIndex = -1
    for (let i = 0; i < fullData.length; i++) {
      const row = fullData[i]
      if (!row) continue
      for (let j = 0; j < row.length; j++) {
        if (String(row[j] || "").trim().toLowerCase() === "total amount") {
          totalAmountColIndex = j
          break
        }
      }
      if (totalAmountColIndex !== -1) break
    }

    // If any required column was not found, return an error
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
            "Missing required columns. Need: student name (or name), roll/enrollment no., 'P', 'A', and 'Total Amount'.",
        },
        { status: 400 },
      )
    }

    // ------------------------------------------
    // STEP 4: LOOP OVER STUDENT ROWS (start two rows below headerRowIndex)
    //
    //   • Uppercase rollNo & studentName before storing
    //   • daysPresent = cell under “P”
    //   • totalAmount = cell under “Total Amount” (found above)
    // ------------------------------------------
    let recordsProcessed = 0

    // Prepare a single UPSERT statement for Postgres
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

    for (let i = headerRowIndex + 2; i < fullData.length; i++) {
      const row = fullData[i]
      if (!row) continue

      // Prevent out‐of‐bounds access
      const maxIdx = Math.max(
        nameColIndex,
        rollNoColIndex,
        presentColIndex,
        totalAmountColIndex,
      )
      if (row.length <= maxIdx) continue

      let studentName = String(row[nameColIndex] || "").trim()
      let rollNo = String(row[rollNoColIndex] || "").trim()
      if (!studentName || !rollNo) {
        // skip blank or summary rows
        continue
      }

      // FORCE uppercase so “lit2024042” → “LIT2024042”
      studentName = studentName.toUpperCase()
      rollNo = rollNo.toUpperCase()

      // Read “P” directly
      const daysPresent =
        Number.parseInt(String(row[presentColIndex] || "0"), 10) || 0

      // Read “Total Amount” from the column we discovered above
      const totalAmount =
        Number.parseFloat(String(row[totalAmountColIndex] || "0")) || 0

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
