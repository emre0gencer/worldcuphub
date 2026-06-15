@AGENTS.md

# World Cup HUB

Read-only web app + data platform for the 2026 FIFA World Cup. **PROJECT_SPEC.md is the single source of truth**, with **PROJECT_SPEC_2.md (2022 demo phase) overriding it where they differ** — all decisions there are locked; do not re-derive them.

## Stack & architecture

- **Frontend**: Next.js 16 (App Router, Turbopack), TypeScript, Tailwind v4, recharts. Deploys to Vercel. **Only ever reads** from Supabase via the anon key.
- **Backend**: Python 3 in `worker/` (httpx, supabase-py). Deploys to Railway. **Owns all writes** via the service-role key.
- **Contract layer**: Supabase Postgres. The two runtimes never talk to each other directly — the database is the only contract. No service-to-service HTTP.
- **Data provider**: API-Football Pro. xG is taken from the API, never self-computed.
- No auth, no users, no user-generated content.

## Three-track schema (`supabase/migrations/`)

- **Reference**: `teams`, `players`, `matches` (all 104 fixtures up front; knockout team ids nullable until pairings are known).
- **Track 1 (volatile)**: `match_snapshots` — one JSONB row per live poll, full time-series kept for momentum charts. Payload is the raw API-Football shape (`fixture`/`goals`/`statistics`).
- **Track 2 (immutable)**: `team_match_stats` (2 rows/match), `player_match_stats` — written once by the finalize step at full-time, never updated.
- **Track 3 (derived)**: `team_form` (one row per team per matchday — history kept), `predictions` (history kept via `generated_at`; gated by `model_version`).
- RLS: anon may SELECT everything; writes only via service key.

## Key files

- `worker/worldcup_worker/ingest.py` — long-running live poll loop (60s per live match, ~300s fixture discovery) + finalize step. Run: `python -m worldcup_worker.ingest`
- `worker/worldcup_worker/analytics.py` — Form Score math (spec §5, steps 1–7 implemented exactly) + baseline upset model. Pure functions over dict rows; the Supabase-backed job is `run()`. Calls `elo.run(season)` first to update live Elo before computing form. Run: `python -m worldcup_worker.analytics`
- `worker/worldcup_worker/elo.py` — Idempotent Elo replay (FIFA 2018 formula, scale 600): always replays from `initial_elo` over all finished matches sorted by `kickoff_at`, writes result to `team_seasons.elo`. 2026-only (no-op when `initial_elo` is NULL). Run: `python -m worldcup_worker.elo`
- `worker/worldcup_worker/seed_elo.py` — Seeds `initial_elo`, `fifa_points`, and `elo` from `fifa_points_2026.py` for all teams in a season. Matches by `country_code` first, then name (with aliases). Unmatched teams get 1500 with a named warning. Run once after backfill: `python -m worldcup_worker.seed_elo --season 2026`
- `worker/worldcup_worker/fifa_points_2026.py` — Static reference: 85-team FIFA Elo ranking as of 2026-06-15 (official update 2026-06-11). Used by seed_elo.py; update here if rankings are re-pulled.
- `worker/worldcup_worker/backfill.py` — full-season ingestion (`python -m worldcup_worker.backfill --season 2022 [--force]`); shares `pipeline.py` building blocks with the live finalize step.
- `lib/queries.ts` — all frontend Supabase reads (season-parameterized); `lib/types.ts` mirrors the schema; `lib/season.ts` — `SEASONS`/`DEFAULT_SEASON`/`resolveSeason(searchParam)`.
- Pages (all season-aware via `?season=` + `SeasonSwitcher` in the nav): `app/page.tsx` (home match list), `app/matches/[id]/page.tsx` (scheduled/live/finished states; finished = widget + owned timeline/stats/lineups/ratings), `app/standings/page.tsx` (computed group tables cross-checked against stored API standings + knockout bracket), `app/players/page.tsx` (leaderboards from `player_season_stats`), `app/rankings/page.tsx` (Form Scores).
- `components/widgets/` — API-Sports widget integration (see below).

## API-Sports widgets (display-only enrichment)

