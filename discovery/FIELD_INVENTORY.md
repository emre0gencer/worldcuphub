# Phase 1 — API-Football Field Inventory (league=1, season=2022)

Raw responses in `discovery/2022/*.json`. 9 API calls total. All endpoints returned
`errors: []`. Every claim below is verified against the actual JSON, not assumed.

## Headline findings

| Question | Answer (verified) |
|---|---|
| **xG in fixture team statistics?** | **NO.** The stat-type union across sampled fixtures (group + SF + final) is: Ball Possession, Blocked Shots, Corner Kicks, Fouls, Goalkeeper Saves, Offsides, Passes %, Passes accurate, Red Cards, Shots insidebox, Shots off Goal, Shots on Goal, Shots outsidebox, Total Shots, Total passes, Yellow Cards. No `expected_goals`. → **Scratch the `xg` column; reweight Form Score onto goals/SOT/shots** (proposal below). |
| **Player ratings?** | **YES** — `games.rating` per fixture (string, e.g. `"6.3"`) and per season in `/players`. |
| **Per-fixture player stat set?** | Full set present: minutes, position, rating, captain, substitute, offsides, shots(total/on), goals(total/conceded/assists/saves), passes(total/key/accuracy), tackles(total/blocks/interceptions), duels(total/won), dribbles(attempts/success/past), fouls(drawn/committed), cards(yellow/red), penalty(won/commited[sic]/scored/missed/saved). Many values null for low-event players — store nullable. |
| Events / lineups in the batch call? | YES — `/fixtures?ids=` returns `events`, `lineups`, `statistics`, `players` per fixture in one response. Backfill of all 64 fixtures ≈ **4 batched calls**. |
| Penalty shootouts | Final has `status.short="PEN"`, `goals` = 3–3 (after ET), `score.penalty` = 4–2. Shootout kicks are events at `elapsed=120` with `comments="Penalty Shootout"`. 2022 statuses seen: only `FT`, `PEN` (no `AET` instance, but it exists in the API status set — allow it). |
| `/players` pagination | 20 rows/page, **42 pages** for 2022 (~830 players incl. all squad members). |
| Misc gotchas | `Ball Possession`/`Passes %` are strings (`"78%"`); player `passes.accuracy` is a string per-fixture but a number per-season; API typo `penalty.commited`; venue `id` is null on 56/64 fixtures but `name`/`city` are always populated; standings `home`/`away` splits are all-null for World Cup. |

---

## 1. `/fixtures?league=1&season=2022` → `matches`

64 fixtures. Rounds: `Group Stage - 1/2/3`, `Round of 16`, `Quarter-finals`, `Semi-finals`, `3rd Place Final`, `Final`.

| API field | DB column | Type | Notes |
|---|---|---|---|
| `fixture.id` | `id` | bigint PK | Real API fixture id (e.g. 979139) |
| — | `season` | int NOT NULL | **New keystone column** (from request param / `league.season`) |
| `fixture.date` | `kickoff_at` | timestamptz | |
| `fixture.referee` | `referee` | text | Always populated in 2022 |
| `fixture.timezone`, `timestamp`, `periods` | — | — | DROP (derivable / not useful) |
| `fixture.venue.name` | `venue` | text | id null on 56/64 → store name only |
| `fixture.venue.city` | `venue_city` | text | |
| `fixture.status.short` | `status_short` | text | **Source of truth.** `FT`/`PEN`/`AET` + live codes (`1H`,`HT`,`2H`,`ET`,`P`,`NS`…) for 2026 |
| `fixture.status.elapsed` | — | — | DROP from matches (lives in snapshots) |
| derived | `status` | text **GENERATED** | Stored generated column from `status_short` → `scheduled/live/finished`; cannot drift |
| `league.round` | `round` | text | Raw round string |
| derived from round | `stage` | text check | `group/R32/R16/QF/SF/third_place/final` — **2022 has no R32; 2026 has no 3rd-place naming match — derive per season** + `group_letter` (from standings/teams mapping for group games) |
| `teams.home.id` / `teams.away.id` | `home_team_id` / `away_team_id` | bigint FK | Nullable (2026 knockouts TBD) |
| `teams.home.winner` | `home_winner` | boolean | Nullable; needed because `goals` ties at 3–3 in PEN games |
| `goals.home` / `goals.away` | `home_score` / `away_score` | int | Headline score after ET (excl. shootout); final = 3–3 |
| `score.halftime.*` | `ht_home`, `ht_away` | int | Final = 2–0 |
| `score.fulltime.*` | `ft_home`, `ft_away` | int | **Regulation (90′) score — only non-reconstructable value.** Final = 2–2 |
| `score.extratime.*` | — | — | DROP — ET-period-only goals (final = 1–1), derivable as `home_score − ft_home` |
| `score.penalty.*` | `pen_home`, `pen_away` | int | Null unless shootout; final = 4–2 |
| `youtube_highlight_id` | keep | text | Existing deferred feature, unchanged |

