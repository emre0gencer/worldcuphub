"""Deterministic mock-data generator → supabase/seed.sql.

Lets the whole stack run offline with no API-Football key:
- 48 teams (12 groups A–L), 15 players each
- all 104 fixtures (72 group + 32 knockout placeholders)
- 18 finished matches with full team/player stats (Track 2)
- 1 live match with a snapshot time-series (Track 1)
- team_form history over 3 matchdays + predictions (Track 3),
  computed with the real analytics code so numbers are internally consistent

Run from worker/: python -m worldcup_worker.generate_seed
The generated SQL is committed; apply it with `supabase db reset` or psql.
"""

import random
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .analytics import compute_form, predict_match

OUT_PATH = Path(__file__).resolve().parents[2] / "supabase" / "seed.sql"

rng = random.Random(2026)

# (name, alpha3, alpha2, fifa_ranking) — 48 plausible qualifiers, 12 groups of 4
TEAMS = [
    ("United States", "USA", "us", 11), ("Mexico", "MEX", "mx", 17), ("Canada", "CAN", "ca", 31),
    ("Argentina", "ARG", "ar", 1), ("France", "FRA", "fr", 2), ("Brazil", "BRA", "br", 5),
    ("England", "ENG", "gb-eng", 4), ("Spain", "ESP", "es", 3), ("Germany", "GER", "de", 10),
    ("Portugal", "POR", "pt", 6), ("Netherlands", "NED", "nl", 7), ("Belgium", "BEL", "be", 8),
    ("Croatia", "CRO", "hr", 9), ("Italy", "ITA", "it", 12), ("Uruguay", "URU", "uy", 13),
    ("Colombia", "COL", "co", 14), ("Ecuador", "ECU", "ec", 24), ("Peru", "PER", "pe", 36),
    ("Paraguay", "PAR", "py", 43), ("Japan", "JPN", "jp", 15), ("South Korea", "KOR", "kr", 22),
    ("Australia", "AUS", "au", 25), ("Iran", "IRN", "ir", 18), ("Saudi Arabia", "KSA", "sa", 56),
    ("Qatar", "QAT", "qa", 44), ("Uzbekistan", "UZB", "uz", 60), ("Jordan", "JOR", "jo", 68),
    ("Morocco", "MAR", "ma", 16), ("Senegal", "SEN", "sn", 19), ("Tunisia", "TUN", "tn", 40),
    ("Egypt", "EGY", "eg", 33), ("Nigeria", "NGA", "ng", 38), ("Cameroon", "CMR", "cm", 50),
    ("Ghana", "GHA", "gh", 64), ("Ivory Coast", "CIV", "ci", 39), ("Algeria", "ALG", "dz", 37),
    ("South Africa", "RSA", "za", 57), ("Switzerland", "SUI", "ch", 20), ("Denmark", "DEN", "dk", 21),
    ("Sweden", "SWE", "se", 27), ("Norway", "NOR", "no", 32), ("Poland", "POL", "pl", 28),
    ("Austria", "AUT", "at", 23), ("Serbia", "SRB", "rs", 30), ("Turkey", "TUR", "tr", 26),
    ("Ukraine", "UKR", "ua", 29), ("Panama", "PAN", "pa", 42), ("New Zealand", "NZL", "nz", 89),
]

GROUPS = "ABCDEFGHIJKL"
POSITIONS = ["GK", "GK", "DF", "DF", "DF", "DF", "DF", "MF", "MF", "MF", "MF", "FW", "FW", "FW", "FW"]

UTC = timezone.utc
# Matches with kickoff before this cutoff are finished; the one at the cutoff is live.
LIVE_CUTOFF = datetime(2026, 6, 14, 16, 0, tzinfo=UTC)


def q(value) -> str:
    """SQL-literal encode."""
    if value is None:
        return "null"
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (datetime, date)):
        return f"'{value.isoformat()}'"
    return str(value)


def insert(table: str, rows: list[dict]) -> str:
    if not rows:
        return ""
    cols = list(rows[0].keys())
    values = ",\n".join("  (" + ", ".join(q(r[c]) for c in cols) + ")" for r in rows)
    return f"insert into {table} ({', '.join(cols)}) values\n{values};\n\n"


