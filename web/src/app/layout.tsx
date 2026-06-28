import type { Metadata, Viewport } from "next"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { ClientProviders } from "@/components/layout/client-providers"
import { I18nProvider } from "@/components/layout/i18n-provider"
import { SwRegister } from "@/components/layout/sw-register"

export const metadata: Metadata = {
  title: "Speaking Lab",
  description: "Offline English speaking practice platform for Arabic learners",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Speaking Lab",
  },
}

export const viewport: Viewport = {
  themeColor: "#3b82f6",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
        >
          <I18nProvider>
            <ClientProviders>
              {children}
            </ClientProviders>
          </I18nProvider>
        </ThemeProvider>
        <SwRegister />
      </body>
    </html>
  )
}
