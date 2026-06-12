# World Cup HUB

A read-only data platform and web app for the FIFA World Cup — currently running as a fully-functional **2022 demo**, built to serve **2026 live data** with zero code changes.

The project's core thesis: don't just display data from an API — *own* it. Every match, player stat, team metric, and derived score is ingested into a private database, processed by a custom analytics layer, and surfaced through a purpose-built frontend. The result is an end-to-end data product, not a widget wrapper.

---

## What it does

### Data ingestion pipeline (Python worker)

A season-parameterized Python backend pulls data from [API-Football Pro](https://api-sports.io) and writes it into a Supabase Postgres database. Two modes:

- **Backfill** (`backfill.py`) — full historical ingestion for a completed season. Batches fixture calls (~20 per request) to stay within API quota. Run: `python -m worldcup_worker.backfill --season 2022`
- **Live ingestion** (`ingest.py`) — a long-running poll loop for the 2026 tournament. Discovers live matches infrequently (~300s), then polls only those matches every 60s. Stores the full time-series of raw snapshots per match to power momentum charts.

The finalize step runs at full-time, promoting the last clean snapshot into the permanent stats tables — separating volatile live data from the immutable record.

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

The analytics job (`analytics.py`) computes a **Form Score** for every team after each matchday. It is not a raw stats average — it is opponent-adjusted, recency-weighted, and shrinkage-corrected:

1. **Opponent baselines** — rolling averages of what each opponent typically allows/creates (so beating a strong defense counts more than beating a weak one). Matchday-1 uses Elo-implied priors.
2. **Opponent-adjusted per-match performance** — how far above or below each team's own output landed relative to the opponent's baseline.
3. **Z-score normalization** — across all team-match rows so far, so scores are relative to the tournament field.
4. **Weighted composites** — attacking and defending composites from goals, shots on target, shots, corners, and pass accuracy (xG omitted: API-Football does not provide xG for World Cup fixtures, verified against real data).
5. **Recency weighting** — exponential decay (rho=0.7), so recent matches dominate.
6. **Confidence shrinkage** — scores are pulled toward zero when sample size is small (n/(n+2)), with `sample_size` surfaced in the UI when n < 3.
7. **Display scale** — mapped to a 0–100 scale where 50 = tournament average, ±1 std ≈ ±15 points.

A **baseline upset probability model** sits on top: `p_favorite = sigmoid(a·ΔElo/400 + b·ΔOverallForm)`. Coefficients calibrate against results as the tournament runs.

### Frontend pages (Next.js)

All pages resolve a `?season=` param via a `SeasonSwitcher` in the nav — the same URL structure serves both 2022 and 2026.

- **Home** — match cards grouped by stage with live/finished/upcoming states and score display.
- **Match detail** (`/matches/[id]`) — three states:
  - *Scheduled* → pre-match H2H comparison, FIFA rankings, form ratings, prior meetings.
  - *Live* → real-time stats from the latest snapshot; momentum charts from the full snapshot series.
  - *Finished* → full final stats, timeline of goals/cards/substitutions, starting lineups with formations, per-player ratings.
- **Standings** (`/standings`) — all 8 group tables computed from owned match results (P/W/D/L/GD/Pts/form), cross-checked against the API's stored standings with discrepancy reporting. Knockout bracket with results.
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

## Current state — 2022 demo

The platform is fully functional against the completed 2022 FIFA World Cup:

- 64 matches ingested, including the full knockout bracket through Argentina–France in the final.
- 833 players with per-match granular stats.
- Group standings computed and cross-checked clean against API standings.
- Form Scores computed for all 32 teams across the tournament.
- Match detail pages with timeline, lineups, and stats for every finished game.
- Player leaderboards driven entirely by owned data.

---

## Future directions

**2026 live tournament** — the immediate next step. The ingestion pipeline, analytics job, schema, and all frontend pages are already parameterized for `season=2026`. Pointing the live worker at the 2026 fixtures and deploying is the only required action. No new code paths.

**Trained prediction model** — the current upset model is a calibrated sigmoid over Elo delta and Form Score delta. Once enough 2026 match results accumulate, this can be replaced with a Poisson regression or gradient-boosted model, gated behind the `model_version` column with no breaking changes to the frontend.

**Per-minute stat normalization** — red cards and extra time distort per-match totals. Normalizing stats by minutes played is the most impactful data-quality improvement after 2026 data begins arriving.

**Live momentum charts** — the full snapshot time-series is already stored in `match_snapshots`. Rendering per-minute momentum visualizations from this series (possession swings, shot bursts, pressure periods) requires only a frontend chart component.

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

---
