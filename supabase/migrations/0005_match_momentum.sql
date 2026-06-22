-- 0005_match_momentum.sql
-- Reconstructed in-play momentum for matches that were never live-ingested.
-- The ingest worker crash-looped before most 2026 kickoffs (negative time.sleep
-- in the smart-idle branch), so match_snapshots is empty for ~36/40 finished
-- matches. The immutable final stats were recovered by backfill; only the
-- per-minute progression behind the momentum charts was lost, and API-Football
-- exposes no historical per-minute endpoint to re-pull it.
--
-- This table holds REAL per-team, per-minute cumulative series rebuilt from
-- ESPN's open match-commentary feed: every shot / corner / foul is a discrete,
-- timestamped, team-attributed event, and the parsed counts cross-check exactly
-- against ESPN's final boxscore. Only metrics ESPN reports as discrete events
-- are stored — total_shots, shots_on_target, corners, fouls. xG and passes are
-- intentionally omitted: ESPN has no per-event source for them, so any per-minute
-- series would be estimation, not real data.
--
-- One row per (match_id, metric). `points` is the cumulative MomentumPoint[]
-- ([{"minute":int,"home":int,"away":int}, ...]) consumed directly by the chart.
-- The frontend uses this ONLY as a fallback when match_snapshots is empty.

create table match_momentum (
  match_id     bigint      not null references matches(id) on delete cascade,
  season       integer     not null,
  metric       text        not null,   -- total_shots | shots_on_target | corners | fouls
  source       text        not null default 'espn-commentary',
  points       jsonb       not null,   -- [{"minute":int,"home":int,"away":int}, ...]
  generated_at timestamptz not null default now(),
  primary key (match_id, metric)
);

alter table match_momentum enable row level security;
create policy "public read" on match_momentum for select using (true);
