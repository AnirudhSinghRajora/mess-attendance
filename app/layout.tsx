import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Mess Attendance',
  description: 'Created by IIITL'
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
