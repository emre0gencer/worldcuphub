-- 0002_season_rebuild.sql
-- Clean rebuild per PROJECT_SPEC_2.md + discovery/FIELD_INVENTORY.md (reviewed & approved).
-- Drops the mock-seeded schema entirely and recreates it season-parameterized so
-- season=2022 (demo) and season=2026 (live) coexist. All columns are backed by
-- fields verified to exist in real API-Football responses (discovery/2022/*.json).
-- Notable decisions:
--   * NO xg column — API-Football returns no expected_goals for league=1/season=2022.
--   * matches.status is a STORED GENERATED column derived from status_short (no drift).
--   * Scores: ht_* (half-time), ft_* (regulation 90'), pen_* (shootout), home/away_score
--     (headline, after ET). score.extratime is derivable and not stored.
--   * group_letter lives ONLY on matches; tournament-scoped team facts in team_seasons.
--   * Lineups split: match_lineups (per team) + match_lineup_players (per player) —
--     the single home for per-fixture position/shirt_number.
--   * standings + player_season_stats are stored API copies kept to cross-check
--     values computed from owned match data.

-- ── drop old schema (mock seed included) ─────────────────────────────────────

drop table if exists predictions cascade;
drop table if exists team_form cascade;
drop table if exists player_match_stats cascade;
drop table if exists team_match_stats cascade;
drop table if exists match_snapshots cascade;
drop table if exists matches cascade;
drop table if exists players cascade;
drop table if exists teams cascade;

-- ── reference: global entities ───────────────────────────────────────────────

create table teams (
  id           bigint primary key,          -- API team id
  name         text not null,
  country_code text,                        -- API team.code, e.g. 'ARG'
  logo_url     text
);

create table team_seasons (
  team_id      bigint not null references teams (id),
  season       int    not null,
  fifa_ranking int,
  elo          double precision not null default 1500,
  primary key (team_id, season)
);

create table players (
  id          bigint primary key,           -- API player id
  name        text not null,
  firstname   text,
  lastname    text,
  birth_date  date,
  nationality text,
  height      text,                         -- API returns '187' (cm) as text
  weight      text,
  photo_url   text
);

create table matches (
  id            bigint primary key,         -- API fixture id
  season        int    not null,
  home_team_id  bigint references teams (id),   -- nullable: knockout pairings TBD
  away_team_id  bigint references teams (id),
  kickoff_at    timestamptz not null,
  referee       text,
  venue         text,
  venue_city    text,
  round         text not null,              -- raw API round, e.g. 'Group Stage - 1'
  stage         text not null check (stage in ('group','R32','R16','QF','SF','third_place','final')),
  group_letter  text,                       -- only home of group info (denormalized)
  status_short  text not null default 'NS', -- API status code: source of truth
  status        text generated always as (
    case
      when status_short in ('FT','AET','PEN','AWD','WO') then 'finished'
      when status_short in ('1H','HT','2H','ET','BT','P','SUSP','INT','LIVE') then 'live'
      else 'scheduled'
    end
  ) stored,
  home_score    int,                        -- headline score (after ET, excl. shootout)
  away_score    int,
  ht_home       int,                        -- half-time
  ht_away       int,
  ft_home       int,                        -- regulation 90' score
  ft_away       int,
  pen_home      int,                        -- shootout
  pen_away      int,
  home_winner   boolean,                    -- API teams.home.winner; null = draw/unknown
  youtube_highlight_id text                 -- deferred feature
);

create index matches_season_kickoff_idx on matches (season, kickoff_at);
create index matches_season_status_idx  on matches (season, status_short);

-- ── track 1: volatile live snapshots ─────────────────────────────────────────

create table match_snapshots (
  id             bigserial primary key,
  match_id       bigint not null references matches (id),
  season         int    not null,
  captured_at    timestamptz not null default now(),
  elapsed_minute int,
  payload        jsonb not null              -- raw API-Football fixture blob
);

create index match_snapshots_match_idx on match_snapshots (match_id, captured_at);

-- ── track 2: immutable finalized stats ───────────────────────────────────────

create table team_match_stats (
  id                bigserial primary key,
  match_id          bigint not null references matches (id),
  team_id           bigint not null references teams (id),
  season            int    not null,
  goals_for         int not null,
  goals_against     int not null,
  possession        double precision,        -- '78%' parsed to 78
  shots             int,                     -- Total Shots
  shots_on_target   int,                     -- Shots on Goal
  shots_off_target  int,                     -- Shots off Goal
  shots_blocked     int,                     -- Blocked Shots
  shots_inside_box  int,
  shots_outside_box int,
  fouls             int,
  corners           int,
  offsides          int,
  yellow_cards      int,
  red_cards         int,
  saves             int,                     -- Goalkeeper Saves
  passes            int,                     -- Total passes
  passes_accurate   int,
  pass_accuracy     double precision,        -- 'Passes %' parsed
  unique (match_id, team_id)
);

create index team_match_stats_season_team_idx on team_match_stats (season, team_id);

create table player_match_stats (
  id                  bigserial primary key,
  match_id            bigint not null references matches (id),
  player_id           bigint not null references players (id),
  team_id             bigint not null references teams (id),
  season              int    not null,
  minutes             int,
  rating              double precision,      -- API string '6.3' parsed
  captain             boolean,
  substitute          boolean,
  offsides            int,
  shots               int,
  shots_on_target     int,
  goals               int,
  goals_conceded      int,
  assists             int,
  saves               int,
  passes              int,
  key_passes          int,
  pass_accuracy       double precision,
  tackles             int,
  blocks              int,
  interceptions       int,
  duels               int,
  duels_won           int,
  dribbles_attempted  int,
  dribbles_succeeded  int,
  dribbled_past       int,
  fouls_drawn         int,
  fouls_committed     int,
  yellow_cards        int,
  red_cards           int,
  penalties_won       int,
  penalties_committed int,                   -- API typo: penalty.commited
  penalties_scored    int,
  penalties_missed    int,
  penalties_saved     int,
  unique (match_id, player_id)
);

create index player_match_stats_season_player_idx on player_match_stats (season, player_id);
create index player_match_stats_match_idx on player_match_stats (match_id);

create table match_events (
  id            bigserial primary key,
  match_id      bigint not null references matches (id),
  season        int    not null,
  order_index   int    not null,             -- API array order (stable within minute)
  elapsed       int,
  elapsed_extra int,                          -- shootout kicks: elapsed=120 + extra
  team_id       bigint references teams (id),
  player_id     bigint,                       -- occasionally null in API; no FK (may miss profile)
  player_name   text,
  assist_id     bigint,                       -- doubles as sub-on player for 'subst'
  assist_name   text,
  type          text,                         -- Goal | Card | subst | Var
  detail        text,
  comments      text                          -- 'Penalty Shootout' marks shootout kicks
);

create index match_events_match_idx on match_events (match_id, order_index);

create table match_lineups (
  match_id   bigint not null references matches (id),
  team_id    bigint not null references teams (id),
  season     int    not null,
  formation  text,
  coach_id   bigint,
  coach_name text,
  primary key (match_id, team_id)
);

create table match_lineup_players (
  id           bigserial primary key,
  match_id     bigint not null references matches (id),
  team_id      bigint not null references teams (id),
  season       int    not null,
  player_id    bigint,                        -- no FK: lineup may include players without profiles
  player_name  text,
  shirt_number int,
  position     text,                          -- G / D / M / F
  grid         text,                          -- 'row:col', null for subs
  starter      boolean not null,
  unique (match_id, team_id, player_id)
);

create index match_lineup_players_match_idx on match_lineup_players (match_id);

-- ── stored API copies (cross-check against computed values) ─────────────────

create table standings (
  season        int    not null,
  team_id       bigint not null references teams (id),
  rank          int,
  group_name    text,                         -- 'Group A'
  points        int,
  goals_diff    int,
  form          text,                         -- 'WDW'
  description   text,
  played        int,
  won           int,
  drawn         int,
  lost          int,
  goals_for     int,
  goals_against int,
  updated_at    timestamptz,
  primary key (season, team_id)
);

create table player_season_stats (
  player_id           bigint not null references players (id),
  season              int    not null,
  team_id             bigint references teams (id),
  position            text,                   -- 'Goalkeeper' | 'Defender' | ...
  appearances         int,                    -- API 'appearences' (sic)
  lineups             int,
  minutes             int,
  rating              double precision,
  captain             boolean,
  subs_in             int,
  subs_out            int,
  bench               int,
  shots               int,
  shots_on_target     int,
  goals               int,
  goals_conceded      int,
  assists             int,
  saves               int,
  passes              int,
  key_passes          int,
  pass_accuracy       double precision,
  tackles             int,
  blocks              int,
  interceptions       int,
  duels               int,
  duels_won           int,
  dribbles_attempted  int,
  dribbles_succeeded  int,
  dribbled_past       int,
  fouls_drawn         int,
  fouls_committed     int,
  yellow_cards        int,
  yellowred_cards     int,
  red_cards           int,
  penalties_won       int,
  penalties_committed int,
  penalties_scored    int,
  penalties_missed    int,
  penalties_saved     int,
  primary key (player_id, season)
);

create index player_season_stats_season_idx on player_season_stats (season);

-- ── track 3: derived analytics ───────────────────────────────────────────────

create table team_form (
  id             bigserial primary key,
  team_id        bigint not null references teams (id),
  season         int    not null,
  as_of_date     date   not null,
  overall_form   double precision not null,
  attacking_form double precision not null,
  defending_form double precision not null,
  elo            double precision not null,
  sample_size    int not null,
  unique (team_id, season, as_of_date)
);

create index team_form_season_team_idx on team_form (season, team_id, as_of_date);

create table predictions (
  id                   bigserial primary key,
  match_id             bigint not null references matches (id),
  season               int    not null,
  home_win_prob        double precision not null,
  draw_prob            double precision not null,
  away_win_prob        double precision not null,
  predicted_home_goals double precision,
  predicted_away_goals double precision,
  upset_probability    double precision not null,
  model_version        text not null,
  generated_at         timestamptz not null default now()
);

create index predictions_match_idx on predictions (match_id, generated_at);

-- ── RLS: anon may read everything; writes only via service key ──────────────

do $$
declare t text;
begin
  foreach t in array array[
    'teams','team_seasons','players','matches','match_snapshots',
    'team_match_stats','player_match_stats','match_events',
    'match_lineups','match_lineup_players','standings',
    'player_season_stats','team_form','predictions'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "public read %s" on %I for select using (true)', t, t);
  end loop;
end $$;
