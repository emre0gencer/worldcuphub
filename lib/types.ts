// Row types mirroring supabase/migrations/0002_season_rebuild.sql

export type MatchStatus = "scheduled" | "live" | "finished";
export type Stage = "group" | "R32" | "R16" | "QF" | "SF" | "third_place" | "final";

export interface Team {
  id: number;
  name: string;
  country_code: string | null;
  logo_url: string | null;
}

export interface TeamSeason {
  team_id: number;
  season: number;
  fifa_ranking: number | null;
  elo: number;
  initial_elo: number | null;
  fifa_points: number | null;
  team?: Team;
}

export interface Player {
  id: number;
  name: string;
  firstname: string | null;
  lastname: string | null;
  birth_date: string | null;
  nationality: string | null;
  height: string | null;
  weight: string | null;
  photo_url: string | null;
}

export interface Match {
  id: number;
  season: number;
  home_team_id: number | null;
  away_team_id: number | null;
  kickoff_at: string;
  referee: string | null;
  venue: string | null;
  venue_city: string | null;
  round: string;
  stage: Stage;
  group_letter: string | null;
  status_short: string;
  status: MatchStatus; // generated in Postgres from status_short
  home_score: number | null; // headline (after ET, excl. shootout)
  away_score: number | null;
  ht_home: number | null;
  ht_away: number | null;
  ft_home: number | null; // regulation 90' score
  ft_away: number | null;
  pen_home: number | null;
  pen_away: number | null;
  home_winner: boolean | null;
  youtube_highlight_id: string | null;
}

export interface MatchWithTeams extends Match {
  home_team: Team | null;
  away_team: Team | null;
}

// Track 1 — snapshot payload is the raw API-Football-shaped blob the worker writes
export interface SnapshotStatEntry {
  team: { id: number };
  statistics: { type: string; value: number | string | null }[];
}

export interface SnapshotPayload {
  fixture: { id: number; status: { short: string; elapsed: number | null } };
  goals: { home: number | null; away: number | null };
  statistics: SnapshotStatEntry[];
}

export interface MatchSnapshot {
  id: number;
  match_id: number;
  season: number;
  captured_at: string;
  elapsed_minute: number | null;
  payload: SnapshotPayload;
}

// Reconstructed momentum (migration 0005) — REAL per-team, per-minute cumulative
// series rebuilt from ESPN match commentary for matches that were never
// live-ingested (no match_snapshots). Used by the frontend only as a fallback.
export interface MatchMomentum {
  match_id: number;
  season: number;
  metric: string; // total_shots | shots_on_target | corners | fouls
  source: string; // 'espn-commentary'
  points: { minute: number; home: number; away: number }[];
  generated_at: string;
}

// Track 2 — immutable finalized stats
export interface TeamMatchStats {
  id: number;
  match_id: number;
  team_id: number;
  season: number;
  goals_for: number;
  goals_against: number;
  possession: number | null;
  shots: number | null;
  shots_on_target: number | null;
  shots_off_target: number | null;
  shots_blocked: number | null;
  shots_inside_box: number | null;
  shots_outside_box: number | null;
  fouls: number | null;
  corners: number | null;
  offsides: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  saves: number | null;
  passes: number | null;
  passes_accurate: number | null;
  pass_accuracy: number | null;
  xg: number | null;
  goals_prevented: number | null;
}

export interface PlayerMatchStats {
  id: number;
  match_id: number;
  player_id: number;
  team_id: number;
  season: number;
  minutes: number | null;
  rating: number | null;
  captain: boolean | null;
  substitute: boolean | null;
  offsides: number | null;
  shots: number | null;
  shots_on_target: number | null;
  goals: number | null;
  goals_conceded: number | null;
  assists: number | null;
  saves: number | null;
  passes: number | null;
  key_passes: number | null;
  pass_accuracy: number | null;
  tackles: number | null;
  blocks: number | null;
  interceptions: number | null;
  duels: number | null;
  duels_won: number | null;
  dribbles_attempted: number | null;
  dribbles_succeeded: number | null;
  dribbled_past: number | null;
  fouls_drawn: number | null;
  fouls_committed: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  penalties_won: number | null;
  penalties_committed: number | null;
  penalties_scored: number | null;
  penalties_missed: number | null;
  penalties_saved: number | null;
  player?: Player;
}

export interface MatchEvent {
  id: number;
  match_id: number;
  season: number;
  order_index: number;
  elapsed: number | null;
  elapsed_extra: number | null;
  team_id: number | null;
  player_id: number | null;
  player_name: string | null;
  assist_id: number | null;
  assist_name: string | null;
  type: string | null; // Goal | Card | subst | Var
  detail: string | null;
  comments: string | null; // 'Penalty Shootout' marks shootout kicks
}

