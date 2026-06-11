# World Cup HUB — Project Specification

A read-only web app and data platform for the 2026 FIFA World Cup (June 11 – July 19, 2026). It surfaces upcoming/live/finished matches with rich stats, accumulates a per-team and per-player dataset as the tournament unfolds, and derives Form Scores, rankings, and match predictions from that data.

This document is the single source of truth for the build. Every decision below is locked. Anything not specified here (component breakdown, chart library, migration DDL, exact implementation of the poller/finalize step, styling specifics, mock-data seeding) is intentionally left to implementation.

---

## 1. Goals

- A useful HUB for football fans during the World Cup.
- A portfolio piece combining software engineering, data science, and (later) ML.
- Clean, minimal, typographic design — FotMob as a **structural/content** reference, not a visual clone.

---

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS |
| Frontend host | Vercel |
| Backend language | Python (ingestion worker + analytics/ML batch jobs) |
| Backend host | Railway (long-running worker + scheduled cron on one service) |
| Database + contract layer | Supabase (Postgres) |
| Data provider | API-Football **Pro** (~$19/mo) |
| xG | Taken directly from API-Football. **Not** self-computed. |
| Advanced metrics (other than xG) | Computed from raw stats in the Python layer |
| Auth / users | **None.** Fully read-only. No accounts, no user-generated content. |
| Highlights (YouTube) | **Deferred** — not in initial build |
| ML | **Deferred.** Start with a transparent statistical model; layer ML in once data accrues (gated by the `model_version` column) |
| Design reference | FotMob (structure/content), skinned in own minimal style |

---

## 3. Architecture

Two runtimes, three hosted services. **The languages never talk to each other directly — Supabase Postgres is the only contract.**

```
Python (Railway)                         Supabase Postgres            Next.js (Vercel)
─────────────────                        ─────────────────            ─────────────────
live ingestion worker  ── writes ─────▶  reference + live + stats  ◀── reads, renders
analytics/ML batch     ── reads ──────▶  (Tracks 1 & 2)
                       ── writes ─────▶  form + predictions (Track 3) ◀── reads, renders
```

- **Next.js only ever reads** from Supabase. It does not know Python exists.
- **Python owns all writes** to stats, form, and predictions.
- No service-to-service HTTP. Each side deploys and debugs independently.

### Two backend cadences

1. **Live ingestion — every ~60s, only while matches are live.** A long-running worker loop (NOT a cron job). Status-driven: poll the fixtures list infrequently to discover which matches just went live, then poll only *those* matches every 60s. With the Pro tier and ≤4 simultaneous matches, request volume stays well within the daily budget.
2. **Analytics + ML — batch, a few times per matchday.** Scheduled job. Reads accumulated stats, recomputes Form Scores, runs the model, writes predictions.

---

## 4. Database schema (three tracks)

The core design principle: **separate volatile live data from the permanent, append-only dataset.** Live snapshots churn; finalized stats never change once written.

### Reference tables (seeded once)

**`teams`**
`id` (API team id) · `name` · `country_code` · `flag_url` · `fifa_ranking` · `elo` (maintained internally) · `group_letter`

**`players`**
`id` (API player id) · `team_id` → teams · `name` · `position` · `shirt_number` · `photo_url` · `age`

**`matches`** (all 104 fixtures, seeded from schedule up front)
`id` (API fixture id) · `home_team_id` → teams · `away_team_id` → teams · `kickoff_at` · `venue` · `stage` (group/R32/R16/QF/SF/final) · `group_letter` · `status` (scheduled/live/finished) · `home_score` · `away_score` · `youtube_highlight_id` (nullable, deferred feature)

### Track 1 — Volatile live data

**`match_snapshots`** (written every poll while live; read by live page + momentum charts)
`id` · `match_id` → matches · `captured_at` · `elapsed_minute` · `payload` (JSONB — raw live stats blob)

Keep the full time-series (not just latest) to enable momentum graphs.

### Track 2 — Permanent dataset (written once at full-time; immutable)

**`team_match_stats`** (2 rows per match)
`id` · `match_id` → matches · `team_id` → teams · `possession` · `shots` · `shots_on_target` · `corners` · `fouls` · `passes` · `pass_accuracy` · `xg` (from API-Football) · `goals_for` · `goals_against`

**`player_match_stats`** (~28–30 rows per match)
`id` · `match_id` → matches · `player_id` → players · `team_id` → teams · `minutes` · `goals` · `assists` · `shots` · `key_passes` · `tackles` · `rating`

A **finalize step** copies the last good snapshot into these tables when a match flips to `finished`. This is the data-science dataset.

### Track 3 — Derived analytics (recomputed per matchday)

**`team_form`** (one new row per team per matchday — keeps history for trend charts)
`id` · `team_id` → teams · `as_of_date` · `overall_form` · `attacking_form` · `defending_form` · `elo` · `sample_size`

**`predictions`**
`id` · `match_id` → matches · `home_win_prob` · `draw_prob` · `away_win_prob` · `predicted_home_goals` · `predicted_away_goals` · `upset_probability` · `model_version` · `generated_at`

> **Join note for analytics:** a team's *defending* stats for a match come from the **opponent's row** of the same match (join on `match_id`). `opponent.goals_for` should equal `team.goals_against` — use as a consistency check.

---

