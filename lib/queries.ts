import { getSupabase } from "./supabase";
import type {
  Match,
  MatchSnapshot,
  MatchWithTeams,
  PlayerMatchStats,
  Prediction,
  SnapshotStatEntry,
  TeamForm,
  TeamMatchStats,
} from "./types";

const MATCH_WITH_TEAMS = `
  *,
  home_team:teams!matches_home_team_id_fkey (*),
  away_team:teams!matches_away_team_id_fkey (*)
`;

export async function getAllMatches(): Promise<MatchWithTeams[]> {
  const { data, error } = await getSupabase()
    .from("matches")
    .select(MATCH_WITH_TEAMS)
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

/** Latest team_form row per team (most recent as_of_date). */
export async function getLatestForm(): Promise<TeamForm[]> {
  const { data, error } = await getSupabase()
    .from("team_form")
    .select("*")
    .order("as_of_date", { ascending: false });
  if (error) throw error;
  const latest = new Map<number, TeamForm>();
  for (const row of data as TeamForm[]) {
    if (!latest.has(row.team_id)) latest.set(row.team_id, row);
  }
  return [...latest.values()];
}

/** Full team_form history (for trend charts). */
export async function getFormHistory(teamIds?: number[]): Promise<TeamForm[]> {
  let query = getSupabase()
    .from("team_form")
    .select("*")
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

export async function getLatestPredictions(): Promise<Prediction[]> {
  const { data, error } = await getSupabase()
    .from("predictions")
    .select("*")
    .order("generated_at", { ascending: false });
  if (error) throw error;
  const latest = new Map<number, Prediction>();
  for (const row of data as Prediction[]) {
    if (!latest.has(row.match_id)) latest.set(row.match_id, row);
  }
  return [...latest.values()];
}

/** Prior meetings between two teams within the tournament dataset. */
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
export async function getFormForTeams(teamIds: number[]): Promise<Map<number, TeamForm>> {
  const { data, error } = await getSupabase()
    .from("team_form")
    .select("*")
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
