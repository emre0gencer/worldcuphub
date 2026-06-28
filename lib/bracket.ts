// Knockout-bracket model builder (server-safe, pure over already-fetched rows).
//
// The API-Football feed only carries a knockout fixture once its pairing is
// known. For 2026 that means the 16 Round-of-32 ties exist (group stage is
// done) but R16 → Final do not yet. A real bracket needs the *tree topology*
// (which tie feeds which) up front, and that topology is external structural
// knowledge — not something the feed provides — so it lives here as a fixed,
// verified table. As later rounds get ingested they slot in automatically:
// each internal node resolves its participants from the winners of its two
// children, then binds to the real DB fixture by team-set when one appears.

import type { MatchWithTeams, StandingsRow, Stage, Team } from "./types";

// ── canonical 2026 structure ────────────────────────────────────────────────
// R32 leaves in top→bottom bracket order. Each leaf is the pair of group-finish
// slots that meet (e.g. "1E" = winner of Group E, "3D" = 3rd of Group D).
// Order + slots verified against the final 2026 group standings (2026-06-28);
// FIFA match numbers in comments. The tree is a perfect binary fold of these:
// leaves (2j, 2j+1) → R16 j → QF ⌊j/2⌋ → SF → Final.
const R32_SLOTS_2026: [string, string][] = [
  ["1E", "3D"], // M74
  ["1I", "3F"], // M77
  ["2A", "2B"], // M73
  ["1F", "2C"], // M75
  ["2K", "2L"], // M83
  ["1H", "2J"], // M84
  ["1D", "3B"], // M81
  ["1G", "3I"], // M82
  ["1C", "2F"], // M76
  ["2E", "2I"], // M78
  ["1A", "3E"], // M79
  ["1L", "3K"], // M80
  ["1J", "2H"], // M86
  ["2D", "2G"], // M88
  ["1B", "3J"], // M85
  ["1K", "3L"], // M87
];

// R16 leaves in top→bottom bracket order for the 2022 (32-team) format, which
// opens at the Round of 16. Slots verified against the final 2022 standings; the
// fold (winners → QF → SF → Final) was cross-checked against the actual results.
const R16_SLOTS_2022: [string, string][] = [
  ["1A", "2B"], // Netherlands v USA
  ["1C", "2D"], // Argentina v Australia
  ["1E", "2F"], // Japan v Croatia
  ["1G", "2H"], // Brazil v South Korea
  ["1F", "2E"], // Morocco v Spain
  ["1H", "2G"], // Portugal v Switzerland
  ["1B", "2A"], // England v Senegal
  ["1D", "2C"], // France v Poland
];

export type BracketRoundKey = "R32" | "R16" | "QF" | "SF" | "final";

interface SeasonBracket {
  rounds: BracketRoundKey[]; // leaf round first → "final" last
  leafSlots: [string, string][]; // group-finish slot pairs for the leaf round
}

// The leaf round differs by era: the 48-team 2026 format opens at the Round of
// 32, the 32-team 2022 format at the Round of 16. Everything above the leaves is
// the same perfect binary fold.
const SEASON_BRACKETS: Record<number, SeasonBracket> = {
  2026: { rounds: ["R32", "R16", "QF", "SF", "final"], leafSlots: R32_SLOTS_2026 },
  2022: { rounds: ["R16", "QF", "SF", "final"], leafSlots: R16_SLOTS_2022 },
};

/** Seasons for which a canonical leaf order is encoded (drives the fancy tree). */
export function hasBracketStructure(season: number): boolean {
  return season in SEASON_BRACKETS;
}

const ROUND_LABEL: Record<string, string> = {
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-finals",
  SF: "Semi-finals",
  final: "Final",
  third_place: "Third place",
};

// ── serializable shapes handed to the client component ──────────────────────

export type SlotStatus = "team" | "feeder" | "empty";

export interface BracketSlot {
  teamId: number | null;
  name: string | null;
  logoUrl: string | null;
  label: string; // group slot ("1E"), feeder hint ("GER / PAR"), or "TBD"
  score: number | null;
  pens: number | null;
  winner: boolean;
}

export interface BracketMatchNode {
  id: string; // stable node id, e.g. "R16-3" — also used for connector refs
  round: BracketRoundKey;
  matchId: number | null; // DB fixture id once it exists (clickable)
  status: "scheduled" | "live" | "finished" | "empty";
  kickoff: string | null;
  home: BracketSlot;
  away: BracketSlot;
}

export interface BracketRound {
  key: BracketRoundKey;
  label: string;
  matches: BracketMatchNode[];
}

export interface GameLine {
  matchId: number;
  kickoff: string;
  stageLabel: string;
  oppName: string;
  oppLogo: string | null;
  teamScore: number | null;
  oppScore: number | null;
  pens: string | null; // "(4-2)" when a shootout decided it
  result: "W" | "D" | "L" | null;
  live: boolean;
}

export interface BracketData {
  rounds: BracketRound[]; // leaf round → Final
  champion: BracketSlot | null;
  finalistHint: string | null; // shown on the plinth before the final is played
  thirdPlace: BracketMatchNode | null; // played-off 3rd place (e.g. 2022), if any
  recentGames: Record<number, GameLine[]>; // teamId → newest-first tournament log
}

