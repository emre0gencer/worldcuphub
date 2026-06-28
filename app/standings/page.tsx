import type { Metadata } from "next";
import Link from "next/link";
import KnockoutBracket from "@/components/KnockoutBracket";
import SectionHeading, { Kicker } from "@/components/SectionHeading";
import { buildKnockoutBracket } from "@/lib/bracket";
import { getAllMatches, getStoredStandings } from "@/lib/queries";
import { getActiveSeason } from "@/lib/season-server";
import type { MatchWithTeams, Team } from "@/lib/types";

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


const FORM_STYLE: Record<string, string> = {
  W: "bg-pitch text-white",
  D: "bg-neutral-300 text-neutral-700",
  L: "bg-surface-warm text-muted",
};

function GroupTable({ letter, rows }: { letter: string; rows: TableRow[] }) {
  const hasAnyLive = rows.some((r) => r.hasLive);
  return (
    <section className="rounded-xl border border-border-warm bg-surface p-4 shadow-sm">
      <h2 className="mb-2.5 flex items-baseline gap-2">
        <span className="font-display text-lg font-bold tracking-tight text-ink">
          Group {letter}
        </span>
        {hasAnyLive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-red-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            Live
          </span>
        )}
      </h2>
      <table className="w-full text-sm">
        <thead className="text-left font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted">
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
            <tr key={r.team.id} className="border-t border-border-light">
              <td className="py-1.5">
                <span className={`flex items-center gap-2 ${r.hasLive ? "font-semibold text-red-600" : ""}`}>
                  {r.team.logo_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.team.logo_url} alt="" className="h-4 w-4 object-contain" />
                  )}
                  {r.team.name}
                  {r.hasLive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />}
                </span>
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums">{r.played}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">{r.won}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">{r.drawn}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">{r.lost}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">{r.gf - r.ga}</td>
              <td className="py-1.5 text-right font-mono font-semibold tabular-nums text-ink">{r.points}</td>
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
      className={`flex items-center justify-between gap-2 ${winner ? "font-semibold" : "text-muted"}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {team?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={team.logo_url} alt="" className="h-3.5 w-3.5 object-contain" />
        )}
        <span className="truncate">{team?.name ?? "TBD"}</span>
      </span>
      <span className="font-mono tabular-nums">
        {score ?? ""}
        {pens != null && <span className="text-xs text-muted"> ({pens})</span>}
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
      <Kicker>Knockout stage</Kicker>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {columns.map((col) => (
          <div key={col.stage} className="w-52 shrink-0">
            <h3 className="eyebrow mb-2.5">{col.label}</h3>
            <div className="flex h-full flex-col justify-around gap-3 pb-8">
              {col.matches.map((m) => (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="block space-y-1 rounded-lg border border-border-warm bg-surface p-2.5 text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:border-foil hover:shadow-md"
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

export default async function StandingsPage() {
  const season = await getActiveSeason();

  const [matches, standings] = await Promise.all([
    getAllMatches(season),
    getStoredStandings(season),
  ]);
  const groups = buildGroupTables(matches);
  const hasLiveGroups = [...groups.values()].some((rows) => rows.some((r) => r.hasLive));
  const bracket = buildKnockoutBracket(season, matches, standings);

  // The group tables, shared by both layouts (renamed "Group stage" section).
  const groupSection =
    groups.size === 0 ? (
      <p className="text-sm text-muted">No group-stage matches found for {season}.</p>
    ) : (
      <>
        <div
          className="reveal grid gap-5 sm:grid-cols-2"
          style={{ "--d": "80ms" } as React.CSSProperties}
        >
          {[...groups.entries()].map(([letter, rows]) => (
            <GroupTable key={letter} letter={letter} rows={rows} />
          ))}
        </div>
        {hasLiveGroups && (
          <p className="mt-4 text-xs text-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" />{" "}
            Teams shown in red are currently playing. Their live score is included as a provisional
            result.
          </p>
        )}
      </>
    );

  // ── knockout bracket leads, group stage scrolls below ─────────────────────
  if (bracket) {
    const koTeams = (bracket.rounds[0]?.matches.length ?? 0) * 2;
    return (
      <div className="space-y-14">
        <div className="reveal">
          <SectionHeading
            eyebrow="Knockout stage"
            title="The Bracket"
            standfirst={
              <>
                {koTeams} teams, one trophy — the complete route to the final. Hover any team for
                their tournament so far, or open a tie for the full match page.{" "}
                <Link
                  href="/rankings"
                  className="text-foil underline decoration-foil/40 underline-offset-2 transition-colors hover:text-ink"
                >
                  Form rankings
                </Link>{" "}
                are computed separately.
              </>
            }
          />
        </div>

        <KnockoutBracket data={bracket} />

        <div className="hairline" />

        <section>
          <div className="reveal mb-6">
            <SectionHeading as="h2" eyebrow="Final tables" title="Group stage" />
          </div>
          {groupSection}
        </section>
      </div>
    );
  }

  // ── other seasons: original group-first layout + simple column bracket ────
  return (
    <div className="space-y-12">
      <div className="reveal">
        <SectionHeading
          eyebrow="Group stage &amp; bracket"
          title="Standings"
          standfirst={
            <>
              Group tables computed from match results, cross-checked against the official
              standings.{" "}
              <Link
                href="/rankings"
                className="text-foil underline decoration-foil/40 underline-offset-2 transition-colors hover:text-ink"
              >
                Form rankings
              </Link>{" "}
              are computed separately from match statistics.
            </>
          }
        />
      </div>

      {groupSection}

      <div className="reveal" style={{ "--d": "160ms" } as React.CSSProperties}>
        <Bracket matches={matches} />
      </div>
    </div>
  );
}
