import type { EloHistoryRow, MatchWithTeams, PlayerSeasonStats, Stage, Team } from "./types";

/**
 * Tournament-level facts derived purely from owned data (matches + per-match
 * player rows + the Elo replay). Nothing here is hard-coded: if the database
 * says it, the summary says it — which is what the finalize cross-check
 * (worker/worldcup_worker/finalize_season.py) verifies against ESPN and the
 * reference anchors.
 */

export interface TournamentSummary {
  final: MatchWithTeams | null;
  champion: Team | null;
  runnerUp: Team | null;
  third: Team | null;
  fourth: Team | null;
  thirdPlaceMatch: MatchWithTeams | null;
  played: number;
  total: number;
  goals: number;
  goalsPerMatch: number;
  extraTime: number;
  shootouts: number;
  teams: number;
  biggestWin: MatchWithTeams | null;
  highestScoring: MatchWithTeams | null;
  goldenBoot: PlayerSeasonStats[]; // tied leaders
  topAssist: PlayerSeasonStats | null;
}

const winnerOf = (m: MatchWithTeams | null | undefined): Team | null =>
  !m || m.status !== "finished" || m.home_winner == null
    ? null
    : m.home_winner
      ? m.home_team
      : m.away_team;

const loserOf = (m: MatchWithTeams | null | undefined): Team | null =>
  !m || m.status !== "finished" || m.home_winner == null
    ? null
    : m.home_winner
      ? m.away_team
      : m.home_team;

const goalsIn = (m: MatchWithTeams) => (m.home_score ?? 0) + (m.away_score ?? 0);

export function summarizeTournament(
  matches: MatchWithTeams[],
  players: PlayerSeasonStats[] = [],
): TournamentSummary {
  const finished = matches.filter((m) => m.status === "finished");
  const final = matches.find((m) => m.stage === "final") ?? null;
  const thirdPlaceMatch = matches.find((m) => m.stage === "third_place") ?? null;
  const goals = finished.reduce((t, m) => t + goalsIn(m), 0);

  const byMargin = [...finished].sort(
    (a, b) =>
      Math.abs((b.home_score ?? 0) - (b.away_score ?? 0)) -
        Math.abs((a.home_score ?? 0) - (a.away_score ?? 0)) || goalsIn(b) - goalsIn(a),
  );
  const byGoals = [...finished].sort((a, b) => goalsIn(b) - goalsIn(a));

  const teams = new Set<number>();
  for (const m of matches) {
    if (m.home_team_id) teams.add(m.home_team_id);
    if (m.away_team_id) teams.add(m.away_team_id);
  }

  const maxGoals = Math.max(0, ...players.map((p) => p.goals ?? 0));
  const goldenBoot =
    maxGoals > 0
      ? players
          .filter((p) => (p.goals ?? 0) === maxGoals)
          .sort((a, b) => (b.assists ?? 0) - (a.assists ?? 0) || (a.minutes ?? 0) - (b.minutes ?? 0))
      : [];
  const topAssist =
    [...players].sort(
      (a, b) => (b.assists ?? 0) - (a.assists ?? 0) || (a.minutes ?? 0) - (b.minutes ?? 0),
    )[0] ?? null;

  return {
    final,
    champion: winnerOf(final),
    runnerUp: loserOf(final),
    third: winnerOf(thirdPlaceMatch),
    fourth: loserOf(thirdPlaceMatch),
    thirdPlaceMatch,
    played: finished.length,
    total: matches.length,
    goals,
    goalsPerMatch: finished.length ? goals / finished.length : 0,
    extraTime: finished.filter((m) => m.status_short === "AET" || m.status_short === "PEN").length,
    shootouts: finished.filter((m) => m.pen_home != null).length,
    teams: teams.size,
    biggestWin: byMargin[0] ?? null,
    highestScoring: byGoals[0] ?? null,
    goldenBoot,
    topAssist: topAssist && (topAssist.assists ?? 0) > 0 ? topAssist : null,
  };
}

// ── how far each team went ───────────────────────────────────────────────────

export type Finish =
  | "Champion"
  | "Runner-up"
  | "Third"
  | "Fourth"
  | "Quarter-final"
  | "Round of 16"
  | "Round of 32"
  | "Group stage";

const STAGE_FINISH: Record<Stage, { tier: number; label: Finish }> = {
  final: { tier: 2, label: "Runner-up" },
  third_place: { tier: 4, label: "Fourth" },
  SF: { tier: 4, label: "Fourth" },
  QF: { tier: 5, label: "Quarter-final" },
  R16: { tier: 6, label: "Round of 16" },
  R32: { tier: 7, label: "Round of 32" },
  group: { tier: 8, label: "Group stage" },
};

