// One codebase, two tournaments: every season-scoped page resolves its season
// from the ?season= search param, falling back to the build-time default.
export const SEASONS = [2022, 2026] as const;

export const DEFAULT_SEASON = Number(process.env.NEXT_PUBLIC_DEFAULT_SEASON ?? "2022");

export function resolveSeason(param: string | string[] | undefined): number {
  const n = Number(Array.isArray(param) ? param[0] : param);
  return (SEASONS as readonly number[]).includes(n) ? n : DEFAULT_SEASON;
}
