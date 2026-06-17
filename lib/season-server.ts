import { cookies } from "next/headers";
import { DEFAULT_SEASON, SEASON_COOKIE, asSeason } from "./season";

/** The locked season from the cookie, or null if unset/invalid. */
export async function getCookieSeason(): Promise<number | null> {
  const store = await cookies();
  return asSeason(store.get(SEASON_COOKIE)?.value);
}

/**
 * The active season for Server Components: the locked cookie choice, else the
 * build-time default. Deliberately ignores the URL — the season only changes
 * when the user clicks the switcher (which rewrites the cookie). Reading cookies
 * opts the route into dynamic rendering, which every page already is.
 */
export async function getActiveSeason(): Promise<number> {
  return (await getCookieSeason()) ?? DEFAULT_SEASON;
}
