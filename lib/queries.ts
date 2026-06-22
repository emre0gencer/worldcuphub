import { getSupabase } from "./supabase";
import type {
  Match,
  MatchEvent,
  MatchLineup,
  MatchLineupPlayer,
  MatchMomentum,
  MatchSnapshot,
  MatchWithTeams,
  Player,
  PlayerMatchStats,
  PlayerSeasonStats,
  Prediction,
  SnapshotStatEntry,
  StandingsRow,
  Team,
  TeamForm,
  TeamMatchStats,
  TeamSeason,
} from "./types";

type Sb = ReturnType<typeof getSupabase>;

// PostgREST returns at most 1000 rows per request; anything that can exceed
// that (per-match aggregates) must page explicitly or it silently truncates.
const PAGE_SIZE = 1000;

/** Fetch rows by primary-key id in chunks, keeping each `in()` URL bounded. */
async function fetchByIds<T>(sb: Sb, table: string, ids: number[]): Promise<T[]> {
  const CHUNK = 300;
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await sb.from(table).select("*").in("id", slice);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

const MATCH_WITH_TEAMS = `
  *,
  home_team:teams!matches_home_team_id_fkey (*),
  away_team:teams!matches_away_team_id_fkey (*)
`;

export async function getAllMatches(season: number): Promise<MatchWithTeams[]> {
  const { data, error } = await getSupabase()
    .from("matches")
    .select(MATCH_WITH_TEAMS)
    .eq("season", season)
    .order("kickoff_at", { ascending: true });
  if (error) throw error;
  return data as unknown as MatchWithTeams[];
}

export async function getMatch(id: number): Promise<MatchWithTeams | null> {
  const { data, error } = await getSupabase()
    .from("matches")
    .select(MATCH_WITH_TEAMS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as MatchWithTeams | null;
}

export async function getSnapshotSeries(matchId: number): Promise<MatchSnapshot[]> {
  const { data, error } = await getSupabase()
    .from("match_snapshots")
    .select("*")
    .eq("match_id", matchId)
    .order("captured_at", { ascending: true });
  if (error) throw error;
  return data as MatchSnapshot[];
}

/** Reconstructed momentum (ESPN-derived) for matches that were never live-ingested.
 *  Returned only as a fallback when getSnapshotSeries is empty. */
export async function getReconstructedMomentum(matchId: number): Promise<MatchMomentum[]> {
  const { data, error } = await getSupabase()
    .from("match_momentum")
    .select("*")
    .eq("match_id", matchId);
  if (error) throw error;
  return data as MatchMomentum[];
}

/** Just the latest live clock (elapsed minute) for the scoreboard — avoids
 *  pulling the full snapshot series when only the minute is needed. */
export async function getLatestSnapshotMinute(matchId: number): Promise<number | null> {
  const { data, error } = await getSupabase()
    .from("match_snapshots")
    .select("elapsed_minute")
    .eq("match_id", matchId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.elapsed_minute as number | null) ?? null;
}

export async function getTeamMatchStats(matchId: number): Promise<TeamMatchStats[]> {
  const { data, error } = await getSupabase()
    .from("team_match_stats")
    .select("*")
    .eq("match_id", matchId);
  if (error) throw error;
  return data as TeamMatchStats[];
}

export async function getPlayerMatchStats(matchId: number): Promise<PlayerMatchStats[]> {
  const { data, error } = await getSupabase()
    .from("player_match_stats")
    .select("*, player:players (*)")
    .eq("match_id", matchId)
    .order("rating", { ascending: false });
  if (error) throw error;
  return data as unknown as PlayerMatchStats[];
}

export async function getMatchEvents(matchId: number): Promise<MatchEvent[]> {
  const { data, error } = await getSupabase()
    .from("match_events")
    .select("*")
    .eq("match_id", matchId)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return data as MatchEvent[];
}

export async function getMatchLineups(
  matchId: number,
): Promise<{ teams: MatchLineup[]; players: MatchLineupPlayer[] }> {
  const [teamsRes, playersRes] = await Promise.all([
    getSupabase().from("match_lineups").select("*").eq("match_id", matchId),
    getSupabase()
      .from("match_lineup_players")
      .select("*")
      .eq("match_id", matchId)
      .order("grid", { ascending: true }),
  ]);
  if (teamsRes.error) throw teamsRes.error;
  if (playersRes.error) throw playersRes.error;
  return {
    teams: teamsRes.data as MatchLineup[],
    players: playersRes.data as MatchLineupPlayer[],
  };
}

/** Stored API standings copy — cross-checked against tables computed from matches. */
export async function getStoredStandings(season: number): Promise<StandingsRow[]> {
  const { data, error } = await getSupabase()
    .from("standings")
    .select("*, team:teams (*)")
    .eq("season", season)
    .order("group_name", { ascending: true })
    .order("rank", { ascending: true });
  if (error) throw error;
  return data as unknown as StandingsRow[];
}

export async function getTeamSeasons(season: number): Promise<TeamSeason[]> {
  const { data, error } = await getSupabase()
    .from("team_seasons")
    .select("*, team:teams (*)")
    .eq("season", season);
  if (error) throw error;
  return data as unknown as TeamSeason[];
}

// Per-match stat columns the leaderboards aggregate. Pulling only these keeps
// the (potentially multi-thousand-row) season scan light.
const LEADERBOARD_COLS =
  "player_id, team_id, minutes, rating, goals, assists, saves, key_passes, dribbles_succeeded, dribbles_attempted, shots, shots_on_target";

type LeaderboardRow = Pick<
  PlayerMatchStats,
  | "player_id"
  | "team_id"
  | "minutes"
  | "rating"
  | "goals"
  | "assists"
  | "saves"
  | "key_passes"
  | "dribbles_succeeded"
  | "dribbles_attempted"
  | "shots"
  | "shots_on_target"
>;

/**
 * Per-player season leaderboards, aggregated **live** from the immutable
 * per-match table (`player_match_stats`).
 *
 * Why not `player_season_stats`? That table is a stored copy of the API's
 * `/players` season endpoint and is only refreshed by a full backfill
 * (`worker/pipeline.upsert_players`, called solely from `backfill.py`). The
 * live worker never rewrites it, so mid-tournament it goes stale — a player's
 * latest matches (e.g. a hat-trick) would be missing from the board.
 * `player_match_stats` is written at every match's finalize step, so summing it
 * reflects every finished match at all times.
 *
 * Counting stats (goals, assists, …) are straight totals; `rating` is a
 * minutes-weighted average of per-match ratings; `minutes` is the season total
 * (used for the rating-eligibility floor and as a leaderboard tiebreak).
 */
export async function getPlayerSeasonStats(season: number): Promise<PlayerSeasonStats[]> {
  const sb = getSupabase();

  // 1. Page through every per-match stat row for the season.
  const rows: LeaderboardRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await sb
      .from("player_match_stats")
      .select(LEADERBOARD_COLS)
      .eq("season", season)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as LeaderboardRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  if (rows.length === 0) return [];

  // 2. Aggregate per player.
  interface Agg {
    team_id: number | null;
    appearances: number;
    minutes: number;
    goals: number;
    assists: number;
    saves: number;
    key_passes: number;
    dribbles_succeeded: number;
    dribbles_attempted: number;
    shots: number;
    shots_on_target: number;
    ratingWeighted: number; // Σ rating·minutes
    ratingMinutes: number; // Σ minutes over rated appearances
  }
  const byPlayer = new Map<number, Agg>();
  for (const r of rows) {
    let a = byPlayer.get(r.player_id);
    if (!a) {
      a = {
        team_id: r.team_id ?? null,
        appearances: 0,
        minutes: 0,
        goals: 0,
        assists: 0,
        saves: 0,
        key_passes: 0,
        dribbles_succeeded: 0,
        dribbles_attempted: 0,
        shots: 0,
        shots_on_target: 0,
        ratingWeighted: 0,
        ratingMinutes: 0,
      };
      byPlayer.set(r.player_id, a);
    }
    if (r.team_id != null) a.team_id = r.team_id; // constant per player in practice
    const mins = r.minutes ?? 0;
    if (mins > 0) a.appearances += 1;
    a.minutes += mins;
    a.goals += r.goals ?? 0;
    a.assists += r.assists ?? 0;
    a.saves += r.saves ?? 0;
    a.key_passes += r.key_passes ?? 0;
    a.dribbles_succeeded += r.dribbles_succeeded ?? 0;
    a.dribbles_attempted += r.dribbles_attempted ?? 0;
    a.shots += r.shots ?? 0;
    a.shots_on_target += r.shots_on_target ?? 0;
    if (r.rating != null && mins > 0) {
      a.ratingWeighted += r.rating * mins;
      a.ratingMinutes += mins;
    }
  }

  // 3. Resolve the player + team profiles the board renders.
  const playerIds = [...byPlayer.keys()];
  const teamIds = [
    ...new Set(
      [...byPlayer.values()]
        .map((a) => a.team_id)
        .filter((t): t is number => t != null),
    ),
  ];
  const [players, teams] = await Promise.all([
    fetchByIds<Player>(sb, "players", playerIds),
    fetchByIds<Team>(sb, "teams", teamIds),
  ]);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // 4. Project to the PlayerSeasonStats shape the page already consumes. Only
  //    the fields the leaderboards use are populated; the rest stay null.
  return [...byPlayer.entries()].map(([player_id, a]) => ({
    player_id,
    season,
    team_id: a.team_id,
    position: null,
    appearances: a.appearances,
    lineups: null,
    minutes: a.minutes,
    rating: a.ratingMinutes > 0 ? a.ratingWeighted / a.ratingMinutes : null,
    captain: null,
    subs_in: null,
    subs_out: null,
    bench: null,
    shots: a.shots,
    shots_on_target: a.shots_on_target,
    goals: a.goals,
    goals_conceded: null,
    assists: a.assists,
    saves: a.saves,
    passes: null,
    key_passes: a.key_passes,
    pass_accuracy: null,
    tackles: null,
    blocks: null,
    interceptions: null,
    duels: null,
    duels_won: null,
    dribbles_attempted: a.dribbles_attempted,
    dribbles_succeeded: a.dribbles_succeeded,
    dribbled_past: null,
    fouls_drawn: null,
    fouls_committed: null,
    yellow_cards: null,
    yellowred_cards: null,
    red_cards: null,
    penalties_won: null,
    penalties_committed: null,
    penalties_scored: null,
    penalties_missed: null,
    penalties_saved: null,
    player: playerById.get(player_id),
    team: a.team_id != null ? teamById.get(a.team_id) : undefined,
  }));
}

/** Latest team_form row per team (most recent as_of_date) for one season. */
export async function getLatestForm(season: number): Promise<TeamForm[]> {
  const { data, error } = await getSupabase()
    .from("team_form")
    .select("*")
    .eq("season", season)
    .order("as_of_date", { ascending: false });
  if (error) throw error;
  const latest = new Map<number, TeamForm>();
  for (const row of data as TeamForm[]) {
    if (!latest.has(row.team_id)) latest.set(row.team_id, row);
  }
  return [...latest.values()];
}

/** Full team_form history (for trend charts). */
export async function getFormHistory(season: number, teamIds?: number[]): Promise<TeamForm[]> {
  let query = getSupabase()
    .from("team_form")
    .select("*")
    .eq("season", season)
    .order("as_of_date", { ascending: true });
  if (teamIds && teamIds.length > 0) query = query.in("team_id", teamIds);
  const { data, error } = await query;
  if (error) throw error;
  return data as TeamForm[];
}

/** Latest prediction per match (predictions keep history via generated_at). */
export async function getLatestPrediction(matchId: number): Promise<Prediction | null> {
  const { data, error } = await getSupabase()
    .from("predictions")
    .select("*")
    .eq("match_id", matchId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as Prediction | null;
}

export async function getLatestPredictions(season: number): Promise<Prediction[]> {
  const { data, error } = await getSupabase()
    .from("predictions")
    .select("*")
    .eq("season", season)
    .order("generated_at", { ascending: false });
  if (error) throw error;
  const latest = new Map<number, Prediction>();
  for (const row of data as Prediction[]) {
    if (!latest.has(row.match_id)) latest.set(row.match_id, row);
  }
  return [...latest.values()];
}

/** Prior meetings between two teams across stored tournaments. */
export async function getPriorMeetings(teamA: number, teamB: number): Promise<Match[]> {
  const { data, error } = await getSupabase()
    .from("matches")
    .select("*")
    .eq("status", "finished")
    .or(
      `and(home_team_id.eq.${teamA},away_team_id.eq.${teamB}),and(home_team_id.eq.${teamB},away_team_id.eq.${teamA})`,
    );
  if (error) throw error;
  return data as Match[];
}

/** Latest form rows for a pair of teams (pre-match head-to-head). */
export async function getFormForTeams(
  season: number,
  teamIds: number[],
): Promise<Map<number, TeamForm>> {
  const { data, error } = await getSupabase()
    .from("team_form")
    .select("*")
    .eq("season", season)
    .in("team_id", teamIds)
    .order("as_of_date", { ascending: false });
  if (error) throw error;
  const latest = new Map<number, TeamForm>();
  for (const row of data as TeamForm[]) {
    if (!latest.has(row.team_id)) latest.set(row.team_id, row);
  }
  return latest;
}

/** Extract a stat value from a snapshot's API-Football-shaped statistics blob. */
export function snapshotStat(
  entries: SnapshotStatEntry[],
  teamId: number,
  type: string,
): number | null {
  const entry = entries.find((e) => e.team.id === teamId);
  const stat = entry?.statistics.find((s) => s.type === type);
  if (stat?.value == null) return null;
  if (typeof stat.value === "string") return parseFloat(stat.value.replace("%", ""));
  return stat.value;
}
