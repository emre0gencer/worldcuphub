import type { Metadata } from "next";
import Link from "next/link";
import ApiSportsWidget from "@/components/widgets/ApiSportsWidget";
import { widgetsEnabled } from "@/components/widgets/widgets-enabled";
import { getAllMatches } from "@/lib/queries";
import type { MatchWithTeams, Team } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Standings — World Cup HUB",
};

// ── fallback: group tables computed from finished group-stage matches ────────

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
}

function buildGroupTables(matches: MatchWithTeams[]): Map<string, TableRow[]> {
  const rows = new Map<number, TableRow>();
  const groupMatches = matches.filter(
    (m) => m.stage === "group" && m.home_team && m.away_team,
  );

  for (const m of groupMatches) {
    for (const team of [m.home_team!, m.away_team!]) {
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
        });
      }
    }
  }

  const finished = groupMatches
    .filter((m) => m.status === "finished" && m.home_score != null && m.away_score != null)
    .sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));

  for (const m of finished) {
    const home = rows.get(m.home_team!.id)!;
    const away = rows.get(m.away_team!.id)!;
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
    const letter = row.team.group_letter;
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

const FORM_STYLE: Record<string, string> = {
  W: "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900",
  D: "bg-neutral-300 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
  L: "bg-neutral-100 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-600",
};

function GroupTable({ letter, rows }: { letter: string; rows: TableRow[] }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Group {letter}
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
                <span className="flex items-center gap-2">
                  {r.team.flag_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.team.flag_url} alt="" className="h-3.5 w-5 rounded-sm object-cover" />
                  )}
                  {r.team.name}
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

// ── page ─────────────────────────────────────────────────────────────────────

export default async function StandingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Standings</h1>
        <p className="text-sm text-neutral-500">
          Group tables for the 2026 FIFA World Cup.{" "}
          <Link href="/rankings" className="underline hover:text-neutral-900 dark:hover:text-neutral-100">
            Form rankings
          </Link>{" "}
          are computed separately from match statistics.
        </p>
      </div>

      {widgetsEnabled ? (
        // Official standings with recent form, team modals on click
        <ApiSportsWidget data-type="standings" data-league="1" data-season="2026" />
      ) : (
        <FallbackStandings />
      )}
    </div>
  );
}

async function FallbackStandings() {
  const matches = await getAllMatches();
  const groups = buildGroupTables(matches);

  if (groups.size === 0) {
    return <p className="text-sm text-neutral-500">No group-stage matches found.</p>;
  }

  return (
    <div className="grid gap-8 sm:grid-cols-2">
      {[...groups.entries()].map(([letter, rows]) => (
        <GroupTable key={letter} letter={letter} rows={rows} />
      ))}
    </div>
  );
}
