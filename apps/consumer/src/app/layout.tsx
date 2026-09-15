import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { ReadingLevelProvider } from "@/components/reading-level";
import { themeInitScript } from "@/components/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://aifit-engine.vercel.app";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf6ef" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1814" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "MY AI — find the AI that fits you",
  description:
    "A five-minute quiz for anyone who uses AI: homework, a shop, a side hustle, or a team. Get a friendly profile and setup files for ChatGPT, Claude, Gemini, Cursor, and more.",
  applicationName: "MY AI",
  appleWebApp: { title: "MY AI", capable: true, statusBarStyle: "default" },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "MY AI — find the AI that fits you",
    description: "Five minutes. Get an AI setup you can paste into ChatGPT, Claude, Gemini, or Cursor.",
    url: "/",
    siteName: "MY AI",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "MY AI — five minutes to an AI setup that matches how you work" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MY AI — find the AI that fits you",
    description: "Five minutes. Get an AI setup you can paste into the apps you already use.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ReadingLevelProvider>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
            {children}
          </main>
          <SiteFooter />
        </ReadingLevelProvider>
      </body>
    </html>
  );
}
