"use client"

import { useState, useEffect } from "react"
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Upload, Search, FileSpreadsheet, Users, Calendar, LogOut, List } from "lucide-react"

interface AttendanceRecord {
  id: number
  roll_no: string
  student_name: string
  month: string
  year: number
  days_present: number
  total_amount: number
  created_at: string
  mess: string
}

interface QueryResult {
  roll_no: string
  student_name: string
  total_days_present: number
  total_amount: number
  months_data: AttendanceRecord[]
}

export default function MessAttendanceApp() {
  const [files, setFiles] = useState<FileList | null>(null)
  const [uploading, setUploading] = useState(false)
  const [rollNo, setRollNo] = useState("")
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [querying, setQuerying] = useState(false)
  const [uploadMessage, setUploadMessage] = useState("")
  const [queryYear, setQueryYear] = useState<string>("")
  const [sheets, setSheets] = useState<{ month: string; year: number; mess: string }[]>([])
  const [sheetsLoading, setSheetsLoading] = useState(false)
  const [sheetsError, setSheetsError] = useState<string | null>(null)
  const [deletingSheet, setDeletingSheet] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [selectedMess, setSelectedMess] = useState<string>("college")
  const [queryMess, setQueryMess] = useState<string>("")

  const router = useRouter()

  // Helper function to get month order for sorting
  const getMonthOrder = (monthName: string): number => {
    const monthMap: { [key: string]: number } = {
      "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
      "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12,
    }
    return monthMap[monthName] || 0; // Return 0 for unknown months to put them at the beginning
  };

  useEffect(() => {
    if (typeof window !== 'undefined') { // Ensure localStorage is available
      const isAuthenticated = localStorage.getItem('isAuthenticated')
      if (isAuthenticated !== 'true') {
        router.push('/login')
      }
    }
  }, [router])

  const handleFileUpload = async () => {
    if (!files || files.length === 0) {
      setUploadMessage("Please select at least one file.")
      return
    }

    setUploading(true)
    setUploadMessage("")

    const allResults: string[] = []
    let hasError = false

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const formData = new FormData()
      formData.append("file", file)
      formData.append("mess", selectedMess)

      try {
        const response = await fetch("/api/upload-attendance", {
          method: "POST",
          body: formData,
        })

        const result = await response.json()

        if (response.ok) {
          allResults.push(
            `Successfully uploaded ${file.name}: Processed ${result.recordsProcessed} records for ${result.month} ${result.year}.`,
          )
        } else {
          allResults.push(`Error uploading ${file.name}: ${result.error}`)
          hasError = true
        }
      } catch (error) {
        allResults.push(`Upload failed for ${file.name}: ${error.message || "Unknown error"}`)
        hasError = true
      }
    }

    setUploadMessage(allResults.join("\n"))
    if (!hasError) {
      setFiles(null)
      // Reset file input
      const fileInput = document.getElementById("file-upload") as HTMLInputElement
      if (fileInput) fileInput.value = ""
      await fetchSheets();
    }
    setUploading(false)
  }

  const handleQuery = async () => {
    if (!rollNo.trim() && !queryYear.trim() && !queryMess.trim()) {
      return
    }

    setQuerying(true)
    setQueryResult(null)

    try {
      let queryString = `?`
      if (rollNo.trim()) {
        queryString += `rollNo=${encodeURIComponent(rollNo.trim())}`
      }
      if (queryYear.trim()) {
        queryString += `${rollNo.trim() ? '&' : ''}year=${encodeURIComponent(queryYear.trim())}`
      }
      if (queryMess && queryMess !== "") {
        queryString += `${(rollNo.trim() || queryYear.trim()) ? '&' : ''}mess=${encodeURIComponent(queryMess)}`
      }

      const response = await fetch(`/api/query-attendance${queryString}`)
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

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('isAuthenticated')
      router.push('/login')
    }
  }

  // Fetch uploaded sheets
  const fetchSheets = async () => {
    setSheetsLoading(true);
    setSheetsError(null);
    try {
      const res = await fetch('/api/uploaded-sheets');
      if (!res.ok) throw new Error('Failed to fetch uploaded sheets');
      const data = await res.json();
      setSheets(data);
    } catch (err: any) {
      setSheetsError(err.message || 'Unknown error');
    } finally {
      setSheetsLoading(false);
    }
  };

  useEffect(() => {
    fetchSheets();
  }, []);

  // Delete a sheet
  const handleDeleteSheet = async (month: string, year: number, mess: string) => {
    setDeletingSheet(`${month}-${year}-${mess}`);
    setDeleteError(null);
    try {
      const res = await fetch('/api/delete-attendance', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, year, mess }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || result.message || 'Failed to delete sheet');
      }
      await fetchSheets();
    } catch (err: any) {
      setDeleteError(err.message || 'Unknown error');
    } finally {
      setDeletingSheet(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-2 relative">
          <h1 className="text-3xl font-bold text-gray-900">Mess Attendance Management</h1>
          <p className="text-gray-600">Upload Excel sheets and query student attendance data</p>
          <Button
            onClick={handleLogout}
            variant="ghost"
            className="absolute top-0 right-0 text-gray-600 hover:text-red-500"
            aria-label="Logout"
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => router.push("/uploaded-sheets")}
            className="flex items-center gap-2">
            <List className="w-4 h-4" /> Uploaded Sheets
          </Button>
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
              <Label htmlFor="mess-select">Select Mess</Label>
              <select
                id="mess-select"
                value={selectedMess}
                onChange={e => setSelectedMess(e.target.value)}
                className="block w-full border rounded p-2"
              >
                <option value="college">College</option>
                <option value="Saroj">Saroj</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="file-upload">Select Excel File</Label>
              <Input
                id="file-upload"
                type="file"
                accept=".xlsx,.xls"
                multiple
                onChange={(e) => setFiles(e.target.files)}
                className="cursor-pointer"
              />
            </div>
            <Button onClick={handleFileUpload} disabled={!files || files.length === 0 || uploading} className="w-full">
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
              <div className="flex-1">
                <Label htmlFor="query-year">Year (Optional)</Label>
                <Input
                  id="query-year"
                  type="number"
                  value={queryYear}
                  onChange={(e) => setQueryYear(e.target.value)}
                  placeholder="e.g., 2023"
                  onKeyPress={(e) => e.key === "Enter" && handleQuery()}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="query-mess">Mess (Optional)</Label>
                <select
                  id="query-mess"
                  value={queryMess}
                  onChange={e => setQueryMess(e.target.value)}
                  className="block w-full border rounded p-2"
                >
                  <option value="">All</option>
                  <option value="college">College</option>
                  <option value="Saroj">Saroj</option>
                </select>
              </div>
              <div className="flex items-end">
                <Button onClick={handleQuery} disabled={(!rollNo.trim() && !queryYear.trim() && !queryMess.trim()) || querying}>
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
                      {queryResult.months_data
                        .sort((a, b) => {
                          // Sort by year first (descending), then by month (ascending)
                          if (a.year !== b.year) {
                            return b.year - a.year;
                          }
                          return getMonthOrder(a.month) - getMonthOrder(b.month);
                        })
                        .map((record) => (
                        <div key={record.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                          <div>
                            <div className="font-medium">
                              {record.month} {record.year} <span className="ml-2 px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs">{record.mess}</span>
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

            {querying === false && !queryResult && (rollNo.trim() || queryYear.trim() || queryMess.trim()) && (
              <div className="p-3 rounded-md text-sm bg-yellow-50 text-yellow-700 border border-yellow-200">
                No records found for the given criteria.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
