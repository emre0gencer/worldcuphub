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
    <div className="ml-auto flex gap-1 rounded-lg border border-neutral-200 p-0.5 text-xs dark:border-neutral-800">
      {SEASONS.map((s) => (
        <Link
          key={s}
          href={s === DEFAULT_SEASON ? pathname : `${pathname}?season=${s}`}
          className={`rounded-md px-2 py-1 tabular-nums ${
            s === current
              ? "bg-neutral-900 font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900"
              : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
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