- Official v3.1.0 widgets enrich display but never replace the Supabase pipeline. Gated by `widgetsEnabled` (`components/widgets/widgets-enabled.ts`): when `NEXT_PUBLIC_API_FOOTBALL_WIDGET_KEY` is unset, every widget renders nothing and the custom Supabase-backed views are used (required for offline/mock mode — mock fixture ids won't resolve in widgets).
- `ApiSportsConfig.tsx` loads the script once (`next/script`, `type="module"`) + the single global `data-type="config"` element (rendered in `app/layout.tsx`). `ApiSportsWidget.tsx` is the per-instance wrapper. `<api-sports-widget>` is declared in `types/api-sports-widgets.d.ts`.
- Widget placement: game widget on live/finished match pages (`data-game-tab="statistics"`), H2H on scheduled, standings on `/standings`; team/player/game modals via `data-target-*="modal"` in the config. Home page, `/rankings`, momentum charts, and all Form Score/prediction views stay CUSTOM.
- Theming: `data-theme="white"` + CSS variable overrides on `api-sports-widget` in `app/globals.css` (incl. dark mode + `.modal-widget` sizing).
- **Security**: `NEXT_PUBLIC_API_FOOTBALL_WIDGET_KEY` is exposed client-side by design — it MUST be domain-restricted in the API-Sports dashboard and MUST NOT be the worker's `API_FOOTBALL_KEY`. `data-refresh="60"` is kept conservative to protect quota; per API-Sports guidance, a CDN cache (e.g. Bunny.net tutorial) can further cut quota usage (logos don't count toward quota but are rate-limited).

## Conventions

- **Next.js 16 differs from training data** — read `node_modules/next/dist/docs/` before using unfamiliar APIs. `params`/`searchParams` are Promises; `PageProps<'/route'>` global helpers exist (run `npx next typegen` after adding routes).
- `cacheComponents` is NOT enabled; pages use `export const dynamic = "force-dynamic"` so Supabase reads are always fresh.
- All config from env vars, never hard-coded. Names per spec §8: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_DEFAULT_SEASON` (frontend); `API_FOOTBALL_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (worker). `.env.local` / `worker/.env` are gitignored.
- Season model: every table carries `season`; pages resolve it from `?season=` via `resolveSeason` (falls back to `NEXT_PUBLIC_DEFAULT_SEASON`, currently 2026). Match pages are season-implicit (fixture id). 2026 reuses the same code paths — no duplication.
- Form Score model is chosen by **data availability, not season number** (`analytics.py` `run()` sets `use_xg` from whether any `team_match_stats` row has `xg`): 2022 has no xG → reweighted no-xG composites (`baseline-v2-noxg`, byte-identical to before); 2026 returns `expected_goals` + `goals_prevented` → xG-enriched composites (`baseline-v3-xg`: xG-primary attack/defend + `finishing_delta`, plus a ΔxGD term in the upset model). xG is taken from the API, never self-computed; nullable `xg`/`goals_prevented` columns live on `team_match_stats` (migration `0003`).
- **Elo model (2026-only)**: `team_seasons` carries `initial_elo` (frozen FIFA seed, set once) and `elo` (live current, updated on each analytics run by `elo.py` replay). Seed source: `fifa_points_2026.py` (FIFA 2018 Elo points, scale 600). `analytics.predict_match` uses `/400` in its logit — that is a separate calibrated model coefficient, not a bug. `initial_elo` / `fifa_points` columns on `team_seasons` (migration `0004`); both nullable so 2022 stays valid. Frontend shows drift via `components/EloDelta.tsx` (▲ green / ▼ red delta since tournament start) on match pre-match H2H and rankings pages.
- Analytics join rule: a team's defending stats come from the **opponent's row** of the same match; `opponent.goals_for == team.goals_against` is checked as a consistency guard.
- Form display scale: `clamp(50 + 15·z, 0, 100)` — 50 = tournament average. Surface `sample_size` in UI when n < 3.
- Design: minimal, typographic; FotMob as structural reference only.
- Deferred (do not build unless asked): YouTube highlights, trained ML models.

## Local dev

```
npm run dev                              # frontend (needs NEXT_PUBLIC_* in .env.local)
cd worker && pip install -r requirements.txt
python -m worldcup_worker.backfill --season 2022   # one-shot full-season ingestion
python -m worldcup_worker.analytics --season 2022  # recompute Track 3
```

Mock seed (`supabase/seed.sql` + `generate_seed.py`) was removed in the 2022-demo rebuild — the hosted Supabase project holds real backfilled 2022 data.

## User workflow

- The user handles all git themselves — never run git commands or add Co-Authored-By trailers.
