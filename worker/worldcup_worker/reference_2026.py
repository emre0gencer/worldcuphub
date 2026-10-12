"""Hand-verified anchor facts for the completed 2026 FIFA World Cup.

These are NOT a data source — every number the app shows comes from the owned
pipeline (API-Football → Supabase). They are independent ground truth the
finalize script asserts against, sourced from published match reports
(ESPN / FIFA match centre / NBC / Al Jazeera, retrieved 2026-10-11):

    Final          Spain 1–0 Argentina (a.e.t., Ferran Torres)   2026-07-19  ESPN 760517
    Third place    France 4–6 England                             2026-07-18  ESPN 760516
    Semi-final     France 0–2 Spain                               2026-07-14  ESPN 760514
    Semi-final     England 1–2 Argentina                          2026-07-15  ESPN 760515
    Quarter-final  Spain 2–1 Belgium                              2026-07-10  ESPN 760511
    Round of 16    Portugal 0–1 Spain                             2026-07-06  ESPN 760506
    Golden Boot    Kylian Mbappé (France), 10 goals

Every other fixture is verified against ESPN's public scoreboard at run time
(see finalize_season.espn_crosscheck) — a second, independent provider.
Scores are stored as unordered {team: goals} so home/away labelling
differences between providers never cause false alarms.
"""

TOURNAMENT = {
    "season": 2026,
    "teams": 48,
    "groups": 12,
    "matches": 104,
    "first_kickoff_date": "2026-06-11",
    "final_date": "2026-07-19",
    "stage_counts": {
        "group": 72,
        "R32": 16,
        "R16": 8,
        "QF": 4,
        "SF": 2,
        "third_place": 1,
        "final": 1,
    },
    "champion": "Spain",
    "runner_up": "Argentina",
    "third": "England",
    "fourth": "France",
}

# (stage, date, {team: goals}, status_short or None, shootout or None)
ANCHOR_MATCHES = [
    ("final", "2026-07-19", {"Spain": 1, "Argentina": 0}, "AET", None),
    ("third_place", "2026-07-18", {"France": 4, "England": 6}, None, None),
    ("SF", "2026-07-14", {"France": 0, "Spain": 2}, None, None),
    ("SF", "2026-07-15", {"England": 1, "Argentina": 2}, None, None),
    ("QF", "2026-07-10", {"Spain": 2, "Belgium": 1}, None, None),
    ("R16", "2026-07-06", {"Portugal": 0, "Spain": 1}, None, None),
]

GOLDEN_BOOT = {"player_name_contains": "Mbapp", "team": "France", "goals": 10}
