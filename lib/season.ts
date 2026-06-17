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
