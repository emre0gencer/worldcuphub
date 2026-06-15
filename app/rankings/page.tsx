import Link from "next/link";
import EloDelta from "@/components/EloDelta";
import FormBadge from "@/components/FormBadge";
import FormTrendChart, { type FormTrendSeries } from "@/components/FormTrendChart";
import {
  getAllMatches,
  getFormHistory,
  getLatestForm,
  getLatestPredictions,
  getTeamSeasons,
} from "@/lib/queries";
import { resolveSeason } from "@/lib/season";
import type { Team, TeamForm, TeamSeason } from "@/lib/types";

export const dynamic = "force-dynamic";

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
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      <ol className="rounded-xl border border-neutral-200 dark:border-neutral-800">
        {sorted.map((f, i) => {
          const team = teams.get(f.team_id);
          const ts = teamSeasons.get(f.team_id);
          return (
            <li
              key={f.team_id}
              className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2 last:border-b-0 dark:border-neutral-900"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-5 text-right text-xs tabular-nums text-neutral-400">{i + 1}</span>
                {team?.logo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={team.logo_url} alt="" className="h-3.5 w-3.5 object-contain" />
                )}
                <span className="truncate text-sm">{team?.name ?? f.team_id}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-neutral-400">
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

export default async function RankingsPage({ searchParams }: PageProps<"/rankings">) {
  const sp = await searchParams;
  const season = resolveSeason(sp.season);
  const [latestForm, matches, predictions, allTeamSeasons] = await Promise.all([
    getLatestForm(season),
    getAllMatches(season),
    getLatestPredictions(season),
    getTeamSeasons(season),
  ]);
  const teamSeasons = new Map<number, TeamSeason>(allTeamSeasons.map((ts) => [ts.team_id, ts]));

  const teams = new Map<number, Team>();
  for (const m of matches) {
    if (m.home_team) teams.set(m.home_team.id, m.home_team);
    if (m.away_team) teams.set(m.away_team.id, m.away_team);
  }

  // Trend chart: form history of the current top 6 overall
  const top6 = [...latestForm].sort((a, b) => b.overall_form - a.overall_form).slice(0, 6);
  const history = await getFormHistory(season, top6.map((f) => f.team_id));
  const series: FormTrendSeries[] = top6.map((f) => ({
    teamName: teams.get(f.team_id)?.name ?? String(f.team_id),
    points: history
      .filter((h) => h.team_id === f.team_id)
      .map((h) => ({ date: h.as_of_date, value: h.overall_form })),
  }));

  // Upset watch: scheduled matches ranked by upset probability
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const upsetWatch = predictions
    .filter((p) => matchById.get(p.match_id)?.status === "scheduled")
    .sort((a, b) => b.upset_probability - a.upset_probability)
    .slice(0, 8);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="mb-1 text-xl font-bold">Form rankings</h1>
        <p className="text-sm text-neutral-500">
          Opponent-adjusted Form Scores, recomputed each matchday. 50 = tournament average;
          small sample sizes (n&lt;3) are noisy.
        </p>
      </section>

      {latestForm.length === 0 && (
        <p className="text-sm text-neutral-500">No form data for {season} yet.</p>
      )}

      <div className="grid gap-8 md:grid-cols-3">
        <RankingTable title="Overall form" rows={latestForm} teams={teams} teamSeasons={teamSeasons} value={(f) => f.overall_form} />
        <RankingTable title="Attacking form" rows={latestForm} teams={teams} teamSeasons={teamSeasons} value={(f) => f.attacking_form} />
        <RankingTable title="Defending form" rows={latestForm} teams={teams} teamSeasons={teamSeasons} value={(f) => f.defending_form} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Form trend — top 6
        </h2>
        <FormTrendChart series={series} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Upset watch
        </h2>
        <ul className="rounded-xl border border-neutral-200 dark:border-neutral-800">
          {upsetWatch.map((p) => {
            const m = matchById.get(p.match_id);
            if (!m) return null;
            return (
              <li key={p.match_id} className="border-b border-neutral-100 last:border-b-0 dark:border-neutral-900">
                <Link
                  href={`/matches/${m.id}`}
                  className="flex items-center justify-between px-3 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <span>
                    {m.home_team?.name ?? "TBD"} vs {m.away_team?.name ?? "TBD"}
                    <span className="ml-2 text-xs text-neutral-400">
                      {new Date(m.kickoff_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {(p.upset_probability * 100).toFixed(0)}%
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
