// One codebase, two tournaments. The active season is a *locked* choice that
// only ever changes when the user clicks the SeasonSwitcher — it is NOT derived
// from the URL. It lives in a cookie (written client-side by the switcher, read
// server-side in lib/season-server.ts) so it stays put across every navigation,
// defaulting to DEFAULT_SEASON for first-time visitors.
export const SEASONS = [2022, 2026] as const;

export const DEFAULT_SEASON = Number(process.env.NEXT_PUBLIC_DEFAULT_SEASON ?? "2026");

/** Cookie the switcher writes to persist the chosen season. */
export const SEASON_COOKIE = "wc_season";

/** Coerce an arbitrary value to a known season, or null if it isn't one. */
export function asSeason(value: string | number | null | undefined): number | null {
  const n = Number(value);
  return (SEASONS as readonly number[]).includes(n) ? n : null;
}

/**
 * Lifecycle of each tournament as far as the app is concerned. Both editions
 * are now COMPLETE: 2022 was backfilled after the fact (the demo), 2026 was
 * live-ingested from the opening match until the Final, after which the
 * worker shut itself down (`ingest.tournament_complete`). Pages use this to
 * drop "live" framing; whether an individual match is live is still decided
 * by the data (`matches.status`), never by this table.
 */
export interface SeasonInfo {
  status: "live" | "complete";
  /** How the data got in: after-the-fact backfill or a live worker. */
  ingestion: "backfill" | "live";
  /** Live-ingestion window (ISO dates), for seasons that had one. */
  ingestionStart?: string;
  ingestionEnd?: string;
}

export const SEASON_INFO: Record<number, SeasonInfo> = {
  2022: { status: "complete", ingestion: "backfill" },
  2026: {
    status: "complete",
    ingestion: "live",
    ingestionStart: "2026-06-11",
    ingestionEnd: "2026-07-19",
  },
};

export function seasonInfo(season: number): SeasonInfo {
  return SEASON_INFO[season] ?? { status: "complete", ingestion: "backfill" };
}

export function isComplete(season: number): boolean {
  return seasonInfo(season).status === "complete";
}

/** "11 Jun – 19 Jul 2026" style range for display. */
export function formatIngestionWindow(info: SeasonInfo): string | null {
  if (!info.ingestionStart || !info.ingestionEnd) return null;
  const fmt = (iso: string, withYear: boolean) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  return `${fmt(info.ingestionStart, false)} – ${fmt(info.ingestionEnd, true)}`;
}
