"use client";

import { usePathname, useRouter } from "next/navigation";
import { SEASONS, SEASON_COOKIE } from "@/lib/season";

/** Persist the chosen season. One year, site-wide, Lax so it rides navigations. */
function writeSeasonCookie(season: number) {
  document.cookie = `${SEASON_COOKIE}=${season}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Season toggle. The only thing in the app that changes the active season: it
 * writes the `wc_season` cookie and refreshes the current route so every Server
 * Component re-reads it. No URL params, no implicit syncing — the selection
 * never moves unless the user clicks it.
 */
export default function SeasonSwitcher({ current }: { current: number }) {
  const pathname = usePathname();
  const router = useRouter();

  // Match pages are season-implicit (the fixture id determines the season).
  if (pathname.startsWith("/matches/")) return null;

  const choose = (season: number) => {
    if (season === current) return;
    writeSeasonCookie(season);
    router.refresh();
  };

  return (
    <div className="ml-auto flex gap-0.5 rounded-lg border border-border-warm bg-surface p-0.5 font-mono text-xs">
      {SEASONS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => choose(s)}
          aria-pressed={s === current}
          className={`rounded-md px-2 py-1 tabular-nums transition-colors ${
            s === current
              ? "bg-ink font-semibold text-paper"
              : "text-muted hover:text-ink"
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