// ── helpers ─────────────────────────────────────────────────────────────────

function abbr(team: Team | undefined | null): string {
  if (!team) return "—";
  const cc = team.country_code?.trim();
  if (cc && cc.length === 3) return cc.toUpperCase();
  return team.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "—";
}

function stageLabel(stage: Stage, groupLetter: string | null): string {
  if (stage === "group") return `Group ${groupLetter ?? ""}`.trim();
  return ROUND_LABEL[stage as BracketRoundKey] ?? stage.toUpperCase();
}

/** Newest-first compact log of one team's played (finished/live) ties. */
function buildTeamLog(teamId: number, matches: MatchWithTeams[]): GameLine[] {
  return matches
    .filter(
      (m) =>
        (m.home_team_id === teamId || m.away_team_id === teamId) &&
        (m.status === "finished" || m.status === "live") &&
        m.home_score != null &&
        m.away_score != null,
    )
    .sort((a, b) => b.kickoff_at.localeCompare(a.kickoff_at))
    .map((m) => {
      const isHome = m.home_team_id === teamId;
      const teamScore = isHome ? m.home_score : m.away_score;
      const oppScore = isHome ? m.away_score : m.home_score;
      const opp = isHome ? m.away_team : m.home_team;
      const penA = isHome ? m.pen_home : m.pen_away;
      const penB = isHome ? m.pen_away : m.pen_home;
      const result: GameLine["result"] =
        m.status === "live" || teamScore == null || oppScore == null
          ? null
          : teamScore > oppScore
            ? "W"
            : teamScore < oppScore
              ? "L"
              : "D";
      return {
        matchId: m.id,
        kickoff: m.kickoff_at,
        stageLabel: stageLabel(m.stage, m.group_letter),
        oppName: opp?.name ?? "TBD",
        oppLogo: opp?.logo_url ?? null,
        teamScore,
        oppScore,
        pens: penA != null && penB != null ? `(${penA}-${penB})` : null,
        result,
        live: m.status === "live",
      };
    });
}

interface BuildNode extends BracketMatchNode {
  homeTeamId: number | null;
  awayTeamId: number | null;
  winnerTeamId: number | null;
}

/**
 * Assemble the full knockout tree for a season, or `null` when no canonical
 * structure is encoded for it (callers fall back to a plain column view).
 */
