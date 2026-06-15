import type { Metadata } from "next";
import Link from "next/link";
import ApiSportsWidget from "@/components/widgets/ApiSportsWidget";
import { widgetsEnabled } from "@/components/widgets/widgets-enabled";
import { getAllMatches, getStoredStandings } from "@/lib/queries";
import { resolveSeason } from "@/lib/season";
import type { MatchWithTeams, StandingsRow, Team } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Standings — World Cup HUB",
};

// ── group tables computed from owned finished group-stage results ────────────

interface TableRow {
  team: Team;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
  form: ("W" | "D" | "L")[];
  hasLive: boolean;
}

function buildGroupTables(matches: MatchWithTeams[]): Map<string, TableRow[]> {
  const rows = new Map<number, TableRow>();
  const groupOf = new Map<number, string>();
  const groupMatches = matches.filter(
    (m) => m.stage === "group" && m.home_team && m.away_team && m.group_letter,
  );

  for (const m of groupMatches) {
    for (const team of [m.home_team!, m.away_team!]) {
      groupOf.set(team.id, m.group_letter!);
      if (!rows.has(team.id)) {
        rows.set(team.id, {
          team,
          played: 0,
          won: 0,
          drawn: 0,
          lost: 0,
          gf: 0,
          ga: 0,
          points: 0,
          form: [],
          hasLive: false,
        });
      }
    }
  }

  const counted = groupMatches
    .filter(
      (m) =>
        (m.status === "finished" || m.status === "live") &&
        m.home_score != null &&
        m.away_score != null,
    )
    .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));

  for (const m of counted) {
    const home = rows.get(m.home_team!.id)!;
    const away = rows.get(m.away_team!.id)!;
    if (m.status === "live") {
      home.hasLive = true;
      away.hasLive = true;
    }
    const hs = m.home_score!;
    const as = m.away_score!;
    home.played += 1;
    away.played += 1;
    home.gf += hs;
    home.ga += as;
    away.gf += as;
    away.ga += hs;
    if (hs > as) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
      home.form.push("W");
      away.form.push("L");
    } else if (hs < as) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
      away.form.push("W");
      home.form.push("L");
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
      home.form.push("D");
      away.form.push("D");
    }
  }

  const groups = new Map<string, TableRow[]>();
  for (const row of rows.values()) {
    const letter = groupOf.get(row.team.id)!;
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(row);
  }
  for (const table of groups.values()) {
    table.sort(
      (a, b) =>
        b.points - a.points ||
        b.gf - b.ga - (a.gf - a.ga) ||
        b.gf - a.gf ||
        a.team.name.localeCompare(b.team.name),
    );
  }
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** Compare computed tables to the stored API standings copy. */
function crossCheck(groups: Map<string, TableRow[]>, stored: StandingsRow[]): string[] {
  const issues: string[] = [];
  const storedById = new Map(stored.map((s) => [s.team_id, s]));
  for (const [letter, table] of groups) {
    table.forEach((row) => {
      // Skip teams currently in a live match — stored standings lag behind live scores.
      if (row.hasLive) return;
      const s = storedById.get(row.team.id);
      if (!s) {
        issues.push(`${row.team.name}: missing from stored standings`);
        return;
      }
      const diffs: string[] = [];
      if (s.points !== row.points) diffs.push(`points ${row.points}≠${s.points}`);
      if (s.played !== row.played) diffs.push(`played ${row.played}≠${s.played}`);
      if (s.goals_diff !== row.gf - row.ga) diffs.push(`GD ${row.gf - row.ga}≠${s.goals_diff}`);
      if (s.group_name && !s.group_name.endsWith(letter)) diffs.push(`group ${letter}≠${s.group_name}`);
      if (diffs.length > 0) issues.push(`${row.team.name}: ${diffs.join(", ")}`);
    });
  }
  return issues;
}

const FORM_STYLE: Record<string, string> = {
  W: "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900",
  D: "bg-neutral-300 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
  L: "bg-neutral-100 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-600",
};

