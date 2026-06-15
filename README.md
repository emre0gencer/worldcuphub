# World Cup HUB

A read-only data platform and web app for the FIFA World Cup — currently running **live against the 2026 tournament**, with a fully-functional **2022 demo** available via `?season=2022`.

The project's core thesis: don't just display data from an API — *own* it. Every match, player stat, team metric, and derived score is ingested into a private database, processed by a custom analytics layer, and surfaced through a purpose-built frontend. The result is an end-to-end data product, not a widget wrapper.

---

## What it does

### Data ingestion pipeline (Python worker)

A season-parameterized Python backend pulls data from [API-Football Pro](https://api-sports.io) and writes it into a Supabase Postgres database. Two modes:

- **Backfill** (`backfill.py`) — full historical ingestion for a completed season. Batches fixture calls (~20 per request) to stay within API quota. Run: `python -m worldcup_worker.backfill --season 2022`
- **Live ingestion** (`ingest.py`) — a long-running poll loop for the 2026 tournament. Discovers live matches infrequently (~300s), then polls only those matches every 60s. Stores the full time-series of raw snapshots per match to power momentum charts. Live polls are batched: all active matches are fetched in a single `/fixtures?ids=` call per cycle, so quota usage stays flat regardless of how many matches run simultaneously.

The finalize step runs at full-time, promoting the last clean snapshot into the permanent stats tables — separating volatile live data from the immutable record. A catch-up pass runs on every discovery cycle to re-finalize any match that slipped through due to a worker restart (the in-memory `tracked_live` set is empty on startup, so matches that ended during downtime are detected by querying for `finished` rows with no `team_match_stats` and finalized automatically).

### Three-track schema

The database design reflects how data changes over time:

| Track | Tables | Lifetime |
|---|---|---|
| Reference | `teams`, `players`, `matches` | Seeded once per tournament |
| Volatile live (Track 1) | `match_snapshots` | Full time-series kept per match |
| Immutable stats (Track 2) | `team_match_stats`, `player_match_stats` | Written once at full-time, never updated |
| Derived analytics (Track 3) | `team_form`, `predictions` | Recomputed per matchday, history kept |

Every table carries a `season` column — `season=2022` and `season=2026` coexist in one schema.

### Form Score — custom analytics model

The analytics job (`analytics.py`) computes a **Form Score** for every team after each matchday. It is not a raw stats average — it is opponent-adjusted, recency-weighted, shrinkage-corrected, and finally re-normalized across the field.

**Which model runs is chosen by data availability, not season number** (`run()` sets `use_xg` from whether any `team_match_stats` row carries `xg`):

- **`baseline-v2-noxg`** — 2022, where API-Football returns no xG (verified in Phase-1 discovery). The xG terms are scratched and reweighted onto goals / shots on target / shots.
- **`baseline-v3-xg`** — 2026+, where API-Football returns `expected_goals` and `goals_prevented`. xG-based signals dominate the composites (xG is the strongest single predictor of future performance — xG ≈ 0.91 correlation with goals; xGD is the most predictive composite for match outcomes).

#### The math, step by step

**Notation** — for team `T` in a match vs opponent `OPP`: `T.xg`, `T.goals_for`, `T.shots_on_target`, `T.shots`, `T.corners`, `T.pass_accuracy`, `T.goals_prevented` come from `T`'s own stat row; **defensive facts come from the opponent's row of the same match** (`OPP.xg` = T's expected goals against, `OPP.goals_for` = T's goals against). This join is consistency-checked (`opponent.goals_for == team.goals_against`).

**Step 1 — Rolling opponent baselines.** For each baseline stat (`{goals_for, shots_on_target, shots}`, plus `xg` when available), compute, *from each opponent's matches prior to this one*, the mean it **creates** (`_F`) and **allows** (`_A`). Matchday-1 fallback: tournament global mean seeded with an Elo-implied prior (`±10%` output per 100 Elo vs the 1500 base).

**Step 2 — Opponent-adjusted per-match performance.**

```
adjA_xg    = T.xg              - xg_A(OPP)            # chance quality created vs what OPP allows  (xG model)
adjA_goals = T.goals_for       - goals_for_A(OPP)
adjA_sot   = T.shots_on_target - shots_on_target_A(OPP)
adjA_shots = T.shots           - shots_A(OPP)
adjD_xg    = xg_F(OPP)         - OPP.xg              # chance quality suppressed                  (xG model)
adjD_goals = goals_for_F(OPP)  - OPP.goals_for
adjD_sot   = shots_on_target_F(OPP) - OPP.shots_on_target
adjD_shots = shots_F(OPP)      - OPP.shots
finishing_delta = T.goals_for  - T.xg               # clinical (+) / wasteful (−) finishing      (xG model)
goals_prevented = T.goals_prevented                 # defensive overperformance from the API     (xG model)
```

**Step 3 — Z-score normalization** of every series above across all team-match rows in the season so far, so each signal is on a comparable scale.

**Step 4 — Per-match composites** (weights sum to 1.0):

```
# baseline-v3-xg (2026)
A(m) = 0.35·z(adjA_xg) + 0.20·z(adjA_goals) + 0.15·z(adjA_sot) + 0.10·z(adjA_shots)
     + 0.10·z(finishing_delta) + 0.05·z(corners) + 0.05·z(pass_accuracy)
D(m) = 0.30·z(adjD_xg) + 0.25·z(adjD_goals) + 0.20·z(goals_prevented)
     + 0.15·z(adjD_sot) + 0.10·z(adjD_shots)

# baseline-v2-noxg (2022)
A(m) = 0.40·z(adjA_goals) + 0.30·z(adjA_sot) + 0.20·z(adjA_shots) + 0.05·z(corners) + 0.05·z(pass_accuracy)
D(m) = 0.45·z(adjD_goals) + 0.35·z(adjD_sot) + 0.20·z(adjD_shots)
```

**Step 5 — Recency weighting** — exponential decay `w_i = ρ^(n−i)`, `ρ = 0.7`, so the newest match dominates: `AttackForm = Σ wᵢ·A(mᵢ) / Σ wᵢ` (and likewise `DefendForm`).

**Step 6 — Confidence shrinkage** — `shrink = n/(n+2)`; `AttackForm` and `DefendForm` are multiplied by it so few-match teams stay near the mean. `sample_size` is surfaced in the UI when n < 3.

**Step 7 — Display normalization (0–100).** `OverallForm = 0.5·AttackForm + 0.5·DefendForm`. Because the per-match composites are already z-scores, shrinkage + the attack/defend average compress the *team-level* spread into a narrow band early on (everyone ≈47–54 after one matchday). So each team's final attack / defend / overall value is **re-z-scored across the field** (using the teams that have actually played as the reference distribution) before the display map `clamp(50 + 15·z, 0, 100)`. Result: tournament average = 50, +1 std ≈ 65, +2 std ≈ 80, with a legible spread instead of a flat band. (The `baseline-v2-noxg` path keeps the original direct map `clamp(50 + 15·overall, 0, 100)` so the 2022 demo is unchanged.)

A **baseline upset probability model** sits on top:

```
# baseline-v2-noxg
p_favorite = sigmoid(1.0·ΔElo/400 + 0.5·ΔOverallForm)
# baseline-v3-xg — adds cumulative xG difference (xG − xGA) per match
p_favorite = sigmoid(0.8·ΔElo/400 + 0.4·ΔOverallForm + 0.3·ΔxGD)
```

Deltas are taken favorite-minus-underdog (favorite = higher Elo). Coefficients calibrate against results as the tournament runs; the active `model_version` is stored on every prediction.

### Frontend pages (Next.js)

All pages resolve a `?season=` param via a `SeasonSwitcher` in the nav — the same URL structure serves both 2022 and 2026.

- **Home** — match cards grouped by stage with live/finished/upcoming states and score display.
- **Match detail** (`/matches/[id]`) — three states:
  - *Scheduled* → pre-match H2H comparison, FIFA rankings, form ratings, prior meetings.
  - *Live* → real-time stats from the latest snapshot; per-minute momentum charts (shots, shots on target) from the full snapshot series; auto-refreshes every 60s.
  - *Finished* → full final stats, timeline of goals/cards/substitutions, starting lineups with formations, per-player ratings sorted by rating (unrated players at the bottom).
- **Standings** (`/standings`) — all group tables computed from owned match results (P/W/D/L/GD/Pts/form). In-progress matches are folded in as provisional results: teams currently playing are highlighted in red with a live indicator, and the cross-check against the stored API standings skips them (stored standings lag live scores). The cross-check flags genuine data discrepancies (points, GD, played) but not rank differences, which are expected when teams are tied and FIFA applies head-to-head tiebreakers not implemented locally. Knockout bracket with results.
- **Players** (`/players`) — leaderboards built from granular `player_match_stats` rows: top scorers, top assists, best ratings, yellow/red cards.
- **Rankings** (`/rankings`) — Form Score table with attacking/defending sub-rankings, trend charts from `team_form` history, and upset probability column.

### Display enrichment via API-Sports widgets

For pages where a rich visual widget adds value (live match stats, H2H, standings), official [API-Sports v3.1.0 widgets](https://api-sports.io/documentation/widgets) render client-side. These are **display-only** and never replace the ingested data — the underlying Supabase-backed views and computation always exist. Widget rendering is gated by `NEXT_PUBLIC_API_FOOTBALL_WIDGET_KEY`; when unset, every page falls back to the custom frontend.

---

## Architecture

Two runtimes. One contract. No direct HTTP between them.

```
Python worker (Railway)          Supabase Postgres            Next.js (Vercel)
────────────────────────         ─────────────────            ────────────────
backfill / live ingest  ──────▶  reference + snapshots  ◀──── reads, renders
analytics batch job     ──────▶  stats + form + predictions ◀─ reads, renders
```

- **Next.js** only ever reads from Supabase via the anon key. It does not know the Python worker exists.
- **Python** owns all writes via the service-role key.
- **RLS**: anon may SELECT everything; writes are service-key only.
- No auth. No user-generated content. Fully read-only web surface.

**Stack:** Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 · recharts · Supabase Postgres · Python 3 (httpx, supabase-py) · API-Football Pro

---

## Current state — 2026 live + 2022 demo

The platform is live against the 2026 FIFA World Cup group stage:

- 72 fixtures across 12 groups (A–L), 48 teams, 415 players ingested.
- Live ingestion worker running on Railway: discovers live matches every ~300s, polls them every 60s, writes a full snapshot time-series per match.
- Finished matches fully finalized: team stats, player stats, events, lineups all written to Track 2. Catch-up finalization on every discovery cycle ensures no match is missed after a worker restart.
- Group standings updated in real time, including in-progress match scores as provisional results.
- Form Scores computed under `baseline-v3-xg` (xG + goals_prevented available from API-Football for 2026).
- Player names resolved from the API payload at ingestion time; stub profiles (`Player {id}`) are no longer written for players missing from the `/players` endpoint.

The 2022 demo remains fully functional at `?season=2022`:

- 64 matches ingested through Argentina–France in the final.
- 833 players with per-match granular stats.
- Form Scores computed under `baseline-v2-noxg`.
- Group standings, knockout bracket, match timelines, lineups, and player leaderboards all served from owned data.

---

## Future directions

**Trained prediction model** — the current upset model is a calibrated sigmoid over Elo delta and Form Score delta. Once enough 2026 match results accumulate, this can be replaced with a Poisson regression or gradient-boosted model, gated behind the `model_version` column with no breaking changes to the frontend.

**Per-minute stat normalization** — red cards and extra time distort per-match totals. Normalizing stats by minutes played is the most impactful data-quality improvement as the 2026 tournament progresses.

**YouTube highlights integration** — the `matches` table has a `youtube_highlight_id` column ready. Surfacing post-match highlights on the match detail page is a single-component addition.

**ML-grade player performance index** — `player_match_stats` rows accumulate into a per-player time-series across the tournament. A composite player rating beyond the API-provided match rating (e.g. combining goals, assists, key passes, tackles, and rating into a normalized index) would make the leaderboards significantly more informative.

---

## Local development

```bash
# Frontend
cp .env.local.example .env.local   # fill in NEXT_PUBLIC_SUPABASE_URL + ANON_KEY
npm install
npm run dev

# Python worker
cd worker
pip install -r requirements.txt
cp .env.example .env               # fill in API_FOOTBALL_KEY + SUPABASE_URL + SERVICE_KEY

python -m worldcup_worker.backfill --season 2022    # ingest full 2022 dataset
python -m worldcup_worker.analytics --season 2022   # compute Form Scores + predictions
```

For 2026 live ingestion:
```bash
python -m worldcup_worker.ingest    # long-running poll loop; discovers + tracks live matches
```