/** team_id → furthest stage reached (tier 1 = champion … 8 = group exit). */
export function finishingPositions(
  matches: MatchWithTeams[],
): Map<number, { tier: number; label: Finish }> {
  const out = new Map<number, { tier: number; label: Finish }>();
  for (const m of matches) {
    for (const t of [m.home_team_id, m.away_team_id]) {
      if (t == null) continue;
      const f = STAGE_FINISH[m.stage];
      const cur = out.get(t);
      if (!cur || f.tier < cur.tier) out.set(t, f);
    }
  }
  const final = matches.find((m) => m.stage === "final");
  const champ = winnerOf(final);
  if (champ) out.set(champ.id, { tier: 1, label: "Champion" });
  const third = winnerOf(matches.find((m) => m.stage === "third_place"));
  if (third) out.set(third.id, { tier: 3, label: "Third" });
  return out;
}

// ── Elo trajectory helpers ───────────────────────────────────────────────────

export interface EloPathPoint {
  seq: number;
  matchId: number;
  kickoffAt: string | null;
  stage: Stage;
  elo: number;
  delta: number;
  opponentId: number | null;
}

/** team_id → ordered Elo path (seed point first, then one point per match). */
export function eloPaths(
  history: EloHistoryRow[],
  seeds: Map<number, number>,
): Map<number, EloPathPoint[]> {
  const out = new Map<number, EloPathPoint[]>();
  for (const [teamId, seed] of seeds) {
    out.set(teamId, [
      { seq: 0, matchId: 0, kickoffAt: null, stage: "group", elo: seed, delta: 0, opponentId: null },
    ]);
  }
  for (const h of [...history].sort((a, b) => a.seq - b.seq)) {
    const path = out.get(h.team_id) ?? [];
    path.push({
      seq: h.seq,
      matchId: h.match_id,
      kickoffAt: h.kickoff_at,
      stage: h.stage,
      elo: h.elo_after,
      delta: h.delta,
      opponentId: h.opponent_id,
    });
    out.set(h.team_id, path);
  }
  return out;
}

// ── model report card (replayed pre-match predictions vs. results) ──────────

export interface ModelReport {
  n: number;
  accuracy: number; // argmax(H/D/A) == 90'-or-ET result (shootouts count as draws)
  brier: number; // multi-class Brier, lower is better (0.667 = uniform guess)
  baselineBrier: number; // always predicting the tournament's base rates
  favouriteWinRate: number; // higher-Elo side won (excl. draws)
  upsets: { match: MatchWithTeams; upsetProbability: number }[];
}

export function modelReport(
  matches: MatchWithTeams[],
  predictions: {
    match_id: number;
    home_win_prob: number;
    draw_prob: number;
    away_win_prob: number;
    upset_probability: number;
  }[],
  preElo: Record<number, Record<number, { before: number }>>,
): ModelReport | null {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const graded = predictions
    .map((p) => ({ p, m: byId.get(p.match_id) }))
    .filter(
      (x): x is { p: (typeof predictions)[number]; m: MatchWithTeams } =>
        !!x.m && x.m.status === "finished" && x.m.home_score != null && x.m.away_score != null,
    );
  if (graded.length === 0) return null;

  const outcome = (m: MatchWithTeams): 0 | 1 | 2 =>
    m.home_score! > m.away_score! ? 0 : m.home_score! < m.away_score! ? 2 : 1;
  const base = [0, 0, 0];
  for (const { m } of graded) base[outcome(m)] += 1;
  const rates = base.map((c) => c / graded.length);

  let correct = 0;
  let brier = 0;
  let baseline = 0;
  let favWins = 0;
  let decisive = 0;
  const upsets: ModelReport["upsets"] = [];
  for (const { p, m } of graded) {
    const probs = [p.home_win_prob, p.draw_prob, p.away_win_prob];
    const o = outcome(m);
    if (probs.indexOf(Math.max(...probs)) === o) correct += 1;
    brier += probs.reduce((t, q, i) => t + (q - (i === o ? 1 : 0)) ** 2, 0);
    baseline += rates.reduce((t, q, i) => t + (q - (i === o ? 1 : 0)) ** 2, 0);

    const pre = preElo[m.id];
    const eh = pre?.[m.home_team_id!]?.before;
    const ea = pre?.[m.away_team_id!]?.before;
    // Winner incl. shootouts, for "did the favourite go through".
    if (eh != null && ea != null && m.home_winner != null && eh !== ea) {
      decisive += 1;
      const favHome = eh > ea;
      if (favHome === m.home_winner) favWins += 1;
      else upsets.push({ match: m, upsetProbability: p.upset_probability });
    }
  }
  upsets.sort((a, b) => a.upsetProbability - b.upsetProbability);
  return {
    n: graded.length,
    accuracy: correct / graded.length,
    brier: brier / graded.length,
    baselineBrier: baseline / graded.length,
    favouriteWinRate: decisive ? favWins / decisive : 0,
    upsets,
  };
}