function GroupTable({ letter, rows }: { letter: string; rows: TableRow[] }) {
  const hasAnyLive = rows.some((r) => r.hasLive);
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Group {letter}
        {hasAnyLive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:bg-red-950 dark:text-red-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            Live
          </span>
        )}
      </h2>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="py-1 font-normal">Team</th>
            <th className="py-1 text-right font-normal">P</th>
            <th className="py-1 text-right font-normal">W</th>
            <th className="py-1 text-right font-normal">D</th>
            <th className="py-1 text-right font-normal">L</th>
            <th className="py-1 text-right font-normal">GD</th>
            <th className="py-1 text-right font-normal">Pts</th>
            <th className="py-1 pl-3 text-right font-normal">Form</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team.id} className="border-t border-neutral-100 dark:border-neutral-900">
              <td className="py-1.5">
                <span className={`flex items-center gap-2 ${r.hasLive ? "font-semibold text-red-600 dark:text-red-400" : ""}`}>
                  {r.team.logo_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.team.logo_url} alt="" className="h-4 w-4 object-contain" />
                  )}
                  {r.team.name}
                  {r.hasLive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />}
                </span>
              </td>
              <td className="py-1.5 text-right tabular-nums">{r.played}</td>
              <td className="py-1.5 text-right tabular-nums">{r.won}</td>
              <td className="py-1.5 text-right tabular-nums">{r.drawn}</td>
              <td className="py-1.5 text-right tabular-nums">{r.lost}</td>
              <td className="py-1.5 text-right tabular-nums">{r.gf - r.ga}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums">{r.points}</td>
              <td className="py-1.5 pl-3 text-right">
                <span className="inline-flex gap-0.5">
                  {r.form.map((f, i) => (
                    <span
                      key={i}
                      className={`inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-semibold ${FORM_STYLE[f]}`}
                    >
                      {f}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── knockout bracket ─────────────────────────────────────────────────────────

const KO_STAGES: { stage: string; label: string }[] = [
  { stage: "R32", label: "Round of 32" },
  { stage: "R16", label: "Round of 16" },
  { stage: "QF", label: "Quarter-finals" },
  { stage: "SF", label: "Semi-finals" },
  { stage: "third_place", label: "Third place" },
  { stage: "final", label: "Final" },
];

function BracketTeam({
  team,
  score,
  pens,
  winner,
}: {
  team: Team | null;
  score: number | null;
  pens: number | null;
  winner: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 ${winner ? "font-semibold" : "text-neutral-500"}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {team?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={team.logo_url} alt="" className="h-3.5 w-3.5 object-contain" />
        )}
        <span className="truncate">{team?.name ?? "TBD"}</span>
      </span>
      <span className="tabular-nums">
        {score ?? ""}
        {pens != null && <span className="text-xs text-neutral-400"> ({pens})</span>}
      </span>
    </div>
  );
}

function Bracket({ matches }: { matches: MatchWithTeams[] }) {
  const columns = KO_STAGES.map((s) => ({
    ...s,
    matches: matches
      .filter((m) => m.stage === s.stage)
      .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at)),
  })).filter((c) => c.matches.length > 0);

  if (columns.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Knockout stage
      </h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {columns.map((col) => (
          <div key={col.stage} className="w-52 shrink-0">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {col.label}
            </h3>
            <div className="flex h-full flex-col justify-around gap-3 pb-8">
              {col.matches.map((m) => (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="block space-y-1 rounded-lg border border-neutral-200 p-2 text-sm transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
                >
                  <BracketTeam
                    team={m.home_team}
                    score={m.home_score}
                    pens={m.pen_home}
                    winner={m.home_winner === true}
                  />
                  <BracketTeam
                    team={m.away_team}
                    score={m.away_score}
                    pens={m.pen_away}
                    winner={m.home_winner === false}
                  />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default async function StandingsPage({ searchParams }: PageProps<"/standings">) {
  const sp = await searchParams;
  const season = resolveSeason(sp.season);

  const [matches, stored] = await Promise.all([
    getAllMatches(season),
    getStoredStandings(season),
  ]);
  const groups = buildGroupTables(matches);
  const issues = groups.size > 0 ? crossCheck(groups, stored) : [];
  const hasLiveGroups = [...groups.values()].some((rows) => rows.some((r) => r.hasLive));

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Standings</h1>
        <p className="text-sm text-neutral-500">
          Group tables computed from match results, cross-checked against the official
          standings.{" "}
          <Link href={`/rankings?season=${season}`} className="underline hover:text-neutral-900 dark:hover:text-neutral-100">
            Form rankings
          </Link>{" "}
          are computed separately from match statistics.
        </p>
      </div>

      {issues.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <p className="mb-1 font-semibold">
            Cross-check: computed tables disagree with stored API standings
          </p>
          <ul className="list-inside list-disc">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {groups.size === 0 ? (
        <p className="text-sm text-neutral-500">No group-stage matches found for {season}.</p>
      ) : (
        <>
          <div className="grid gap-8 sm:grid-cols-2">
            {[...groups.entries()].map(([letter, rows]) => (
              <GroupTable key={letter} letter={letter} rows={rows} />
            ))}
          </div>
          {hasLiveGroups && (
            <p className="text-xs text-neutral-400 dark:text-neutral-600">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" />{" "}
              Teams shown in red are currently playing. Their live score is included as a provisional result.
            </p>
          )}
        </>
      )}

      <Bracket matches={matches} />

      {widgetsEnabled && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Official standings widget
          </h2>
          <ApiSportsWidget data-type="standings" data-league="1" data-season={String(season)} />
        </section>
      )}
    </div>
  );
}
