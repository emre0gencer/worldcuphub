import type { Metadata } from "next";
import Link from "next/link";
import EloDelta from "@/components/EloDelta";
import EloSparkline from "@/components/EloSparkline";
import FormBadge from "@/components/FormBadge";
import SectionHeading, { Kicker } from "@/components/SectionHeading";
import FormTrendChart, { type FormTrendSeries } from "@/components/FormTrendChart";
import {
  eloByMatch,
  getAllMatches,
  getEloHistory,
  getFormHistory,
  getLatestForm,
  getLatestPredictions,
  getTeamSeasons,
} from "@/lib/queries";
import { isComplete } from "@/lib/season";
import { getActiveSeason } from "@/lib/season-server";
import { eloPaths, finishingPositions, modelReport } from "@/lib/tournament";
import type { MatchWithTeams, Team, TeamForm, TeamSeason } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rankings — World Cup HUB",
};

function TeamCell({ team, fallback }: { team?: Team; fallback: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {team?.logo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logo_url} alt="" className="h-3.5 w-3.5 object-contain" />
      )}
      <span className="truncate">{team?.name ?? fallback}</span>
    </span>
  );
}

function RankingTable({
  title,
  rows,
  teams,
  teamSeasons,
  value,
}: {
  title: string;
  rows: TeamForm[];
  teams: Map<number, Team>;
  teamSeasons: Map<number, TeamSeason>;
  value: (f: TeamForm) => number;
}) {
  const sorted = [...rows].sort((a, b) => value(b) - value(a)).slice(0, 12);
  return (
    <div>
      <h3 className="eyebrow mb-2.5">{title}</h3>
      <ol className="overflow-hidden rounded-xl border border-border-warm bg-surface shadow-sm">
        {sorted.map((f, i) => {
          const ts = teamSeasons.get(f.team_id);
          return (
            <li
              key={f.team_id}
              className="flex items-center justify-between gap-2 border-b border-border-light px-3 py-2 transition-colors last:border-b-0 hover:bg-surface-warm"
            >
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="w-5 text-right font-mono text-xs tabular-nums text-foil">{i + 1}</span>
                <TeamCell team={teams.get(f.team_id)} fallback={f.team_id} />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted">
                  <EloDelta current={ts?.elo ?? null} initial={ts?.initial_elo ?? null} />
                </span>
                <FormBadge value={value(f)} sampleSize={f.sample_size} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

function scoreline(m: MatchWithTeams): string {
  const pens = m.pen_home != null ? ` (${m.pen_home}–${m.pen_away} p)` : "";
  return `${m.home_team?.name ?? "TBD"} ${m.home_score}–${m.away_score} ${m.away_team?.name ?? "TBD"}${pens}`;
}

export default async function RankingsPage() {
  const season = await getActiveSeason();
  const complete = isComplete(season);
  const [latestForm, matches, predictions, allTeamSeasons, history] = await Promise.all([
    getLatestForm(season),
    getAllMatches(season),
    getLatestPredictions(season),
    getTeamSeasons(season),
    getEloHistory(season),
  ]);
  const teamSeasons = new Map<number, TeamSeason>(allTeamSeasons.map((ts) => [ts.team_id, ts]));

  const teams = new Map<number, Team>();
  for (const m of matches) {
    if (m.home_team) teams.set(m.home_team.id, m.home_team);
    if (m.away_team) teams.set(m.away_team.id, m.away_team);
  }
  const finish = finishingPositions(matches);

  // ── Elo: final table + trajectories (2026; 2022 has no seeded Elo) ────────
  const seeded = allTeamSeasons.filter((ts) => ts.initial_elo != null);
  const seeds = new Map(seeded.map((ts) => [ts.team_id, ts.initial_elo as number]));
  const paths = eloPaths(history, seeds);
  const eloRows = [...seeded].sort((a, b) => b.elo - a.elo);
  const eloTop = eloRows.slice(0, 6);
  const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : "seed");
  const eloSeries: FormTrendSeries[] = eloTop.map((ts) => ({
    teamName: teams.get(ts.team_id)?.name ?? String(ts.team_id),
    points: (paths.get(ts.team_id) ?? []).map((p) => ({
      date: p.kickoffAt ? dayOf(p.kickoffAt) : "2026-06-10",
      value: p.elo,
    })),
  }));

  // ── Form ──────────────────────────────────────────────────────────────────
  const top6 = [...latestForm].sort((a, b) => b.overall_form - a.overall_form).slice(0, 6);
  const formHistory = await getFormHistory(season, top6.map((f) => f.team_id));
  const series: FormTrendSeries[] = top6.map((f) => ({
    teamName: teams.get(f.team_id)?.name ?? String(f.team_id),
    points: formHistory
      .filter((h) => h.team_id === f.team_id)
      .map((h) => ({ date: h.as_of_date, value: h.overall_form })),
  }));

  // ── Predictions: report card (finished) / upset watch (scheduled) ────────
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const report = modelReport(matches, predictions, eloByMatch(history));
  const upsetWatch = predictions
    .filter((p) => matchById.get(p.match_id)?.status === "scheduled")
    .sort((a, b) => b.upset_probability - a.upset_probability)
    .slice(0, 8);
  const lastFormDate = latestForm.map((f) => f.as_of_date).sort().at(-1);

  return (
    <div className="space-y-12">
      <section className="reveal">
        <SectionHeading
          eyebrow={complete ? "Final ratings" : "Form & momentum"}
          title="Rankings"
          standfirst={
            <>
              {seeded.length > 0 && (
                <>
                  Elo is seeded from the official FIFA ranking points (11 Jun 2026) and replayed
                  match by match in kickoff order with the FIFA 2018 formula — the same numbers a
                  worker running at every final whistle would have produced.{" "}
                </>
              )}
              Form Scores are opponent-adjusted and rebuilt matchday by matchday; 50 = tournament
              average.
            </>
          }
        />
      </section>

      {eloRows.length > 0 && (
        <section className="reveal space-y-4" style={{ "--d": "60ms" } as React.CSSProperties}>
          <Kicker>
            Elo{complete ? " — final table" : ""}{" "}
            <span className="text-sm font-normal text-muted">
              — {history.length > 0 ? `${history.length / 2} matches replayed` : "seed → current"}
            </span>
          </Kicker>
          <div className="overflow-x-auto rounded-xl border border-border-warm bg-surface shadow-sm">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border-warm font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">
                  <th className="px-3 py-2 text-right font-normal">#</th>
                  <th className="px-2 py-2 text-left font-normal">Team</th>
                  <th className="px-2 py-2 text-right font-normal">Seed</th>
                  <th className="px-2 py-2 text-left font-normal">Path</th>
                  <th className="px-2 py-2 text-right font-normal">Final</th>
                  <th className="px-3 py-2 text-left font-normal">Went out</th>
                </tr>
              </thead>
              <tbody>
                {eloRows.map((ts, i) => {
                  const f = finish.get(ts.team_id);
                  const path = paths.get(ts.team_id) ?? [];
                  return (
                    <tr key={ts.team_id} className="border-b border-border-light last:border-b-0 hover:bg-surface-warm">
                      <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums text-foil">{i + 1}</td>
                      <td className="px-2 py-1.5">
                        <TeamCell team={teams.get(ts.team_id) ?? ts.team} fallback={ts.team_id} />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-muted">
                        {Math.round(ts.initial_elo as number)}
                      </td>
                      <td className="px-2 py-1.5">
                        <EloSparkline values={path.map((p) => p.elo)} />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <EloDelta current={ts.elo} initial={ts.initial_elo} />
                      </td>
                      <td
                        className={`px-3 py-1.5 text-xs ${
                          f?.tier === 1 ? "font-semibold text-foil" : f && f.tier <= 4 ? "font-semibold text-ink" : "text-muted"
                        }`}
                      >
                        {f?.label ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {eloSeries.some((s) => s.points.length > 1) && (
            <div>
              <h3 className="eyebrow mb-2">Elo trajectory — final top 6</h3>
              <FormTrendChart series={eloSeries} domain={["dataMin - 20", "dataMax + 20"]} decimals={0} />
            </div>
          )}
          <p className="text-xs leading-relaxed text-muted">
            Δ = I·(W − W<sub>e</sub>), W<sub>e</sub> = 1 / (10<sup>−ΔElo/600</sup> + 1); I = 50 in the
            group stage, R32 and R16, 60 from the quarter-finals; shootout wins count 0.75 / 0.5; teams
            can’t lose points in knockout ties. Replayed from the frozen seed on every run, so it is
            idempotent and independent of when live ingestion happened to run.
          </p>
        </section>
      )}

      <section className="reveal space-y-4" style={{ "--d": "100ms" } as React.CSSProperties}>
        <Kicker>
          Form{complete ? " at the final whistle" : ""}{" "}
          {lastFormDate && <span className="text-sm font-normal text-muted">— as of {lastFormDate}</span>}
        </Kicker>
        {latestForm.length === 0 ? (
          <p className="text-sm text-muted">No form data for {season} yet.</p>
        ) : (
          <div className="grid gap-8 md:grid-cols-3">
            <RankingTable title="Overall form" rows={latestForm} teams={teams} teamSeasons={teamSeasons} value={(f) => f.overall_form} />
            <RankingTable title="Attacking form" rows={latestForm} teams={teams} teamSeasons={teamSeasons} value={(f) => f.attacking_form} />
            <RankingTable title="Defending form" rows={latestForm} teams={teams} teamSeasons={teamSeasons} value={(f) => f.defending_form} />
          </div>
        )}
      </section>

      {series.some((s) => s.points.length > 0) && (
        <section className="reveal" style={{ "--d": "160ms" } as React.CSSProperties}>
          <Kicker>
            Form trend <span className="text-sm font-normal text-muted">— top 6, one point per matchday</span>
          </Kicker>
          <FormTrendChart series={series} />
        </section>
      )}

      {report && (
        <section className="reveal space-y-4" style={{ "--d": "200ms" } as React.CSSProperties}>
          <Kicker>
            Model report card{" "}
            <span className="text-sm font-normal text-muted">— pre-match predictions vs. results</span>
          </Kicker>
          <div className="grid grid-cols-2 divide-x divide-y divide-border-light overflow-hidden rounded-xl border border-border-warm bg-surface shadow-sm sm:grid-cols-4 sm:divide-y-0">
            {[
              { v: String(report.n), l: "Matches graded" },
              { v: pct(report.accuracy), l: "Outcome called (H/D/A)" },
              {
                v: report.brier.toFixed(3),
                l: `Brier · base-rate ${report.baselineBrier.toFixed(3)}`,
              },
              { v: pct(report.favouriteWinRate), l: "Elo favourite advanced/won" },
            ].map((s) => (
              <div key={s.l} className="flex flex-col gap-0.5 px-3 py-2.5">
                <span className="font-mono text-xl font-semibold tabular-nums text-ink">{s.v}</span>
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">{s.l}</span>
              </div>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-muted">
            Each prediction uses only what was known before kickoff — Form from the previous matchday
            and the Elo going into the match — so the grading is leak-free. Lower Brier is better; the
            base-rate line always predicts the tournament&apos;s overall home/draw/away frequencies.
          </p>
          {report.upsets.length > 0 && (
            <div>
              <h3 className="eyebrow mb-2.5">Biggest upsets — least expected first</h3>
              <ul className="overflow-hidden rounded-xl border border-border-warm bg-surface shadow-sm">
                {report.upsets.slice(0, 8).map(({ match: m, upsetProbability }) => (
                  <li key={m.id} className="border-b border-border-light last:border-b-0">
                    <Link
                      href={`/matches/${m.id}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-surface-warm"
                    >
                      <span className="min-w-0 truncate">
                        <span className="mr-2 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-foil">
                          {m.stage === "group" ? `Grp ${m.group_letter ?? ""}` : m.stage.replace("_", " ")}
                        </span>
                        {scoreline(m)}
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                        upset odds {pct(upsetProbability)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {upsetWatch.length > 0 && (
        <section className="reveal" style={{ "--d": "220ms" } as React.CSSProperties}>
          <Kicker>Upset watch</Kicker>
          <ul className="overflow-hidden rounded-xl border border-border-warm bg-surface shadow-sm">
            {upsetWatch.map((p) => {
              const m = matchById.get(p.match_id);
              if (!m) return null;
              return (
                <li key={p.match_id} className="border-b border-border-light last:border-b-0">
                  <Link
                    href={`/matches/${m.id}`}
                    className="flex items-center justify-between px-3 py-2 text-sm hover:bg-surface-warm"
                  >
                    <span>
                      {m.home_team?.name ?? "TBD"} vs {m.away_team?.name ?? "TBD"}
                      <span className="ml-2 font-mono text-xs text-muted">
                        {new Date(m.kickoff_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-foil">
                      {pct(p.upset_probability)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