## 2. `/fixtures?ids=` → per-fixture blocks

### 2a. `statistics[]` → `team_match_stats` (2 rows/fixture)

| API stat type | DB column | Type | Notes |
|---|---|---|---|
| — | `season` | int | |
| `Shots on Goal` | `shots_on_target` | int | |
| `Shots off Goal` | `shots_off_target` | int | NEW |
| `Total Shots` | `shots` | int | |
| `Blocked Shots` | `shots_blocked` | int | NEW |
| `Shots insidebox` | `shots_inside_box` | int | NEW |
| `Shots outsidebox` | `shots_outside_box` | int | NEW |
| `Fouls` | `fouls` | int | |
| `Corner Kicks` | `corners` | int | |
| `Offsides` | `offsides` | int | NEW |
| `Ball Possession` | `possession` | numeric | Parse `"78%"` → 78 |
| `Yellow Cards` | `yellow_cards` | int | NEW |
| `Red Cards` | `red_cards` | int | NEW; null → 0 |
| `Goalkeeper Saves` | `saves` | int | NEW |
| `Total passes` | `passes` | int | |
| `Passes accurate` | `passes_accurate` | int | NEW |
| `Passes %` | `pass_accuracy` | numeric | Parse `"90%"` → 90 |
| from `goals` | `goals_for`, `goals_against` | int | As today |
| ~~xg~~ | **DROPPED** | — | Not returned for 2022 (decision #4) |

### 2b. `players[]` → `player_match_stats` (granular, decision #2)

| API field (under `statistics[0]`) | DB column | Type |
|---|---|---|
| — | `season` | int |
| `games.minutes` | `minutes` | int |
| `games.position` / `games.number` | — | — (live in `match_lineup_players` only — same per-fixture fact, one home) |
| `games.rating` | `rating` | numeric (parse string) |
| `games.captain` | `captain` | boolean |
| `games.substitute` | `substitute` | boolean |
| `offsides` | `offsides` | int |
| `shots.total` / `shots.on` | `shots`, `shots_on_target` | int |
| `goals.total` / `conceded` / `assists` / `saves` | `goals`, `goals_conceded`, `assists`, `saves` | int |
| `passes.total` / `key` / `accuracy` | `passes`, `key_passes`, `pass_accuracy` | int / int / numeric |
| `tackles.total` / `blocks` / `interceptions` | `tackles`, `blocks`, `interceptions` | int |
| `duels.total` / `won` | `duels`, `duels_won` | int |
| `dribbles.attempts` / `success` / `past` | `dribbles_attempted`, `dribbles_succeeded`, `dribbled_past` | int |
| `fouls.drawn` / `committed` | `fouls_drawn`, `fouls_committed` | int |
| `cards.yellow` / `red` | `yellow_cards`, `red_cards` | int |
| `penalty.won` / `commited` / `scored` / `missed` / `saved` | `penalties_won`, `penalties_committed`, `penalties_scored`, `penalties_missed`, `penalties_saved` | int |

All stat columns nullable (API uses null for "none recorded").

### 2c. `events[]` → NEW table `match_events`

| API field | DB column | Type | Notes |
|---|---|---|---|
| — | `id` | bigserial PK; `season` int | |
| `time.elapsed` / `time.extra` | `elapsed`, `elapsed_extra` | int | Shootout kicks: 120 + extra |
| `team.id` | `team_id` | bigint FK | |
| `player.id` / `player.name` | `player_id`, `player_name` | bigint / text | id occasionally null → keep name |
| `assist.id` / `assist.name` | `assist_id`, `assist_name` | bigint / text | Doubles as sub-on player for `subst` |
| `type` | `type` | text | Seen: `Goal`, `Card`, `subst`, `Var` |
| `detail` | `detail` | text | e.g. `Normal Goal`, `Penalty`, `Missed Penalty`, `Yellow Card`, `Substitution N`, `Penalty confirmed` |
| `comments` | `comments` | text | `"Penalty Shootout"` marks shootout kicks |
| — | `order_index` | int | Preserve API array order (stable sort within same minute) |

### 2d. `lineups[]` → NEW tables `match_lineups` (per team) + `match_lineup_players` (per player)

Team-level facts (formation, coach) live once per team, not duplicated onto ~26 player rows.

**`match_lineups`** — PK `(match_id, team_id)`:

| API field | DB column | Type |
|---|---|---|
| — | `season` | int |
| `formation` | `formation` | text (`4-2-3-1`) |
| `coach.id` / `coach.name` | `coach_id`, `coach_name` | bigint / text |
| `team.colors` | — | DROP (display-only; widget handles it) |

**`match_lineup_players`** — the single home for per-fixture `position`/`shirt_number`:

| API field | DB column | Type | Notes |
|---|---|---|---|
| startXI vs substitutes | `starter` | boolean | |
| `player.id` / `name` | `player_id`, `player_name` | bigint / text | |
| `player.number` / `pos` | `shirt_number`, `position` | int / text | Removed from `player_match_stats` |
| `player.grid` | `grid` | text | `"row:col"`, null for subs — powers pitch layout |

## 3. `/standings` → NEW table `standings` (decision #3: store AND compute)

8 groups × 4 rows. `home`/`away` splits all-null for WC → not stored.

| API field | DB column | Type |
|---|---|---|
| — | `season` int; PK `(season, team_id)` | |
| `rank` | `rank` | int |
| `group` | `group_name` | text (`"Group A"`) |
| `team.id` | `team_id` | bigint FK |
| `points` | `points` | int |
| `goalsDiff` | `goals_diff` | int |
| `form` | `form` | text (`"WDW"`) |
| `status` / `description` | `description` | text (keep description only) |
| `all.played/win/draw/lose` | `played`, `won`, `drawn`, `lost` | int |
| `all.goals.for/against` | `goals_for`, `goals_against` | int |
| `update` | `updated_at` | timestamptz |

Group tables remain **computed** from `matches`; this table is the cross-check. Discrepancies reported, not auto-resolved.

## 4. `/teams` → `teams` (rebuilt)

| API field | DB column | Type | Notes |
|---|---|---|---|
| `team.id` | `id` | bigint PK | Real ids (England=10, Argentina=26…) |
| — | `season` | int | Teams are global — no season on `teams`. Tournament-scoped facts live in `team_seasons (team_id, season, fifa_ranking, elo)`. `group_letter` lives ONLY on `matches` (denormalized for group-stage queries; a team's group is derivable from its matches). |
| `team.name` | `name` | text | |
| `team.code` | `country_code` | text (`BEL`) | |
| `team.logo` | `flag_url` → rename `logo_url` | text | |
| `team.country`, `founded`, `national` | — | — | DROP (redundant for national teams) |
| `venue.*` | — | — | DROP (home stadium irrelevant at a WC) |
| existing `fifa_ranking`, `elo` | keep on `team_seasons` | | Elo is tournament-scoped |

## 5. `/players?league&season` (42 pages) → `players` + NEW `player_season_stats`

**`players`** (global profile): `id` PK, `name`, `firstname`, `lastname`, `birth_date`, `nationality`, `height`, `weight`, `photo_url`. (DROP: `injured`, `birth.place/country`, `age` — derivable/volatile.)

**`player_season_stats`** (PK `(player_id, season)`): `team_id`, `position`, `appearances` (API: `games.appearences` [sic]), `lineups`, `minutes`, `rating` (numeric), `captain`, `subs_in`, `subs_out`, `bench`, plus the same stat block as §2b at season grain (shots/goals/assists/saves/passes/key_passes/pass_accuracy/tackles/blocks/interceptions/duels/duels_won/dribbles/fouls/cards incl. `yellowred_cards`, penalties).

**Deliberate store-and-cross-check decision** (consistent with standings, decision #3): kept because `rating` is an API-side average and `appearences` has its own definition — not naive sums of match rows. Leaderboards read this table; per-fixture rows remain the granular source of truth for custom metrics. Aggregation discrepancies are reported, not coerced.

## 6. `/players/topscorers`, `topassists`, `topyellowcards`, `topredcards`

Same row shape as `/players`. **No new table** — leaderboards computed from owned `player_season_stats` / `player_match_stats`; raw JSON kept in `discovery/2022/` as a cross-check fixture. (All four endpoints exist and returned 20 rows each.)

---

## Form Score reweighting proposal (xG absent — decision #4)

Spec §5 weights redistribute proportionally onto the surviving metrics:

```
A(m) = 0.40·z(adjA_goals) + 0.30·z(adjA_sot) + 0.20·z(adjA_shots)
     + 0.05·z(corners) + 0.05·z(pass_accuracy)

D(m) = 0.45·z(adjD_goals) + 0.35·z(adjD_sot) + 0.20·z(adjD_shots)
```

Steps 1–3 and 5–7 (baselines, z-scores, recency ρ=0.7, shrinkage k=2, display scale) unchanged. If 2026 fixtures do return `expected_goals` live, the original weights can come back behind a per-season branch — but that is a future decision, not built now.

## Three-track mapping (preserved)

- **Track 1 (volatile)**: `match_snapshots` unchanged + `season` column.
- **Track 2 (immutable)**: widened `team_match_stats`, granular `player_match_stats`, `match_events`, `match_lineups` — written once by finalize/backfill.
- **Track 3 (derived)**: `team_form`, `predictions` + `season`; `standings` (stored API copy) sits alongside as cross-check reference.

## Phase 2 inputs awaiting approval

1. Drop mock seed (ids 5001–5104, teams 100–147, players 10001+) — clean rebuild migration.
2. `season` column everywhere per tables above; `teams`/`players` global + `team_seasons`/`player_season_stats`.
3. Scratch `xg` columns; adopt reweighted Form Score above.
4. New tables: `match_events`, `match_lineups` + `match_lineup_players`, `standings`, `team_seasons`, `player_season_stats`.
5. Stage values gain `third_place`; `matches` gains referee/round/status_short (+ generated `status`)/ht-ft-pen score columns.

### Review revisions applied (approved with fixes)

- Scores: keep `ht_*`, `ft_*` (regulation 90′ — the only non-reconstructable value), `pen_*`, `home_score/away_score`; drop `et_*` (ET-period-only goals, derivable). Verified vs final 979139: HT 2–0, FT 2–2, ET-period 1–1, goals 3–3, pens 4–2.
- `status` is a stored **generated column** from `status_short` — no drift possible.
- `group_letter` lives only on `matches`; `team_seasons` = `(team_id, season, fifa_ranking, elo)`.
- Lineups split into team-level + player-level tables; per-fixture `position`/`shirt_number` live only in `match_lineup_players`.
- `player_season_stats` kept as a deliberate store-and-cross-check (API-authoritative averages/appearances).
