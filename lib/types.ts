// Row types mirroring supabase/migrations/0001_initial_schema.sql

export type MatchStatus = "scheduled" | "live" | "finished";
export type Stage = "group" | "R32" | "R16" | "QF" | "SF" | "final";

export interface Team {
  id: number;
  name: string;
  country_code: string;
  flag_url: string | null;
  fifa_ranking: number | null;
  elo: number;
  group_letter: string;
}

export interface Player {
  id: number;
  team_id: number;
  name: string;
  position: "GK" | "DF" | "MF" | "FW" | null;
  shirt_number: number | null;
  photo_url: string | null;
  age: number | null;
}

export interface Match {
  id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  kickoff_at: string;
  venue: string | null;
  stage: Stage;
  group_letter: string | null;
  status: MatchStatus;
  home_score: number | null;
  away_score: number | null;
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
  captured_at: string;
  elapsed_minute: number | null;
  payload: SnapshotPayload;
}

// Track 2
export interface TeamMatchStats {
  id: number;
  match_id: number;
  team_id: number;
  possession: number | null;
  shots: number | null;
  shots_on_target: number | null;
  corners: number | null;
  fouls: number | null;
  passes: number | null;
  pass_accuracy: number | null;
  xg: number | null;
  goals_for: number;
  goals_against: number;
}

export interface PlayerMatchStats {
  id: number;
  match_id: number;
  player_id: number;
  team_id: number;
  minutes: number | null;
  goals: number;
  assists: number;
  shots: number;
  key_passes: number;
  tackles: number;
  rating: number | null;
  player?: Player;
}

// Track 3
export interface TeamForm {
  id: number;
  team_id: number;
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
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
  predicted_home_goals: number | null;
  predicted_away_goals: number | null;
  upset_probability: number;
  model_version: string;
  generated_at: string;
}
