"use client"

import { useState, useEffect } from "react"
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FileSpreadsheet, ArrowLeft } from "lucide-react"

export default function UploadedSheetsPage() {
  const [sheets, setSheets] = useState<{ month: string; year: number; mess: string }[]>([])
  const [sheetsLoading, setSheetsLoading] = useState(false)
  const [sheetsError, setSheetsError] = useState<string | null>(null)
  const [deletingSheet, setDeletingSheet] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const router = useRouter()

  // Helper function to get month order for sorting
  const getMonthOrder = (monthName: string): number => {
    const monthMap: { [key: string]: number } = {
      "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
      "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12,
    }
    return monthMap[monthName] || 0;
  };

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
        <Button variant="ghost" onClick={() => router.push("/")}
          className="mb-2 flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" />
              Uploaded Sheets
            </CardTitle>
            <CardDescription>List of all uploaded attendance sheets by month, year, and mess</CardDescription>
          </CardHeader>
          <CardContent>
            {sheetsLoading ? (
              <div className="text-gray-500">Loading sheets...</div>
            ) : sheetsError ? (
              <div className="text-red-600">{sheetsError}</div>
            ) : sheets.length === 0 ? (
              <div className="text-gray-500">No sheets uploaded yet.</div>
            ) : (
              <div className="space-y-2">
                {[...sheets]
                  .sort((a, b) => {
                    if (a.mess !== b.mess) return a.mess.localeCompare(b.mess);
                    if (a.year !== b.year) return b.year - a.year;
                    return getMonthOrder(a.month) - getMonthOrder(b.month);
                  })
                  .map(({ month, year, mess }) => (
                    <div key={`${month}-${year}-${mess}`} className="flex items-center justify-between bg-gray-50 rounded p-3 border">
                      <span className="font-medium">{month} {year} <span className="ml-2 px-2 py-1 rounded bg-blue-100 text-blue-800 text-xs">{mess}</span></span>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deletingSheet === `${month}-${year}-${mess}`}
                        onClick={() => handleDeleteSheet(month, year, mess)}
                      >
                        {deletingSheet === `${month}-${year}-${mess}` ? 'Deleting...' : 'Delete'}
                      </Button>
                    </div>
                  ))}
              </div>
            )}
            {deleteError && <div className="text-red-600 mt-2">{deleteError}</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  )
} 