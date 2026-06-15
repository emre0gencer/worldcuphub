import { notFound } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import EloDelta from "@/components/EloDelta";
import { getTeamColors } from "@/lib/team-colors";
import MomentumChart, { type MomentumPoint } from "@/components/MomentumChart";
import StatBar from "@/components/StatBar";
import ApiSportsWidget from "@/components/widgets/ApiSportsWidget";
import { widgetsEnabled } from "@/components/widgets/widgets-enabled";
import {
  getFormForTeams,
  getLatestPrediction,
  getLatestSnapshotMinute,
  getMatch,
  getMatchEvents,
  getMatchLineups,
  getPlayerMatchStats,
  getPriorMeetings,
  getSnapshotSeries,
  getTeamMatchStats,
  getTeamSeasons,
  snapshotStat,
} from "@/lib/queries";
import type {
  MatchEvent,
  MatchLineup,
  MatchLineupPlayer,
  MatchWithTeams,
  Team,
  TeamSeason,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  group: "Group stage",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  third_place: "Third place",
  final: "Final",
};

function Logo({ team, size = "h-9 w-9" }: { team: Team | null; size?: string }) {
  if (!team?.logo_url)
    return <span className={`${size} rounded bg-neutral-200 dark:bg-neutral-800`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={team.logo_url} alt={team.name} className={`${size} object-contain`} />;
}

function MatchHeader({
  match,
  liveMinute,
  homeSeason,
  awaySeason,
}: {
  match: MatchWithTeams;
  liveMinute?: number | null;
  homeSeason?: TeamSeason;
  awaySeason?: TeamSeason;
}) {
  const kickoff = new Date(match.kickoff_at);
  const stageLabel =
    match.stage === "group" && match.group_letter
      ? `Group ${match.group_letter}`
      : STAGE_LABEL[match.stage];
  const finishedLabel =
    match.pen_home != null
      ? "Penalties"
      : match.status_short === "AET"
        ? "After extra time"
        : "Full time";

  return (
    <div className="rounded-2xl border border-neutral-200 p-6 text-center dark:border-neutral-800">
      <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
        {stageLabel}
        {" · "}
        {kickoff.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
        {match.venue ? ` · ${match.venue}${match.venue_city ? `, ${match.venue_city}` : ""}` : ""}
      </p>
      {match.referee && (
        <p className="mb-4 text-xs text-neutral-400">Referee: {match.referee}</p>
      )}
      <div className="flex items-center justify-center gap-6">
        <div className="flex w-40 flex-col items-center gap-2">
          <Logo team={match.home_team} />
          <span className="font-semibold">{match.home_team?.name ?? "TBD"}</span>
          {homeSeason?.initial_elo != null && (
            <span className="text-xs text-neutral-500">
              <EloDelta current={homeSeason.elo} initial={homeSeason.initial_elo} />
            </span>
          )}
        </div>
        <div className="w-32">
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
            // FIFA-style running clock: pulsing dot + current minute (no seconds).
            <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold tabular-nums text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              {match.status_short === "HT"
                ? "HT"
                : liveMinute != null
                  ? `${liveMinute}'`
                  : "LIVE"}
            </span>
          )}
          {match.status === "finished" && (
            <div className="mt-1 space-y-0.5 text-xs text-neutral-500">
              <div>{finishedLabel}</div>
              {match.pen_home != null && (
                <div className="font-semibold tabular-nums">
                  Pens {match.pen_home} – {match.pen_away}
                </div>
              )}
              {match.ht_home != null && (
                <div className="tabular-nums">
                  HT {match.ht_home} – {match.ht_away}
                  {match.status_short !== "FT" && match.ft_home != null && (
                    <span>
                      {" "}
                      · 90′ {match.ft_home} – {match.ft_away}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex w-40 flex-col items-center gap-2">
          <Logo team={match.away_team} />
          <span className="font-semibold">{match.away_team?.name ?? "TBD"}</span>
          {awaySeason?.initial_elo != null && (
            <span className="text-xs text-neutral-500">
              <EloDelta current={awaySeason.elo} initial={awaySeason.initial_elo} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── scheduled ────────────────────────────────────────────────────────────────

async function ScheduledView({
  match,
  homeSeason,
  awaySeason,
}: {
  match: MatchWithTeams;
  homeSeason?: TeamSeason;
  awaySeason?: TeamSeason;
}) {
  const home = match.home_team;
  const away = match.away_team;
  if (!home || !away) {
    return <p className="text-sm text-neutral-500">Teams will be decided by the previous round.</p>;
  }
  const homeColor = getTeamColors(home.country_code).main;
  const awayColor = getTeamColors(away.country_code).secondary;

  const [forms, prediction, priorMeetings] = await Promise.all([
    getFormForTeams(match.season, [home.id, away.id]),
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
          <StatBar
            label="FIFA ranking"
            home={homeSeason?.fifa_ranking ?? null}
            away={awaySeason?.fifa_ranking ?? null}
            homeColor={homeColor}
            awayColor={awayColor}
          />
          {/* Elo row: custom layout so EloDelta (JSX) can replace the raw number. */}
          <div className="py-2">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-semibold">
                {homeSeason
                  ? <EloDelta current={homeSeason.elo} initial={homeSeason.initial_elo} />
                  : "–"}
              </span>
              <span className="text-xs uppercase tracking-wide text-neutral-500">Elo</span>
              <span className="font-semibold">
                {awaySeason
                  ? <EloDelta current={awaySeason.elo} initial={awaySeason.initial_elo} />
                  : "–"}
              </span>
            </div>
            <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
              {(() => {
                const h = homeSeason?.elo ?? 0;
                const a = awaySeason?.elo ?? 0;
                const total = h + a;
                const pct = total > 0 ? (h / total) * 100 : 50;
                return (
                  <>
                    <div style={{ width: `${pct}%`, backgroundColor: homeColor }} />
                    <div style={{ width: `${100 - pct}%`, backgroundColor: awayColor }} />
                  </>
                );
              })()}
            </div>
          </div>
          {homeForm && awayForm && (
            <>
              <StatBar label="Overall form" home={homeForm.overall_form} away={awayForm.overall_form} format={(v) => v.toFixed(1)} homeColor={homeColor} awayColor={awayColor} />
              <StatBar label="Attacking form" home={homeForm.attacking_form} away={awayForm.attacking_form} format={(v) => v.toFixed(1)} homeColor={homeColor} awayColor={awayColor} />
              <StatBar label="Defending form" home={homeForm.defending_form} away={awayForm.defending_form} format={(v) => v.toFixed(1)} homeColor={homeColor} awayColor={awayColor} />
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
          <p className="text-sm text-neutral-500">No previous meetings in stored tournaments.</p>
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

// Every team stat the API reports for a fixture, in display order — the same
// rows shown for finished matches, sourced from the live snapshot blob instead.
// Rows whose stat is absent in the current snapshot are skipped (see LiveStatRow).
const LIVE_STAT_ROWS: { type: string; label: string; format?: (v: number) => string }[] = [
  { type: "Ball Possession", label: "Possession", format: (v) => `${v.toFixed(0)}%` },
  { type: "expected_goals", label: "xG", format: (v) => v.toFixed(2) },
  { type: "Total Shots", label: "Shots" },
  { type: "Shots on Goal", label: "On target" },
  { type: "Shots off Goal", label: "Off target" },
  { type: "Blocked Shots", label: "Blocked shots" },
  { type: "Shots insidebox", label: "Shots inside box" },
  { type: "Shots outsidebox", label: "Shots outside box" },
  { type: "Corner Kicks", label: "Corners" },
  { type: "Offsides", label: "Offsides" },
  { type: "Fouls", label: "Fouls" },
  { type: "Yellow Cards", label: "Yellow cards" },
  { type: "Red Cards", label: "Red cards" },
  { type: "Goalkeeper Saves", label: "Saves" },
  { type: "goals_prevented", label: "Goals prevented", format: (v) => v.toFixed(2) },
  { type: "Total passes", label: "Passes" },
  { type: "Passes accurate", label: "Accurate passes" },
  { type: "Passes %", label: "Pass accuracy", format: (v) => `${v.toFixed(0)}%` },
];

/** A live StatBar that renders nothing unless the stat is present for a side. */
function LiveStatRow({
  home,
  away,
  label,
  format,
  homeColor,
  awayColor,
}: {
  home: number | null;
  away: number | null;
  label: string;
  format?: (v: number) => string;
  homeColor?: string;
  awayColor?: string;
}) {
  if (home == null && away == null) return null;
  return <StatBar label={label} home={home} away={away} format={format} homeColor={homeColor} awayColor={awayColor} />;
}

const MOMENTUM_CHARTS: {
  title: string;
  type: string;
  curveType?: "stepAfter" | "monotone";
}[] = [
  { title: "Shots",           type: "Total Shots" },
  { title: "Shots on target", type: "Shots on Goal" },
  { title: "xG",              type: "expected_goals", curveType: "monotone" },
  { title: "Corners",         type: "Corner Kicks" },
  { title: "Fouls",           type: "Fouls" },
  { title: "Passes",          type: "Total passes" },
];

async function LiveView({ match }: { match: MatchWithTeams }) {
  const home = match.home_team!;
  const away = match.away_team!;
  const homeColors = getTeamColors(home.country_code);
  const awayColors = getTeamColors(away.country_code);
  const homeColor = homeColors.main;
  const awayColor = awayColors.secondary;

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
      {/* Re-pull the latest snapshot every 60s without a full reload. */}
      <AutoRefresh />
      {widgetsEnabled && (
        // Official live view: events, lineups, team + player statistics
        <ApiSportsWidget data-type="game" data-game-id={String(match.id)} data-game-tab="statistics" />
      )}
      {!latest ? (
        <p className="text-sm text-neutral-500">Waiting for the first live snapshot…</p>
      ) : (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Live stats
          </h2>
          <div className="rounded-xl border border-neutral-200 px-4 dark:border-neutral-800">
            {LIVE_STAT_ROWS.map((r) => (
              <LiveStatRow
                key={r.type}
                label={r.label}
                home={stat(r.type, home.id)}
                away={stat(r.type, away.id)}
                format={r.format}
                homeColor={homeColor}
                awayColor={awayColor}
              />
            ))}
          </div>
        </section>
      )}

      {/* Momentum charts — horizontal scroll carousel, one snap per chart */}
      {snapshots.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Momentum
          </h2>
          <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3">
            {MOMENTUM_CHARTS.map((c) => (
              <div
                key={c.type}
                className="w-[calc(100%-2rem)] shrink-0 snap-start rounded-xl border border-neutral-200 p-4 sm:w-80 dark:border-neutral-800"
              >
                <MomentumChart
                  title={c.title}
                  data={momentum(c.type)}
                  homeName={home.name}
                  awayName={away.name}
                  homeColor={homeColor}
                  awayColor={awayColor}
                  curveType={c.curveType ?? "stepAfter"}
                />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── finished: events timeline ────────────────────────────────────────────────

function eventIcon(e: MatchEvent): string {
  if (e.type === "Goal") {
    if (e.detail === "Own Goal") return "⊖ OG";
    if (e.detail === "Penalty") return "⚽ (pen)";
    if (e.detail === "Missed Penalty") return "⊘ pen miss";
    return "⚽";
  }
  if (e.type === "Card") return e.detail === "Red Card" ? "🟥" : "🟨";
  if (e.type === "subst") return "⇄";
  if (e.type === "Var") return "VAR";
  return e.type ?? "";
}

function EventsTimeline({ events, match }: { events: MatchEvent[]; match: MatchWithTeams }) {
  const regular = events.filter((e) => e.comments !== "Penalty Shootout");
  const shootout = events.filter((e) => e.comments === "Penalty Shootout");

  const row = (e: MatchEvent) => {
    const isHome = e.team_id === match.home_team_id;
    const minute =
      e.elapsed != null ? `${e.elapsed}${e.elapsed_extra ? `+${e.elapsed_extra}` : ""}′` : "";
    const text = (
      <span>
        <span className="mr-1">{eventIcon(e)}</span>
        <span className="font-medium">{e.player_name}</span>
        {e.type === "subst" && e.assist_name && (
          <span className="text-neutral-500"> ⟶ {e.assist_name}</span>
        )}
        {e.type === "Goal" && e.assist_name && (
          <span className="text-neutral-500"> (assist: {e.assist_name})</span>
        )}
        {e.type === "Var" && <span className="text-neutral-500"> — {e.detail}</span>}
      </span>
    );
    return (
      <li key={e.id} className="grid grid-cols-[1fr_3.5rem_1fr] items-center gap-2 py-1 text-sm">
        <span className="text-right">{isHome ? text : null}</span>
        <span className="text-center text-xs tabular-nums text-neutral-400">{minute}</span>
        <span>{!isHome ? text : null}</span>
      </li>
    );
  };

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Timeline
      </h2>
      <ul className="rounded-xl border border-neutral-200 px-4 py-2 dark:border-neutral-800">
        {regular.map(row)}
      </ul>
      {shootout.length > 0 && (
        <>
          <h3 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Penalty shootout
          </h3>
          <ul className="rounded-xl border border-neutral-200 px-4 py-2 dark:border-neutral-800">
            {shootout.map(row)}
          </ul>
        </>
      )}
    </section>
  );
}

// ── finished: lineups ────────────────────────────────────────────────────────

function LineupColumn({
  team,
  lineup,
  players,
}: {
  team: Team;
  lineup: MatchLineup | undefined;
  players: MatchLineupPlayer[];
}) {
  const starters = players.filter((p) => p.starter);
  const subs = players.filter((p) => !p.starter);
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">
        {team.name}
        {lineup?.formation && (
          <span className="ml-2 font-normal text-neutral-500">{lineup.formation}</span>
        )}
      </h3>
      {lineup?.coach_name && (
        <p className="mb-2 text-xs text-neutral-500">Coach: {lineup.coach_name}</p>
      )}
      <ul className="space-y-0.5 text-sm">
        {starters.map((p) => (
          <li key={p.id} className="flex gap-2">
            <span className="w-6 text-right tabular-nums text-neutral-400">{p.shirt_number}</span>
            <span className="w-4 text-xs leading-5 text-neutral-400">{p.position}</span>
            <span>{p.player_name}</span>
          </li>
        ))}
      </ul>
      {subs.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-xs uppercase tracking-wide text-neutral-400">Substitutes</p>
          <ul className="space-y-0.5 text-sm text-neutral-500">
            {subs.map((p) => (
              <li key={p.id} className="flex gap-2">
                <span className="w-6 text-right tabular-nums text-neutral-400">{p.shirt_number}</span>
                <span className="w-4 text-xs leading-5 text-neutral-400">{p.position}</span>
                <span>{p.player_name}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ── finished ─────────────────────────────────────────────────────────────────

async function FinishedView({ match }: { match: MatchWithTeams }) {
  const home = match.home_team!;
  const away = match.away_team!;
  const homeColor = getTeamColors(home.country_code).main;
  const awayColor = getTeamColors(away.country_code).secondary;

  const [teamStats, playerStats, events, lineups] = await Promise.all([
    getTeamMatchStats(match.id),
    getPlayerMatchStats(match.id),
    getMatchEvents(match.id),
    getMatchLineups(match.id),
  ]);
  const hs = teamStats.find((s) => s.team_id === home.id);
  const as = teamStats.find((s) => s.team_id === away.id);

  return (
    <div className="space-y-8">
      {widgetsEnabled && (
        // Official post-match view — owned Track 2 data renders below it.
        <ApiSportsWidget
          data-type="game"
          data-game-id={String(match.id)}
          data-game-tab="statistics"
        />
      )}

      {events.length > 0 && <EventsTimeline events={events} match={match} />}

      {hs && as && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Match stats
          </h2>
          <div className="rounded-xl border border-neutral-200 px-4 dark:border-neutral-800">
            <StatBar label="Possession" home={hs.possession} away={as.possession} format={(v) => `${v.toFixed(0)}%`} homeColor={homeColor} awayColor={awayColor} />
            {(hs.xg != null || as.xg != null) && (
              <StatBar label="xG" home={hs.xg} away={as.xg} format={(v) => v.toFixed(2)} homeColor={homeColor} awayColor={awayColor} />
            )}
            <StatBar label="Shots" home={hs.shots} away={as.shots} homeColor={homeColor} awayColor={awayColor} />
            <StatBar label="On target" home={hs.shots_on_target} away={as.shots_on_target} homeColor={homeColor} awayColor={awayColor} />
            <StatBar label="Off target" home={hs.shots_off_target} away={as.shots_off_target} homeColor={homeColor} awayColor={awayColor} />
            <StatBar label="Blocked shots" home={hs.shots_blocked} away={as.shots_blocked} homeColor={homeColor} awayColor={awayColor} />
            <StatBar label="Shots inside box" home={hs.shots_inside_box} away={as.shots_inside_box} homeColor={homeColor} awayColor={awayColor} />
            <StatBar label="Corners" home={hs.corners} away={as.corners} homeColor={homeColor} awayColor={awayColor} />
            <StatBar label="Offsides" home={hs.offsides} away={as.offsides} homeColor={homeColor} awayColor={awayColor} />
            <StatBar label="Fouls" home={hs.fouls} away={as.fouls} homeColor={homeColor} awayColor={awayColor} />
            <StatBar label="Yellow cards" home={hs.yellow_cards} away={as.yellow_cards} homeColor={homeColor} awayColor={awayColor} />
            <StatBar label="Red cards" home={hs.red_cards} away={as.red_cards} homeColor={homeColor} awayColor={awayColor} />
            <StatBar label="Saves" home={hs.saves} away={as.saves} homeColor={homeColor} awayColor={awayColor} />
            {(hs.goals_prevented != null || as.goals_prevented != null) && (
              <StatBar label="Goals prevented" home={hs.goals_prevented} away={as.goals_prevented} format={(v) => v.toFixed(2)} homeColor={homeColor} awayColor={awayColor} />
            )}
            <StatBar label="Passes" home={hs.passes} away={as.passes} homeColor={homeColor} awayColor={awayColor} />
            <StatBar label="Pass accuracy" home={hs.pass_accuracy} away={as.pass_accuracy} format={(v) => `${v.toFixed(0)}%`} homeColor={homeColor} awayColor={awayColor} />
          </div>
        </section>
      )}

      {lineups.players.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Lineups
          </h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {[home, away].map((team) => (
              <LineupColumn
                key={team.id}
                team={team}
                lineup={lineups.teams.find((l) => l.team_id === team.id)}
                players={lineups.players.filter((p) => p.team_id === team.id)}
              />
            ))}
          </div>
        </section>
      )}

      {playerStats.length > 0 && (
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
                      .filter((p) => p.team_id === team.id && (p.minutes ?? 0) > 0)
                      .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
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
      )}
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

  const [liveMinute, teamSeasons] = await Promise.all([
    match.status === "live" ? getLatestSnapshotMinute(matchId) : Promise.resolve(null),
    getTeamSeasons(match.season),
  ]);

  const homeSeason = teamSeasons.find((t) => t.team_id === match.home_team_id) ?? undefined;
  const awaySeason = teamSeasons.find((t) => t.team_id === match.away_team_id) ?? undefined;

  return (
    <div className="space-y-8">
      <MatchHeader match={match} liveMinute={liveMinute} homeSeason={homeSeason} awaySeason={awaySeason} />
      {match.status === "scheduled" && <ScheduledView match={match} homeSeason={homeSeason} awaySeason={awaySeason} />}
      {match.status === "live" && <LiveView match={match} />}
      {match.status === "finished" && <FinishedView match={match} />}
    </div>
  );
}
