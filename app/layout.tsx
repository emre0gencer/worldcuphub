import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Hanken_Grotesk, Geist_Mono } from "next/font/google";
import InteractiveGradientBg from "@/components/InteractiveGradientBg";
import SeasonSwitcher from "@/components/SeasonSwitcher";
import SiteMasthead from "@/components/SiteMasthead";
import HomeLink from "@/components/HomeLink";
import { getActiveSeason } from "@/lib/season-server";
import "./globals.css";

// Editorial display serif — headings, wordmark, headline accents.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  style: ["normal", "italic"],
});

// Warm grotesque — body & UI.
const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

// Tabular mono — scores, Elo, all numeric data.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "World Cup HUB",
  description: "Matches, stats, form and predictions for the 2026 FIFA World Cup",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Single source of truth for the season — passed to the switcher so its
  // highlight always matches the page content (both read the same cookie).
  const activeSeason = await getActiveSeason();
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${hankenGrotesk.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <InteractiveGradientBg />
        {/* Foil hairline */}
        <div className="h-[3px] bg-gradient-to-r from-transparent via-[#d8b56a] to-transparent" />
        <header className="sticky top-0 z-50 border-b border-border-warm bg-paper/70 backdrop-blur-md">
          <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3.5">
            <HomeLink className="group flex items-baseline gap-2">
              <span className="font-display text-[1.35rem] font-black leading-none tracking-tight text-ink">
                World&nbsp;Cup
              </span>
              <span className="font-mono text-base font-bold uppercase tracking-[0.18em] text-foil sm:text-lg">
                HUB
              </span>
            </HomeLink>
            <div className="flex items-center gap-5 text-[0.8rem] font-medium text-muted">
              <HomeLink className="relative transition-colors hover:text-ink">
                Matches
              </HomeLink>
              <Link href="/standings" className="transition-colors hover:text-ink">
                Standings
              </Link>
              <Link href="/players" className="transition-colors hover:text-ink">
                Players
              </Link>
              <Link href="/rankings" className="transition-colors hover:text-ink">
                Rankings
              </Link>
            </div>
            <SeasonSwitcher current={activeSeason} />
          </nav>
        </header>
        <SiteMasthead season={activeSeason} />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>
        <footer className="mt-8 border-t border-border-warm bg-surface-warm/70 backdrop-blur-sm px-4 py-7 text-center">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-foil">
            World Cup HUB
          </p>
          <p className="mt-1.5 text-xs text-muted">
            Read-only stats &amp; analytics &middot; Data: API-Football
          </p>
        </footer>
      </body>
    </html>
  );
}
