-- 0006_elo_history.sql
-- Per-match Elo trajectory (Track 3, derived). One row per team per finished
-- match, written by worker/worldcup_worker/elo.py on every replay.
--
-- Why: team_seasons.elo only holds the CURRENT rating, and team_form.elo was
-- only snapshotted on the days the analytics job happened to run. Live ingestion
-- did not witness every match (worker outages, ESPN-recovered games), so the
-- rating history had gaps. elo.py replays from the frozen FIFA seed
-- (team_seasons.initial_elo) over every finished match in kickoff order and
-- records each step here, which makes the trajectory exactly what a worker
-- running at every final whistle would have produced. Idempotent: the season's
-- rows are deleted and re-inserted on each replay.

create table if not exists team_elo_history (
  season       int              not null,
  match_id     bigint           not null references matches (id) on delete cascade,
  team_id      bigint           not null references teams (id),
  opponent_id  bigint           references teams (id),
  kickoff_at   timestamptz,
  stage        text             not null,
  seq          int              not null,   -- 1-based replay order within the season
  elo_before   double precision not null,
  elo_after    double precision not null,
  delta        double precision not null,
  expected     double precision not null,   -- W_e (FIFA 2018 formula, scale 600)
  result       double precision not null,   -- W: 1 / 0.5 / 0, shootout 0.75 / 0.5
  importance   int              not null,   -- I: 50 group/R32/R16, 60 QF+
  primary key (match_id, team_id)
);

create index if not exists team_elo_history_season_team_idx
  on team_elo_history (season, team_id, seq);

alter table team_elo_history enable row level security;
create policy "public read team_elo_history" on team_elo_history for select using (true);