export interface MatchLineup {
  match_id: number;
  team_id: number;
  season: number;
  formation: string | null;
  coach_id: number | null;
  coach_name: string | null;
}

export interface MatchLineupPlayer {
  id: number;
  match_id: number;
  team_id: number;
  season: number;
  player_id: number | null;
  player_name: string | null;
  shirt_number: number | null;
  position: string | null; // G / D / M / F
  grid: string | null; // 'row:col', null for subs
  starter: boolean;
}

// Stored API copies (cross-checked against computed values)
export interface StandingsRow {
  season: number;
  team_id: number;
  rank: number | null;
  group_name: string | null;
  points: number | null;
  goals_diff: number | null;
  form: string | null;
  description: string | null;
  played: number | null;
  won: number | null;
  drawn: number | null;
  lost: number | null;
  goals_for: number | null;
  goals_against: number | null;
  updated_at: string | null;
  team?: Team;
}

export interface PlayerSeasonStats {
  player_id: number;
  season: number;
  team_id: number | null;
  position: string | null;
  appearances: number | null;
  lineups: number | null;
  minutes: number | null;
  rating: number | null;
  captain: boolean | null;
  subs_in: number | null;
  subs_out: number | null;
  bench: number | null;
  shots: number | null;
  shots_on_target: number | null;
  goals: number | null;
  goals_conceded: number | null;
  assists: number | null;
  saves: number | null;
  passes: number | null;
  key_passes: number | null;
  pass_accuracy: number | null;
  tackles: number | null;
  blocks: number | null;
  interceptions: number | null;
  duels: number | null;
  duels_won: number | null;
  dribbles_attempted: number | null;
  dribbles_succeeded: number | null;
  dribbled_past: number | null;
  fouls_drawn: number | null;
  fouls_committed: number | null;
  yellow_cards: number | null;
  yellowred_cards: number | null;
  red_cards: number | null;
  penalties_won: number | null;
  penalties_committed: number | null;
  penalties_scored: number | null;
  penalties_missed: number | null;
  penalties_saved: number | null;
  player?: Player;
  team?: Team;
}

// ── Player profile (PlayerWindow) ────────────────────────────────────────────
// Assembled client-side from `players` + this season's `player_match_stats`
// (with each match's opponent embedded). Powers the PlayerWindow modal.

/** Stat a caller can ask PlayerWindow to feature as the "main stat", chosen by
 *  the context the player was clicked in (a scorer board → goals, etc.). */
export type PlayerStatKey =
  | "goals"
  | "assists"
  | "goal_contributions"
  | "rating"
  | "saves"
  | "clean_sheets"
  | "key_passes"
  | "dribbles"
  | "shots"
  | "tackles"
  | "interceptions"
  | "minutes";

export interface PlayerMatchLogEntry {
  matchId: number;
  kickoffAt: string;
  stage: Stage;
  groupLetter: string | null;
  statusShort: string;
  isHome: boolean;
  opponent: Team | null;
  teamScore: number | null;
  opponentScore: number | null;
  result: "W" | "D" | "L" | null;
  minutes: number | null;
  rating: number | null;
  goals: number | null;
  assists: number | null;
  yellow: number | null;
  red: number | null;
  started: boolean;
}

export interface PlayerProfileTotals {
  appearances: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  goalContributions: number;
  shots: number;
  shotsOnTarget: number;
  offsides: number;
  keyPasses: number;
  passes: number;
  passesAccurate: number;
  passAccuracy: number | null; // % = passesAccurate / passes
  dribblesAttempted: number;
  dribblesSucceeded: number;
  tackles: number;
  interceptions: number;
  blocks: number;
  dribbledPast: number;
  duels: number;
  duelsWon: number;
  foulsCommitted: number;
  foulsDrawn: number;
  yellow: number;
  red: number;
  saves: number;
  goalsConceded: number;
  cleanSheets: number;
  penaltiesScored: number;
  penaltiesMissed: number;
  penaltiesWon: number;
  penaltiesCommitted: number;
  penaltiesSaved: number;
  captainedMatches: number;
  avgRating: number | null;
  bestRating: number | null;
}

export interface PlayerProfile {
  player: Player;
  team: Team | null;
  position: string | null; // G / D / M / F (season-level)
  season: number;
  totals: PlayerProfileTotals;
  log: PlayerMatchLogEntry[]; // chronological (earliest → latest)
}

// Track 3 — derived analytics
export interface TeamForm {
  id: number;
  team_id: number;
  season: number;
  as_of_date: string;
  overall_form: number;
  attacking_form: number;
  defending_form: number;
  elo: number;
  sample_size: number;
}

export interface Prediction {
  id: number;
  match_id: number;
  season: number;
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
  predicted_home_goals: number | null;
  predicted_away_goals: number | null;
  upset_probability: number;
  model_version: string;
  generated_at: string;
}
