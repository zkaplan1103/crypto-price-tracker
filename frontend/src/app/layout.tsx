import type { Metadata } from 'next'
import { ErrorBoundary } from '../components/ErrorBoundary'

export const metadata: Metadata = {
  title: 'Project Pluto - Crypto Price Tracker',
  description: 'Real-time cryptocurrency price streaming',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </body>
    </html>
  )
}