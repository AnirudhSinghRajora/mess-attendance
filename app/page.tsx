"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Upload, Search, FileSpreadsheet, Users, Calendar } from "lucide-react"

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

interface QueryResult {
  roll_no: string
  student_name: string
  total_days_present: number
  total_amount: number
  months_data: AttendanceRecord[]
}

export default function MessAttendanceApp() {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [rollNo, setRollNo] = useState("")
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [querying, setQuerying] = useState(false)
  const [uploadMessage, setUploadMessage] = useState("")

  const handleFileUpload = async () => {
    if (!file) {
      setUploadMessage("Please select a file")
      return
    }

    setUploading(true)
    setUploadMessage("")

    const formData = new FormData()
    formData.append("file", file)

    try {
      const response = await fetch("/api/upload-attendance", {
        method: "POST",
        body: formData,
      })

      const result = await response.json()

      if (response.ok) {
        setUploadMessage(
          `Successfully uploaded! Processed ${result.recordsProcessed} records for ${result.month} ${result.year}.`,
        )
        setFile(null)
        // Reset file input
        const fileInput = document.getElementById("file-upload") as HTMLInputElement
        if (fileInput) fileInput.value = ""
      } else {
        setUploadMessage(`Error: ${result.error}`)
      }
    } catch (error) {
      setUploadMessage("Upload failed. Please try again.")
    } finally {
      setUploading(false)
    }
  }

  const handleQuery = async () => {
    if (!rollNo.trim()) {
      return
    }

    setQuerying(true)
    setQueryResult(null)

    try {
      const response = await fetch(`/api/query-attendance?rollNo=${encodeURIComponent(rollNo.trim())}`)
      const result = await response.json()

      if (response.ok) {
        setQueryResult(result)
      } else {
        console.error("Query failed:", result.error)
      }
    } catch (error) {
      console.error("Query failed:", error)
    } finally {
      setQuerying(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-gray-900">Mess Attendance Management</h1>
          <p className="text-gray-600">Upload Excel sheets and query student attendance data</p>
        </div>

        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload Attendance Sheet
            </CardTitle>
            <CardDescription>Upload monthly Excel (.xlsx) files containing student attendance data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file-upload">Select Excel File</Label>
              <Input
                id="file-upload"
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="cursor-pointer"
              />
            </div>
            <Button onClick={handleFileUpload} disabled={!file || uploading} className="w-full">
              {uploading ? (
                <>
                  <FileSpreadsheet className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload File
                </>
              )}
            </Button>
            {uploadMessage && (
              <div
                className={`p-3 rounded-md text-sm ${
                  uploadMessage.includes("Error") || uploadMessage.includes("failed")
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : "bg-green-50 text-green-700 border border-green-200"
                }`}
              >
                {uploadMessage}
              </div>
            )}
          </CardContent>
        </Card>

        <Separator />

        {/* Query Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="w-5 h-5" />
              Query Student Data
            </CardTitle>
            <CardDescription>Enter a roll number to view attendance summary across all months</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="roll-no">Roll Number</Label>
                <Input
                  id="roll-no"
                  value={rollNo}
                  onChange={(e) => setRollNo(e.target.value)}
                  placeholder="Enter roll number (e.g., cb20221002)"
                  onKeyPress={(e) => e.key === "Enter" && handleQuery()}
                />
              </div>
              <div className="flex items-end">
                <Button onClick={handleQuery} disabled={!rollNo.trim() || querying}>
                  {querying ? (
                    <>
                      <Users className="w-4 h-4 mr-2 animate-spin" />
                      Searching...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4 mr-2" />
                      Query
                    </>
                  )}
                </Button>
              </div>
            </div>

            {queryResult && (
              <div className="space-y-4 mt-6">
                <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                  <h3 className="text-lg font-medium text-gray-900">{queryResult.student_name}</h3>
                  <p className="text-sm text-gray-500">Roll No: {queryResult.roll_no}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-2xl font-bold text-blue-600">{queryResult.total_days_present}</div>
                      <div className="text-sm text-gray-600">Total Days Present</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-2xl font-bold text-green-600">
                        ₹{queryResult.total_amount.toLocaleString()}
                      </div>
                      <div className="text-sm text-gray-600">Total Amount</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-2xl font-bold text-purple-600">{queryResult.months_data.length}</div>
                      <div className="text-sm text-gray-600">Months Recorded</div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="w-5 h-5" />
                      Monthly Breakdown
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {queryResult.months_data.map((record) => (
                        <div key={record.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                          <div>
                            <div className="font-medium">
                              {record.month} {record.year}
                            </div>
                            <div className="text-sm text-gray-600">{record.days_present} days present</div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium text-green-600">₹{record.total_amount.toLocaleString()}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {querying === false && rollNo.trim() && !queryResult && (
              <div className="p-3 rounded-md text-sm bg-yellow-50 text-yellow-700 border border-yellow-200">
                No records found for roll number: {rollNo}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
