import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import ApiSportsConfig from "@/components/widgets/ApiSportsConfig";
import SeasonSwitcher from "@/components/SeasonSwitcher";
import HomeLink from "@/components/HomeLink";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "World Cup HUB",
  description: "Matches, stats, form and predictions for the 2026 FIFA World Cup",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-neutral-200 dark:border-neutral-800">
          <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-4">
            <HomeLink className="text-lg font-bold tracking-tight">
              World Cup <span className="text-neutral-400">HUB</span>
            </HomeLink>
            <div className="flex gap-4 text-sm text-neutral-500">
              <HomeLink className="hover:text-neutral-900 dark:hover:text-neutral-100">
                Matches
              </HomeLink>
              <Link href="/standings" className="hover:text-neutral-900 dark:hover:text-neutral-100">
                Standings
              </Link>
              <Link href="/players" className="hover:text-neutral-900 dark:hover:text-neutral-100">
                Players
              </Link>
              <Link href="/rankings" className="hover:text-neutral-900 dark:hover:text-neutral-100">
                Rankings
              </Link>
            </div>
            <SeasonSwitcher />
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-neutral-200 px-4 py-6 text-center text-xs text-neutral-400 dark:border-neutral-800">
          World Cup HUB — read-only stats &amp; analytics. Data: API-Football.
        </footer>
        <ApiSportsConfig />
      </body>
    </html>
  );
}