## 5. Form Score — exact computation

Computed in the Python analytics job after each matchday, against the `team_match_stats` columns. Opponent strength is baked into the **baseline** (subtraction), not applied as a multiplier.

### Step 1 — Rolling opponent baselines (over matches *prior to* the one being scored)
```
xGA_allowed(team), xGF_created(team)
sotA_allowed, shotsA_allowed, goalsA_allowed     # conceded
sotF_created, shotsF_created, goalsF_created      # created
```
Matchday 1: fall back to tournament global mean, seeded with an Elo-implied prior.

### Step 2 — Opponent-adjusted per-match performance
```
# Attacking over/under-performance for team T vs opponent OPP
adjA_xg    = T.xg              - xGA_allowed(OPP)
adjA_goals = T.goals_for       - goalsA_allowed(OPP)
adjA_sot   = T.shots_on_target - sotA_allowed(OPP)
adjA_shots = T.shots           - shotsA_allowed(OPP)

# Defending: how far below the opponent's usual output T held them (sign flipped so higher = better)
adjD_xg    = xGF_created(OPP)    - OPP.xg
adjD_goals = goalsF_created(OPP) - OPP.goals_for
adjD_sot   = sotF_created(OPP)   - OPP.shots_on_target
adjD_shots = shotsF_created(OPP) - OPP.shots
```
`possession`, `corners`, `pass_accuracy` stay raw (lightly weighted style/territory signals), not opponent-adjusted.

### Step 3 — Normalization (z-score each series across all team-match rows so far)
```
z(x) = (x - mean(x)) / std(x)
```

### Step 4 — Per-match composites (weights sum to 1 within each; tunable)
```
A(m) = 0.35·z(adjA_xg) + 0.25·z(adjA_goals) + 0.20·z(adjA_sot)
     + 0.10·z(adjA_shots) + 0.05·z(corners) + 0.05·z(pass_accuracy)

D(m) = 0.40·z(adjD_xg) + 0.30·z(adjD_goals) + 0.20·z(adjD_sot) + 0.10·z(adjD_shots)
```

### Step 5 — Recency weighting (exponential, oldest→newest i = 1…n)
```
w_i = rho^(n - i)         # rho = 0.7 start; newest match weight = 1

AttackForm = Σ w_i·A(m_i) / Σ w_i
DefendForm = Σ w_i·D(m_i) / Σ w_i
```

### Step 6 — Confidence shrinkage (toward zero by sample size; k = 2 pseudo-count)
```
shrink = n / (n + k)
AttackForm_final = shrink · AttackForm
DefendForm_final = shrink · DefendForm
```
Store `n` as `sample_size`.

### Step 7 — Overall + display mapping
```
OverallForm = 0.5·AttackForm_final + 0.5·DefendForm_final

display = clamp(50 + 15·form_z, 0, 100)     # average team = 50, +1 std ≈ 65
```
Write `overall_form`, `attacking_form`, `defending_form`, `elo`, `sample_size` to a fresh `team_form` row per matchday.

### Bonus — upset probability (this is the first statistical model)
```
p_favorite = sigmoid( a·(ΔElo / 400) + b·ΔOverallForm )
upset_prob = 1 - p_favorite
```
Calibrate `a`, `b` against actual results as the tournament unfolds. Later swap for a trained Poisson/ML model via `model_version`.

---

## 6. Frontend pages

- **Home** — scrollable horizontal cards of upcoming matches (X vs Y with flags), each clickable.
- **Match page** `/matches/[id]` — behavior depends on `status`:
  - `scheduled` → pre-match head-to-head comparison, FIFA rankings, form, prior meetings.
  - `live` → live stats from the latest snapshot; momentum charts from the snapshot series.
  - `finished` → full final stats + player ratings. (Highlights section deferred.)
- **Rankings / Form** — overall Form ranking plus sub-rankings: attacking form, defending form, upset probabilities. Trend charts from `team_form` history.
- Interactive visuals/graphs integrated throughout where relevant.

---

## 7. Known limitations (acknowledge in the project writeup)

- Matchday-1 baselines lean on priors; Form Scores are noisy until ~3+ matches (handled by shrinkage + `sample_size` indicator in UI).
- Red cards / extra time distort per-match totals; per-minute normalization is a natural later upgrade.
- xG reliability depends on what API-Football Pro actually returns per fixture; verify coverage early.
- Live ingestion can only be fully validated during an actual live match.

---

## 8. Environment variables (names only — never commit values)

```
API_FOOTBALL_KEY=
NEXT_PUBLIC_SUPABASE_URL=https://wrrkiuxiimipcaznkkqx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
```
Frontend uses the URL + anon key. Python worker uses the URL + service key. Store in `.env.local` (gitignored) and in Vercel/Railway env settings.

---

## 9. Suggested build order

1. Supabase schema + migrations (all tables above).
2. Seed reference data: 48 teams, 104 matches, squads.
3. Frontend: home (match list) + match page shells reading from Supabase.
4. Python live ingestion worker (Track 1) + finalize step (Track 2).
5. Python analytics job: Form Scores (Track 3) + statistical upset model.
6. Rankings/form pages + interactive charts.
7. (Deferred) YouTube highlights, trained ML model.

Ship match pages first (valuable from day one); build the data-science layer in parallel so it's ready once enough matches accrue.
