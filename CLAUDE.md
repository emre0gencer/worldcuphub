@AGENTS.md

# World Cup HUB

Read-only web app + data platform for the 2026 FIFA World Cup. **PROJECT_SPEC.md is the single source of truth** — all decisions there are locked; do not re-derive them.

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
- `worker/worldcup_worker/analytics.py` — Form Score math (spec §5, steps 1–7 implemented exactly) + baseline upset model. Pure functions over dict rows; the Supabase-backed job is `run()`. Run: `python -m worldcup_worker.analytics`
- `worker/worldcup_worker/generate_seed.py` — deterministic mock data → `supabase/seed.sql` (do not edit seed.sql by hand). Reuses the real analytics functions so Track 3 mock data is internally consistent.
- `lib/queries.ts` — all frontend Supabase reads; `lib/types.ts` mirrors the schema.
- Pages: `app/page.tsx` (home match list), `app/matches/[id]/page.tsx` (scheduled/live/finished states), `app/rankings/page.tsx`, `app/standings/page.tsx` (group tables).
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
- All config from env vars, never hard-coded. Names per spec §8: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (frontend); `API_FOOTBALL_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (worker). `.env.local` / `worker/.env` are gitignored.
- Analytics join rule: a team's defending stats come from the **opponent's row** of the same match; `opponent.goals_for == team.goals_against` is checked as a consistency guard.
- Form display scale: `clamp(50 + 15·z, 0, 100)` — 50 = tournament average. Surface `sample_size` in UI when n < 3.
- Design: minimal, typographic; FotMob as structural reference only.
- Deferred (do not build unless asked): YouTube highlights, trained ML models.

## Local dev

```
supabase start && supabase db reset      # applies migrations + seed.sql (mock data, no API keys needed)
npm run dev                              # frontend (needs NEXT_PUBLIC_* in .env.local)
cd worker && pip install -r requirements.txt
python -m worldcup_worker.generate_seed  # regenerate seed.sql after schema changes
```

## User workflow

- The user handles all git themselves — never run git commands or add Co-Authored-By trailers.