def build_teams() -> list[dict]:
    teams = []
    for i, (name, a3, a2, rank) in enumerate(TEAMS):
        teams.append(
            {
                "id": 100 + i,
                "name": name,
                "country_code": a3,
                "flag_url": f"https://flagcdn.com/w80/{a2}.png",
                "fifa_ranking": rank,
                "elo": round(1900 - rank * 5.5 + rng.uniform(-25, 25), 1),
                "group_letter": GROUPS[i // 4],
            }
        )
    return teams


def build_players(teams: list[dict]) -> list[dict]:
    players = []
    pid = 10000
    for t in teams:
        for n, pos in enumerate(POSITIONS, start=1):
            pid += 1
            players.append(
                {
                    "id": pid,
                    "team_id": t["id"],
                    "name": f"{t['country_code']} {pos} {n}",
                    "position": pos,
                    "shirt_number": n,
                    "photo_url": None,
                    "age": rng.randint(19, 35),
                }
            )
    return players


def build_matches(teams: list[dict]) -> list[dict]:
    matches = []
    mid = 5000
    slot = 0
    # Group stage: 3 matchdays × 24 matches, June 11–22, 6 matches/day.
    matchday_pairs = [
        [(0, 1), (2, 3)],  # MD1
        [(0, 2), (3, 1)],  # MD2
        [(3, 0), (1, 2)],  # MD3
    ]
    venues = ["MetLife Stadium", "Estadio Azteca", "BC Place", "SoFi Stadium",
              "AT&T Stadium", "NRG Stadium", "Hard Rock Stadium", "Lumen Field"]
    for md, pairs in enumerate(matchday_pairs):
        for g in range(12):
            group = teams[g * 4 : g * 4 + 4]
            for h, a in pairs:
                mid += 1
                day = 11 + md * 4 + slot // 6 % 4
                hour = [13, 16, 16, 19, 19, 22][slot % 6]
                matches.append(
                    {
                        "id": mid,
                        "home_team_id": group[h]["id"],
                        "away_team_id": group[a]["id"],
                        "kickoff_at": datetime(2026, 6, day, hour, 0, tzinfo=UTC),
                        "venue": venues[slot % len(venues)],
                        "stage": "group",
                        "group_letter": GROUPS[g],
                        "status": "scheduled",
                        "home_score": None,
                        "away_score": None,
                    }
                )
                slot += 1

    # Knockout placeholders: pairings unknown until the group stage ends.
    knockout = [("R32", 16, date(2026, 6, 28)), ("R16", 8, date(2026, 7, 3)),
                ("QF", 4, date(2026, 7, 9)), ("SF", 2, date(2026, 7, 14)),
                ("final", 2, date(2026, 7, 18))]  # bronze + final
    for stage, count, start in knockout:
        for i in range(count):
            mid += 1
            d = start + timedelta(days=i // 4)
            matches.append(
                {
                    "id": mid,
                    "home_team_id": None,
                    "away_team_id": None,
                    "kickoff_at": datetime(d.year, d.month, d.day, [15, 18, 21, 12][i % 4], 0, tzinfo=UTC),
                    "venue": venues[i % len(venues)],
                    "stage": stage,
                    "group_letter": None,
                    "status": "scheduled",
                    "home_score": None,
                    "away_score": None,
                }
            )
    assert len(matches) == 104, len(matches)
    return matches


def simulate_team_stats(elo_diff: float) -> dict:
    """Plausible single-team match stats, tilted by Elo edge."""
    edge = elo_diff / 400.0
    xg = max(0.15, rng.gauss(1.3 + 0.8 * edge, 0.5))
    shots = max(3, int(rng.gauss(11 + 5 * edge, 3)))
    sot = max(1, min(shots, int(shots * rng.uniform(0.25, 0.5))))
    goals = min(6, max(0, int(rng.gauss(xg, 0.8) + 0.2)))
    possession = min(72.0, max(28.0, 50 + 12 * edge + rng.uniform(-6, 6)))
    passes = int(280 + possession * 5 + rng.uniform(-40, 40))
    return {
        "possession": round(possession, 1),
        "shots": shots,
        "shots_on_target": sot,
        "corners": rng.randint(1, 11),
        "fouls": rng.randint(7, 18),
        "passes": passes,
        "pass_accuracy": round(min(93.0, max(68.0, 74 + 14 * (possession - 50) / 22 + rng.uniform(-3, 3))), 1),
        "xg": round(xg, 2),
        "goals_for": goals,
    }


def build_finished_data(matches: list[dict], teams: list[dict], players: list[dict]):
    """Mark pre-cutoff matches finished (+1 live), generate Track 1 & 2 rows."""
    elo = {t["id"]: t["elo"] for t in teams}
    players_by_team: dict[int, list[dict]] = {}
    for p in players:
        players_by_team.setdefault(p["team_id"], []).append(p)

    team_stats_rows, player_stats_rows, snapshot_rows = [], [], []

    group_matches = sorted([m for m in matches if m["stage"] == "group"], key=lambda m: m["kickoff_at"])
    live_match = None
    for m in group_matches:
        if m["kickoff_at"] < LIVE_CUTOFF:
            m["status"] = "finished"
        elif live_match is None and m["kickoff_at"] == LIVE_CUTOFF:
            m["status"] = "live"
            live_match = m

    for m in [x for x in group_matches if x["status"] == "finished"]:
        h, a = m["home_team_id"], m["away_team_id"]
        sh = simulate_team_stats(elo[h] - elo[a])
        sa = simulate_team_stats(elo[a] - elo[h])
        m["home_score"], m["away_score"] = sh["goals_for"], sa["goals_for"]
        for side, opp in ((sh, sa), (sa, sh)):
            side["goals_against"] = opp["goals_for"]
        for team_id, s in ((h, sh), (a, sa)):
            team_stats_rows.append({"match_id": m["id"], "team_id": team_id, **s})
            player_stats_rows.extend(build_player_stats(m["id"], players_by_team[team_id], s))

    if live_match is not None:
        snapshot_rows = build_snapshots(live_match, elo)

    return team_stats_rows, player_stats_rows, snapshot_rows, live_match


def build_player_stats(match_id: int, squad: list[dict], team_stats: dict) -> list[dict]:
    starters = squad[:11] + rng.sample(squad[11:], 3)  # 11 starters + 3 subs
    goals_left = team_stats["goals_for"]
    scorers = [p for p in starters if p["position"] in ("MF", "FW")]
    rows = []
    for i, p in enumerate(starters):
        goals = 0
        while goals_left > 0 and p in scorers and rng.random() < 0.35:
            goals += 1
            goals_left -= 1
        rows.append(
            {
                "match_id": match_id,
                "player_id": p["id"],
                "team_id": p["team_id"],
                "minutes": 90 if i < 8 else rng.randint(20, 90),
                "goals": goals,
                "assists": 1 if goals_left == 0 and rng.random() < 0.2 else 0,
                "shots": goals + rng.randint(0, 3) if p["position"] in ("MF", "FW") else rng.randint(0, 1),
                "key_passes": rng.randint(0, 4) if p["position"] in ("MF", "FW") else rng.randint(0, 2),
                "tackles": rng.randint(0, 5) if p["position"] in ("DF", "MF") else rng.randint(0, 1),
                "rating": round(min(10.0, max(5.0, rng.gauss(6.8 + 0.6 * goals, 0.6))), 1),
            }
        )
    # leftover goals go to the first scorer candidate
    if goals_left > 0 and rows:
        rows[10]["goals"] += goals_left
    return rows


def build_snapshots(match: dict, elo: dict[int, float]) -> list[dict]:
    """Track 1 time-series for the live match, in the API-Football payload shape
    the real ingestion worker writes."""
    h, a = match["home_team_id"], match["away_team_id"]
    minute_now = 63
    goals = {h: 0, a: 0}
    totals = {h: {"shots": 0, "sot": 0, "corners": 0, "fouls": 0}, a: {"shots": 0, "sot": 0, "corners": 0, "fouls": 0}}
    goal_minutes = {h: [12, 58], a: [41]}
    rows = []
    for minute in range(0, minute_now + 1, 3):
        for team_id in (h, a):
            edge = (elo[team_id] - elo[h if team_id == a else a]) / 400.0
            if rng.random() < 0.45 + 0.2 * edge:
                totals[team_id]["shots"] += 1
                if rng.random() < 0.4:
                    totals[team_id]["sot"] += 1
            if rng.random() < 0.2:
                totals[team_id]["corners"] += 1
            if rng.random() < 0.35:
                totals[team_id]["fouls"] += 1
            goals[team_id] = sum(1 for gm in goal_minutes[team_id] if gm <= minute)

        possession_h = round(min(70, max(30, 52 + rng.uniform(-4, 4))), 0)
        stats_entries = []
        for team_id in (h, a):
            poss = possession_h if team_id == h else 100 - possession_h
            stats_entries.append(
                {
                    "team": {"id": team_id},
                    "statistics": [
                        {"type": "Ball Possession", "value": f"{int(poss)}%"},
                        {"type": "Total Shots", "value": totals[team_id]["shots"]},
                        {"type": "Shots on Goal", "value": totals[team_id]["sot"]},
                        {"type": "Corner Kicks", "value": totals[team_id]["corners"]},
                        {"type": "Fouls", "value": totals[team_id]["fouls"]},
                        {"type": "expected_goals", "value": round(totals[team_id]["sot"] * 0.18 + totals[team_id]["shots"] * 0.04, 2)},
                    ],
                }
            )
        captured = match["kickoff_at"] + timedelta(minutes=minute)
        payload = {
            "fixture": {"id": match["id"], "status": {"short": "2H" if minute > 45 else "1H", "elapsed": minute}},
            "goals": {"home": goals[h], "away": goals[a]},
            "statistics": stats_entries,
        }
        rows.append(
            {
                "match_id": match["id"],
                "captured_at": captured,
                "elapsed_minute": minute,
                "payload": payload,
            }
        )
    match["home_score"], match["away_score"] = goals[h], goals[a]
    return rows


def build_track3(matches: list[dict], teams: list[dict], team_stats_rows: list[dict]):
    """team_form history (one row per team per matchday) + predictions,
    computed with the production analytics code."""
    match_dates = {m["id"]: m["kickoff_at"] for m in matches}
    team_elo = {t["id"]: t["elo"] for t in teams}

    form_rows = []
    latest_form_by_team = {}
    for as_of in (date(2026, 6, 12), date(2026, 6, 13), date(2026, 6, 14)):
        cutoff = datetime(as_of.year, as_of.month, as_of.day, tzinfo=UTC)
        rows_so_far = [r for r in team_stats_rows if match_dates[r["match_id"]] < cutoff]
        day_rows = compute_form(rows_so_far, match_dates, team_elo, as_of)
        latest_form_by_team = {f["team_id"]: f for f in day_rows}
        form_rows.extend({k: v for k, v in f.items() if not k.startswith("_")} for f in day_rows)

    upcoming = [m for m in matches if m["status"] == "scheduled" and m["home_team_id"] and m["away_team_id"]]
    prediction_rows = []
    for m in upcoming:
        p = predict_match(m, latest_form_by_team, team_elo)
        p["generated_at"] = datetime(2026, 6, 14, 6, 0, tzinfo=UTC)
        prediction_rows.append(p)
    return form_rows, prediction_rows


def main() -> None:
    teams = build_teams()
    players = build_players(teams)
    matches = build_matches(teams)
    team_stats_rows, player_stats_rows, snapshot_rows, live_match = build_finished_data(matches, teams, players)
    form_rows, prediction_rows = build_track3(matches, teams, team_stats_rows)

    # JSONB payloads need json encoding inside SQL string literals
    import json

    snapshot_sql_rows = [
        {**r, "payload": json.dumps(r["payload"], separators=(",", ":"))} for r in snapshot_rows
    ]

    sql = (
        "-- Generated by worker/worldcup_worker/generate_seed.py — do not edit by hand.\n"
        "-- Deterministic mock data: full stack runs offline without API keys.\n\n"
        "begin;\n\n"
        + insert("teams", teams)
        + insert("players", players)
        + insert("matches", matches)
        + insert("team_match_stats", team_stats_rows)
        + insert("player_match_stats", player_stats_rows)
        + insert("match_snapshots", snapshot_sql_rows)
        + insert("team_form", form_rows)
        + insert("predictions", prediction_rows)
        + "commit;\n"
    )
    OUT_PATH.write_text(sql)

    finished = sum(1 for m in matches if m["status"] == "finished")
    print(f"wrote {OUT_PATH}")
    print(f"  teams={len(teams)} players={len(players)} matches={len(matches)} "
          f"(finished={finished}, live={'1' if live_match else '0'})")
    print(f"  team_stats={len(team_stats_rows)} player_stats={len(player_stats_rows)} "
          f"snapshots={len(snapshot_rows)} form={len(form_rows)} predictions={len(prediction_rows)}")


if __name__ == "__main__":
    main()
