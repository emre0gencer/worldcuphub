-- 0003_add_xg_columns.sql
-- API-Football began returning expected_goals + goals_prevented in the team
-- statistics for league=1/season=2026 (absent for 2022 — verified in Phase-1
-- discovery). Store them so the 2026 Form Score (baseline-v3-xg) can use them.
-- Both columns are NULLABLE: 2022 rows have no xG data and must stay valid.

alter table team_match_stats
  add column xg              double precision,   -- API stat type 'expected_goals'
  add column goals_prevented double precision;   -- API stat type 'goals_prevented'
