import { notFound } from "next/navigation";
import MomentumChart, { type MomentumPoint } from "@/components/MomentumChart";
import StatBar from "@/components/StatBar";
import ApiSportsWidget from "@/components/widgets/ApiSportsWidget";
import { widgetsEnabled } from "@/components/widgets/widgets-enabled";
import {
  getFormForTeams,
  getLatestPrediction,
  getMatch,
  getPlayerMatchStats,
  getPriorMeetings,
  getSnapshotSeries,
  getTeamMatchStats,
  snapshotStat,
} from "@/lib/queries";
import type { MatchWithTeams, Team } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  group: "Group stage",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  final: "Final",
};

function Flag({ team, size = "h-6 w-9" }: { team: Team | null; size?: string }) {
  if (!team?.flag_url) return <span className={`${size} rounded bg-neutral-200 dark:bg-neutral-800`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={team.flag_url} alt={team.name} className={`${size} rounded object-cover`} />;
}

function MatchHeader({ match }: { match: MatchWithTeams }) {
  const kickoff = new Date(match.kickoff_at);
  return (
    <div className="rounded-2xl border border-neutral-200 p-6 text-center dark:border-neutral-800">
      <p className="mb-4 text-xs uppercase tracking-wide text-neutral-500">
        {match.stage === "group" && match.group_letter
          ? `Group ${match.group_letter}`
          : STAGE_LABEL[match.stage]}
        {match.venue ? ` · ${match.venue}` : ""}
      </p>
      <div className="flex items-center justify-center gap-6">
        <div className="flex w-40 flex-col items-center gap-2">
          <Flag team={match.home_team} />
          <span className="font-semibold">{match.home_team?.name ?? "TBD"}</span>
        </div>
        <div className="w-28">
          {match.status === "scheduled" ? (
            <div className="text-lg font-semibold tabular-nums">
              {kickoff.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              <div className="text-xs font-normal text-neutral-500">
                {kickoff.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </div>
            </div>
          ) : (
            <div className="text-4xl font-bold tabular-nums">
              {match.home_score} – {match.away_score}
            </div>
          )}
          {match.status === "live" && (
            <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-red-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" /> LIVE
            </span>
          )}
          {match.status === "finished" && (
            <span className="text-xs text-neutral-500">Full time</span>
          )}
        </div>
        <div className="flex w-40 flex-col items-center gap-2">
          <Flag team={match.away_team} />
          <span className="font-semibold">{match.away_team?.name ?? "TBD"}</span>
        </div>
      </div>
    </div>
  );
}

// ── scheduled ────────────────────────────────────────────────────────────────

async function ScheduledView({ match }: { match: MatchWithTeams }) {
  const home = match.home_team;
  const away = match.away_team;
  if (!home || !away) {
    return <p className="text-sm text-neutral-500">Teams will be decided by the previous round.</p>;
  }
  const [forms, prediction, priorMeetings] = await Promise.all([
    getFormForTeams([home.id, away.id]),
    getLatestPrediction(match.id),
    getPriorMeetings(home.id, away.id),
  ]);
  const homeForm = forms.get(home.id);
  const awayForm = forms.get(away.id);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Head to head
        </h2>
        <div className="rounded-xl border border-neutral-200 px-4 dark:border-neutral-800">
          <StatBar label="FIFA ranking" home={home.fifa_ranking} away={away.fifa_ranking} />
          <StatBar label="Elo" home={Math.round(home.elo)} away={Math.round(away.elo)} />
          {homeForm && awayForm && (
            <>
              <StatBar label="Overall form" home={homeForm.overall_form} away={awayForm.overall_form} format={(v) => v.toFixed(1)} />
              <StatBar label="Attacking form" home={homeForm.attacking_form} away={awayForm.attacking_form} format={(v) => v.toFixed(1)} />
              <StatBar label="Defending form" home={homeForm.defending_form} away={awayForm.defending_form} format={(v) => v.toFixed(1)} />
            </>
          )}
        </div>
        {homeForm && awayForm && (homeForm.sample_size < 3 || awayForm.sample_size < 3) && (
          <p className="mt-2 text-xs text-neutral-400">
            Form based on {homeForm.sample_size} / {awayForm.sample_size} matches — early-tournament estimates are noisy.
          </p>
        )}
      </section>

      {prediction && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Prediction <span className="font-normal normal-case">({prediction.model_version})</span>
          </h2>
          <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="mb-1 flex justify-between text-sm font-semibold tabular-nums">
              <span>{home.name} {(prediction.home_win_prob * 100).toFixed(0)}%</span>
              <span className="text-neutral-500">Draw {(prediction.draw_prob * 100).toFixed(0)}%</span>
              <span>{away.name} {(prediction.away_win_prob * 100).toFixed(0)}%</span>
            </div>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
              <div className="bg-neutral-900 dark:bg-neutral-100" style={{ width: `${prediction.home_win_prob * 100}%` }} />
              <div className="bg-neutral-400" style={{ width: `${prediction.draw_prob * 100}%` }} />
              <div className="bg-neutral-300 dark:bg-neutral-700" style={{ width: `${prediction.away_win_prob * 100}%` }} />
            </div>
            <div className="mt-3 flex justify-between text-xs text-neutral-500">
              <span>
                Expected goals: {prediction.predicted_home_goals?.toFixed(1)} – {prediction.predicted_away_goals?.toFixed(1)}
              </span>
              <span>Upset probability: {(prediction.upset_probability * 100).toFixed(0)}%</span>
            </div>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Prior meetings
        </h2>
        {widgetsEnabled ? (
          // Official historical head-to-head (all-time, via API-Sports widget)
          <ApiSportsWidget data-type="h2h" data-h2h={`${home.id}-${away.id}`} />
        ) : priorMeetings.length === 0 ? (
          <p className="text-sm text-neutral-500">No previous meetings in this tournament.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {priorMeetings.map((m) => (
              <li key={m.id} className="tabular-nums">
                {new Date(m.kickoff_at).toLocaleDateString()} — {m.home_team_id === home.id ? home.name : away.name}{" "}
                {m.home_score} – {m.away_score} {m.away_team_id === away.id ? away.name : home.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── live ─────────────────────────────────────────────────────────────────────

async function LiveView({ match }: { match: MatchWithTeams }) {
  const home = match.home_team!;
  const away = match.away_team!;
  const snapshots = await getSnapshotSeries(match.id);
  const latest = snapshots.at(-1);

  const stat = (type: string, teamId: number) =>
    latest ? snapshotStat(latest.payload.statistics, teamId, type) : null;

  const momentum = (type: string): MomentumPoint[] =>
    snapshots.map((s) => ({
      minute: s.elapsed_minute ?? 0,
      home: snapshotStat(s.payload.statistics, home.id, type) ?? 0,
      away: snapshotStat(s.payload.statistics, away.id, type) ?? 0,
    }));

  return (
    <div className="space-y-8">
      {widgetsEnabled ? (
        // Official live view: events, lineups, team + player statistics
        <ApiSportsWidget data-type="game" data-game-id={String(match.id)} data-game-tab="statistics" />
      ) : !latest ? (
        <p className="text-sm text-neutral-500">Waiting for the first live snapshot…</p>
      ) : (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Live stats · minute {latest.elapsed_minute ?? "–"}
          </h2>
          <div className="rounded-xl border border-neutral-200 px-4 dark:border-neutral-800">
            <StatBar label="Possession" home={stat("Ball Possession", home.id)} away={stat("Ball Possession", away.id)} format={(v) => `${v.toFixed(0)}%`} />
            <StatBar label="xG" home={stat("expected_goals", home.id)} away={stat("expected_goals", away.id)} format={(v) => v.toFixed(2)} />
            <StatBar label="Shots" home={stat("Total Shots", home.id)} away={stat("Total Shots", away.id)} />
            <StatBar label="On target" home={stat("Shots on Goal", home.id)} away={stat("Shots on Goal", away.id)} />
            <StatBar label="Corners" home={stat("Corner Kicks", home.id)} away={stat("Corner Kicks", away.id)} />
            <StatBar label="Fouls" home={stat("Fouls", home.id)} away={stat("Fouls", away.id)} />
          </div>
        </section>
      )}

      {/* Momentum charts always come from the Track 1 snapshot pipeline */}
      {snapshots.length > 0 && (
        <section className="grid gap-8 sm:grid-cols-2">
          <MomentumChart title="Shots momentum" data={momentum("Total Shots")} homeName={home.name} awayName={away.name} />
          <MomentumChart title="xG momentum" data={momentum("expected_goals")} homeName={home.name} awayName={away.name} />
        </section>
      )}
    </div>
  );
}

// ── finished ─────────────────────────────────────────────────────────────────

async function FinishedView({ match }: { match: MatchWithTeams }) {
  const home = match.home_team!;
  const away = match.away_team!;

  if (widgetsEnabled) {
    // Official post-match view: events, lineups, team + player statistics.
    // Skips the Supabase fetches entirely — Track 2 data still powers /rankings.
    return (
      <ApiSportsWidget
        data-type="game"
        data-game-id={String(match.id)}
        data-game-tab="statistics"
      />
    );
  }

  const [teamStats, playerStats] = await Promise.all([
    getTeamMatchStats(match.id),
    getPlayerMatchStats(match.id),
  ]);
  const hs = teamStats.find((s) => s.team_id === home.id);
  const as = teamStats.find((s) => s.team_id === away.id);

  return (
    <div className="space-y-8">
      {hs && as && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Match stats
          </h2>
          <div className="rounded-xl border border-neutral-200 px-4 dark:border-neutral-800">
            <StatBar label="Possession" home={hs.possession} away={as.possession} format={(v) => `${v.toFixed(0)}%`} />
            <StatBar label="xG" home={hs.xg} away={as.xg} format={(v) => v.toFixed(2)} />
            <StatBar label="Shots" home={hs.shots} away={as.shots} />
            <StatBar label="On target" home={hs.shots_on_target} away={as.shots_on_target} />
            <StatBar label="Corners" home={hs.corners} away={as.corners} />
            <StatBar label="Fouls" home={hs.fouls} away={as.fouls} />
            <StatBar label="Passes" home={hs.passes} away={as.passes} />
            <StatBar label="Pass accuracy" home={hs.pass_accuracy} away={as.pass_accuracy} format={(v) => `${v.toFixed(0)}%`} />
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Player ratings
        </h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {[home, away].map((team) => (
            <div key={team.id}>
              <h3 className="mb-2 text-sm font-semibold">{team.name}</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="py-1 font-normal">Player</th>
                    <th className="py-1 text-right font-normal">Min</th>
                    <th className="py-1 text-right font-normal">G</th>
                    <th className="py-1 text-right font-normal">A</th>
                    <th className="py-1 text-right font-normal">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {playerStats
                    .filter((p) => p.team_id === team.id)
                    .map((p) => (
                      <tr key={p.id} className="border-t border-neutral-100 dark:border-neutral-900">
                        <td className="py-1">{p.player?.name ?? p.player_id}</td>
                        <td className="py-1 text-right tabular-nums">{p.minutes}</td>
                        <td className="py-1 text-right tabular-nums">{p.goals || ""}</td>
                        <td className="py-1 text-right tabular-nums">{p.assists || ""}</td>
                        <td className="py-1 text-right font-semibold tabular-nums">
                          {p.rating?.toFixed(1) ?? "–"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default async function MatchPage({ params }: PageProps<"/matches/[id]">) {
  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isInteger(matchId)) notFound();

  const match = await getMatch(matchId);
  if (!match) notFound();

  return (
    <div className="space-y-8">
      <MatchHeader match={match} />
      {match.status === "scheduled" && <ScheduledView match={match} />}
      {match.status === "live" && <LiveView match={match} />}
      {match.status === "finished" && <FinishedView match={match} />}
    </div>
  );
}
