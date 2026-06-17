"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { DEFAULT_SEASON, SEASONS, resolveSeason } from "@/lib/season";

function Switcher() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = resolveSeason(searchParams.get("season") ?? undefined);

  // Match pages are season-implicit (the fixture id determines the season).
  if (pathname.startsWith("/matches/")) return null;

  return (
    <div className="ml-auto flex gap-0.5 rounded-lg border border-border-warm bg-surface p-0.5 font-mono text-xs">
      {SEASONS.map((s) => (
        <Link
          key={s}
          href={s === DEFAULT_SEASON ? pathname : `${pathname}?season=${s}`}
          className={`rounded-md px-2 py-1 tabular-nums transition-colors ${
            s === current
              ? "bg-ink font-semibold text-paper"
              : "text-muted hover:text-ink"
          }`}
        >
          {s}
        </Link>
      ))}
    </div>
  );
}

export default function SeasonSwitcher() {
  return (
    <Suspense>
      <Switcher />
    </Suspense>
  );
}
