-- World Cup HUB — initial schema (three-track design, see PROJECT_SPEC.md §4)
--
-- Reference tables: teams, players, matches (seeded once)
-- Track 1: match_snapshots (volatile live data)
-- Track 2: team_match_stats, player_match_stats (immutable, written at full-time)
-- Track 3: team_form, predictions (derived analytics, recomputed per matchday)

-- ── Reference tables ────────────────────────────────────────────────────────

create table teams (
  id            bigint primary key,           -- API-Football team id
  name          text not null,
  country_code  text not null,                -- ISO 3166-1 alpha-3
  flag_url      text,
  fifa_ranking  integer,
  elo           double precision not null default 1500,  -- maintained internally
  group_letter  text not null check (group_letter ~ '^[A-L]$')
);

create table players (
  id            bigint primary key,           -- API-Football player id
  team_id       bigint not null references teams (id),
  name          text not null,
  position      text check (position in ('GK', 'DF', 'MF', 'FW')),
  shirt_number  integer,
  photo_url     text,
  age           integer
);

create index players_team_id_idx on players (team_id);

create table matches (
  id                    bigint primary key,   -- API-Football fixture id
  -- nullable: knockout pairings are unknown until the preceding round finishes
  home_team_id          bigint references teams (id),
  away_team_id          bigint references teams (id),
  kickoff_at            timestamptz not null,
  venue                 text,
  stage                 text not null check (stage in ('group', 'R32', 'R16', 'QF', 'SF', 'final')),
  group_letter          text check (group_letter ~ '^[A-L]$'),
  status                text not null default 'scheduled'
                        check (status in ('scheduled', 'live', 'finished')),
  home_score            integer,
  away_score            integer,
  youtube_highlight_id  text                  -- nullable, deferred feature
);

create index matches_kickoff_at_idx on matches (kickoff_at);
create index matches_status_idx on matches (status);

-- ── Track 1 — volatile live data ────────────────────────────────────────────

create table match_snapshots (
  id              bigint generated always as identity primary key,
  match_id        bigint not null references matches (id),
  captured_at     timestamptz not null default now(),
  elapsed_minute  integer,
  payload         jsonb not null              -- raw live stats blob from API-Football
);

-- full time-series kept (momentum charts); index for "series for match" reads
create index match_snapshots_match_id_captured_at_idx
  on match_snapshots (match_id, captured_at);

-- ── Track 2 — permanent dataset (written once at full-time; immutable) ─────

create table team_match_stats (
  id              bigint generated always as identity primary key,
  match_id        bigint not null references matches (id),
  team_id         bigint not null references teams (id),
  possession      double precision,           -- percent 0–100
  shots           integer,
  shots_on_target integer,
  corners         integer,
  fouls           integer,
  passes          integer,
  pass_accuracy   double precision,           -- percent 0–100
  xg              double precision,           -- from API-Football, never self-computed
  goals_for       integer not null,
  goals_against   integer not null,
  unique (match_id, team_id)                  -- exactly 2 rows per match
);

create index team_match_stats_team_id_idx on team_match_stats (team_id);

create table player_match_stats (
  id          bigint generated always as identity primary key,
  match_id    bigint not null references matches (id),
  player_id   bigint not null references players (id),
  team_id     bigint not null references teams (id),
  minutes     integer,
  goals       integer not null default 0,
  assists     integer not null default 0,
  shots       integer not null default 0,
  key_passes  integer not null default 0,
  tackles     integer not null default 0,
  rating      double precision,
  unique (match_id, player_id)
);

create index player_match_stats_match_id_idx on player_match_stats (match_id);
create index player_match_stats_player_id_idx on player_match_stats (player_id);

-- ── Track 3 — derived analytics (recomputed per matchday) ──────────────────

create table team_form (
  id              bigint generated always as identity primary key,
  team_id         bigint not null references teams (id),
  as_of_date      date not null,
  overall_form    double precision not null,  -- display scale 0–100, average ≈ 50
  attacking_form  double precision not null,
  defending_form  double precision not null,
  elo             double precision not null,
  sample_size     integer not null,
  unique (team_id, as_of_date)                -- one row per team per matchday; history kept
);

create index team_form_team_id_as_of_date_idx on team_form (team_id, as_of_date);

create table predictions (
  id                    bigint generated always as identity primary key,
  match_id              bigint not null references matches (id),
  home_win_prob         double precision not null,
  draw_prob             double precision not null,
  away_win_prob         double precision not null,
  predicted_home_goals  double precision,
  predicted_away_goals  double precision,
  upset_probability     double precision not null,
  model_version         text not null,
  generated_at          timestamptz not null default now()
);

create index predictions_match_id_generated_at_idx
  on predictions (match_id, generated_at desc);

-- ── Access control ──────────────────────────────────────────────────────────
-- Fully read-only app: anon role may SELECT everything; all writes go through
-- the Python worker using the service-role key (bypasses RLS).

alter table teams enable row level security;
alter table players enable row level security;
alter table matches enable row level security;
alter table match_snapshots enable row level security;
alter table team_match_stats enable row level security;
alter table player_match_stats enable row level security;
alter table team_form enable row level security;
alter table predictions enable row level security;

create policy "public read" on teams for select using (true);
create policy "public read" on players for select using (true);
create policy "public read" on matches for select using (true);
create policy "public read" on match_snapshots for select using (true);
create policy "public read" on team_match_stats for select using (true);
create policy "public read" on player_match_stats for select using (true);
create policy "public read" on team_form for select using (true);
create policy "public read" on predictions for select using (true);
