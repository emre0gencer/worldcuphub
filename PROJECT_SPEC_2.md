# World Cup HUB — Project Spec 2 (2022 Demo Phase)

Companion to `PROJECT_SPEC.md`. That document still holds for the overall stack, the three-track schema philosophy, and the Form Score math. **This document governs the current phase** and overrides `PROJECT_SPEC.md` wherever they differ (notably: the mock seed is being removed, stat tables are widening, and a `season` column is being added).

---

## 1. Purpose of this phase

Build a **fully-functional 2022 World Cup DEMO** that doubles as the **reusable template for the live 2026 tournament**. Because 2022 is finished, its data is complete and stable — it's the ideal proving ground for the entire pipeline before 2026 data arrives live.

Everything built this phase must be **parameterized by season**, so the exact same code serves `season=2022` (the demo) and `season=2026` (live, later) with no rewrite.

### Portfolio intent (the "why")

This project showcases that the author, as a software engineer, can: retrieve API data, **fetch and take ownership of relevant game/fixture/tournament data into their own system**, and present it meaningfully. Display happens via **widgets for now** (while the API-Football subscription is active) and via a **custom frontend later**. This phase prioritizes *data retrieval and ownership* — even where the display is a widget, the underlying data must also be ingested into our database.

---

## 2. The two data paths (critical mental model)

Widgets and data ownership are **separate paths that share an API source but never touch each other**. Every demo surface needs BOTH:

| Path | What it does | Where data lives |
|---|---|---|
| **Widget** | Client-side web component fetches from API-Football directly and renders | Nowhere in our DB — display only |
| **Ingestion** | Reusable backend pipeline pulls the *same* data into Supabase | Our owned tables — for computation, leaderboards, simulations |

Do not assume a widget populates the database. It does not. The ingestion pipeline is a separate deliverable that runs alongside the widgets.

---

## 3. Locked decisions for this phase

| # | Decision | Choice |
|---|---|---|
| 1 | Ingestion style | **Reusable**, season-parameterized pipeline — NOT a one-off backfill. Pointing it at `season=2026` later must just work. |
| 2 | Player data granularity | **Granular** — per-player-per-fixture rows, full stat field set. Powers leaderboards and future simulations. |
| 3 | Standings | **Compute** group tables from stored match results, AND store the API `/standings` data to cross-check against. Report discrepancies. |
| 4 | xG (and advanced metrics) | **Conditional on reality.** If API-Football returns it for 2022, store and use it. If not, scratch the xG column and revise the Form Score weighting onto shots/SOT. Never keep a silently-null xG column. |
| 5 | Migration style | **Clean rebuild.** Drop the mock seed (ids 5001–5104). Add a `season` column to all core tables so 2022 and 2026 coexist in one schema. |

---

## 4. Core principle: discovery before schema

**Do not design a single DB column from assumption.** The sequence is always:

1. Run real API-Football calls for `season=2022`.
2. Inspect the actual JSON returned.
3. Design the schema to match what genuinely exists.
4. **Pause for human review before any destructive change.**

The clean rebuild (dropping the seed) is irreversible, so it happens only *after* the field inventory is reviewed and approved.

---

## 5. API reference

- Account type: **direct API-Football** (not RapidAPI).
- Base URL: `https://v3.football.api-sports.io/`
- Auth header: `x-apisports-key: <key>` — read from the existing **server-side** env var; never hard-code.
- World Cup league id: `1`. Demo season: `2022`. Live season: `2026`.
- Same single API key is used for the pipeline AND the widgets. The widget copy lives in `NEXT_PUBLIC_API_FOOTBALL_WIDGET_KEY` and is **client-exposed** — domain-restrict it in the dashboard before deploy.

### Endpoints to inventory (run real curls, capture raw JSON)

| Endpoint | Purpose |
|---|---|
| `/fixtures?league=1&season=2022` | All 64 matches + real fixture ids |
| `/fixtures?ids=A-B-C-...` | Batch (~20/call) → events, lineups, team stats, player stats per fixture |
| `/standings?league=1&season=2022` | Stored standings to cross-check computed tables |
| `/players/topscorers?league=1&season=2022` | Top scorers leaderboard |
| `/players/topassists?league=1&season=2022` | Top assists (also topyellowcards / topredcards if present) |
| `/players?league=1&season=2022` | Paginated per-player season stats |
| `/teams?league=1&season=2022` | Team profiles |

### Required output: the FIELD INVENTORY

For each endpoint, produce a table mapping **every API field → proposed DB column + type**. Explicitly report which advanced metrics actually exist for 2022:

- **xG** present in fixture team statistics? (If absent → scratch xG, flag Form Score reweighting onto shots/SOT.)
- **Player ratings** present?
- Passes, duels, tackles, dribbles, and the rest of the per-fixture player-stat field set?

---

## 6. Quota discipline

- Use `/fixtures?ids=` **batching** (~20 fixtures per call) — pulling 2022 match-by-match is ~256 calls; batched it's ~a dozen. Do not regress to per-fixture calls during backfill.
- The BunnyCDN cache (configured in the dashboard) deduplicates widget traffic across users; keep `data-refresh` conservative.

---

## 7. Phase plan

**Phase 0 — Smoke test.** Pull the 2022 fixture list, grab one finished fixture id, point a Game widget at it in a throwaway standalone HTML file (key inline, outside the repo, never committed). Confirm it renders real stats before anything else.

**Phase 1 — API discovery.** Run the curls above, save raw JSON, produce the field inventory + proposed schema. **STOP for review. Drop nothing yet.**

**Phase 2 — Schema rebuild (after approval).** Clean rebuild; drop mock seed; add `season` column to all core tables; design stat tables wide enough for every proven field — `team_match_stats`, granular `player_match_stats`, a standings table, plus events/lineups as discovery surfaced. New migration; three-track design preserved.

**Phase 3 — Reusable ingestion pipeline.** Season-parameterized backfill pulling ALL 2022 data (fixtures, team stats, player stats, events, lineups, standings, teams, players) into Supabase. Diff the real response field-for-field against the schema; report mismatches rather than coercing silently.

**Phase 4 — 2022 demo pages (fully functional):**
- **Tournament standings page** — all 8 groups, tables COMPUTED from stored results (P/W/D/L/GD/Pts/form), cross-checked against stored `/standings`; plus the knockout bracket with results.
- **Match pages** — every match clickable → full game view, all available stats (Game widget for display; owned data underneath).
- **Top players page** — leaderboards (top scorers, assists, best performers by rating, etc.) built from OWNED granular player data, not just the widget.

**Phase 5 — 2026 skeleton.** Mirror the same pages and ingestion code for `season=2026`, ready to populate live. Reuse Phase 4 components and the Phase 3 pipeline — no duplicated logic.

---

## 8. Standing reminders

- Keep the tree runnable throughout each phase.
- Show the overall plan before Phase 0; stop at the Phase 1 review checkpoint.
- Preserve the three-track separation: volatile live snapshots vs. immutable finalized stats vs. derived analytics.
- The `season` column is the keystone that lets one schema serve both tournaments — apply it everywhere relevant.
- Form Score weighting depends on Phase 1's xG finding — do not finalize it until reality is known.

### Hard constraint — git

Do **NOT** run any git commands — no `add`, `commit`, or `push`, and never add `Co-Authored-By` trailers. The author handles all git personally. Only write files to the working tree.
