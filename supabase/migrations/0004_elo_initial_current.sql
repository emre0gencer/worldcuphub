-- 0004_elo_initial_current.sql
-- Extends team_seasons with two new columns for the FIFA-Elo seeding introduced
-- in 2026. Both are nullable so 2022 rows stay valid with no data migration.
--
--   initial_elo  — frozen pre-tournament Elo seed (set once by seed_elo.py,
--                  never overwritten by the live elo.py replay loop).
--   fifa_points  — raw FIFA ranking points from the official table at tournament
--                  start; stored for display purposes alongside initial_elo.
--
-- The existing `elo` column is kept as the live current Elo and is the only
-- column that elo.py writes to on each analytics run.

alter table team_seasons
  add column if not exists initial_elo  double precision,
  add column if not exists fifa_points  double precision;