export function buildKnockoutBracket(
  season: number,
  matches: MatchWithTeams[],
  standings: StandingsRow[],
): BracketData | null {
  const config = SEASON_BRACKETS[season];
  if (!config) return null;
  const leafRound = config.rounds[0];

  // group-slot ("1E") → Team, from the (cross-checked) stored standings.
  const slotTeam = new Map<string, Team>();
  const teamById = new Map<number, Team>();
  for (const r of standings) {
    if (r.team) teamById.set(r.team_id, r.team);
    if (r.rank != null && r.group_name && r.team) {
      slotTeam.set(`${r.rank}${r.group_name.replace("Group ", "").trim()}`, r.team);
    }
  }
  for (const m of matches) {
    if (m.home_team) teamById.set(m.home_team.id, m.home_team);
    if (m.away_team) teamById.set(m.away_team.id, m.away_team);
  }

  // KO fixtures keyed by unordered team pair, so we can bind a node to its real
  // fixture no matter which side the API listed as "home".
  const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const matchByPairKey = new Map<string, MatchWithTeams>();
  for (const m of matches) {
    if (m.stage === "group") continue;
    if (m.home_team_id != null && m.away_team_id != null) {
      matchByPairKey.set(pairKey(m.home_team_id, m.away_team_id), m);
    }
  }

  const winnerOf = (m: MatchWithTeams): number | null => {
    if (m.status !== "finished") return null;
    if (m.home_winner === true) return m.home_team_id;
    if (m.home_winner === false) return m.away_team_id;
    return null;
  };

  const slotFor = (
    m: MatchWithTeams | null,
    teamId: number | null,
    fallbackLabel: string,
  ): BracketSlot => {
    const team = teamId != null ? teamById.get(teamId) : null;
    let score: number | null = null;
    let pens: number | null = null;
    let winner = false;
    if (m && teamId != null) {
      const isHome = m.home_team_id === teamId;
      score = isHome ? m.home_score : m.away_score;
      pens = isHome ? m.pen_home : m.pen_away;
      winner = winnerOf(m) === teamId;
    }
    return {
      teamId: teamId ?? null,
      name: team?.name ?? null,
      logoUrl: team?.logo_url ?? null,
      label: fallbackLabel,
      score,
      pens,
      winner,
    };
  };

  // ── level 0: the leaf round (R32 in 2026, R16 in 2022) ───────────────────
  const levels: BuildNode[][] = [];
  const leaves: BuildNode[] = config.leafSlots.map(([homeSlot, awaySlot], i) => {
    const homeTeam = slotTeam.get(homeSlot) ?? null;
    const awayTeam = slotTeam.get(awaySlot) ?? null;
    const match =
      homeTeam && awayTeam
        ? (matchByPairKey.get(pairKey(homeTeam.id, awayTeam.id)) ?? null)
        : null;
    const home = slotFor(match, homeTeam?.id ?? null, homeSlot);
    const away = slotFor(match, awayTeam?.id ?? null, awaySlot);
    return {
      id: `${leafRound}-${i}`,
      round: leafRound,
      matchId: match?.id ?? null,
      status: match ? match.status : homeTeam && awayTeam ? "scheduled" : "empty",
      kickoff: match?.kickoff_at ?? null,
      home,
      away,
      homeTeamId: homeTeam?.id ?? null,
      awayTeamId: awayTeam?.id ?? null,
      winnerTeamId: match ? winnerOf(match) : null,
    };
  });
  levels.push(leaves);

  // ── upper levels: fold winners upward to the final ───────────────────────
  const feederHint = (child: BuildNode): { label: string; teamId: number | null } => {
    // The participant is the winner of `child`; show it once decided, else a
    // hint of the two teams that could arrive (only meaningful one round down).
    if (child.winnerTeamId != null) return { label: "", teamId: child.winnerTeamId };
    if (child.homeTeamId != null && child.awayTeamId != null) {
      return {
        label: `${abbr(teamById.get(child.homeTeamId))} / ${abbr(teamById.get(child.awayTeamId))}`,
        teamId: null,
      };
    }
    return { label: "TBD", teamId: null };
  };

  for (let L = 1; L < config.rounds.length; L++) {
    const round = config.rounds[L];
    const prev = levels[L - 1];
    const nodes: BuildNode[] = [];
    for (let j = 0; j < prev.length / 2; j++) {
      const c0 = prev[2 * j];
      const c1 = prev[2 * j + 1];
      const top = feederHint(c0);
      const bot = feederHint(c1);
      const match =
        top.teamId != null && bot.teamId != null
          ? (matchByPairKey.get(pairKey(top.teamId, bot.teamId)) ?? null)
          : null;
      const home = slotFor(match, top.teamId, top.label || "—");
      const away = slotFor(match, bot.teamId, bot.label || "—");
      nodes.push({
        id: `${round}-${j}`,
        round,
        matchId: match?.id ?? null,
        status: match
          ? match.status
          : top.teamId != null && bot.teamId != null
            ? "scheduled"
            : "empty",
        kickoff: match?.kickoff_at ?? null,
        home,
        away,
        homeTeamId: top.teamId,
        awayTeamId: bot.teamId,
        winnerTeamId: match ? winnerOf(match) : null,
      });
    }
    levels.push(nodes);
  }

  const rounds: BracketRound[] = levels.map((nodes, L) => ({
    key: config.rounds[L],
    label: ROUND_LABEL[config.rounds[L]],
    matches: nodes.map((n) => ({
      id: n.id,
      round: n.round,
      matchId: n.matchId,
      status: n.status,
      kickoff: n.kickoff,
      home: n.home,
      away: n.away,
    })),
  }));

  // champion / finalist hint for the plinth
  const finalNode = levels[levels.length - 1][0];
  let champion: BracketSlot | null = null;
  if (finalNode.winnerTeamId != null) {
    const t = teamById.get(finalNode.winnerTeamId);
    champion = {
      teamId: finalNode.winnerTeamId,
      name: t?.name ?? null,
      logoUrl: t?.logo_url ?? null,
      label: "Champions",
      score: null,
      pens: null,
      winner: true,
    };
  }
  const finalistHint =
    finalNode.homeTeamId != null && finalNode.awayTeamId != null
      ? `${abbr(teamById.get(finalNode.homeTeamId))} v ${abbr(teamById.get(finalNode.awayTeamId))}`
      : null;

  // third-place play-off (2022 has one; 2026 will eventually). Bound straight to
  // its fixture rather than folded from the tree.
  const tp =
    matches.find(
      (m) => m.stage === "third_place" && m.home_team_id != null && m.away_team_id != null,
    ) ?? null;
  const thirdPlace: BracketMatchNode | null = tp
    ? {
        id: "third_place",
        round: "final", // not a real round key — unused for rendering
        matchId: tp.id,
        status: tp.status,
        kickoff: tp.kickoff_at,
        home: slotFor(tp, tp.home_team_id, ""),
        away: slotFor(tp, tp.away_team_id, ""),
      }
    : null;

  // recent-game logs for every team currently placed in the bracket
  const placed = new Set<number>();
  for (const lvl of levels)
    for (const n of lvl) {
      if (n.homeTeamId != null) placed.add(n.homeTeamId);
      if (n.awayTeamId != null) placed.add(n.awayTeamId);
    }
  if (tp?.home_team_id != null) placed.add(tp.home_team_id);
  if (tp?.away_team_id != null) placed.add(tp.away_team_id);
  const recentGames: Record<number, GameLine[]> = {};
  for (const teamId of placed) recentGames[teamId] = buildTeamLog(teamId, matches);

  return { rounds, champion, finalistHint, thirdPlace, recentGames };
}
