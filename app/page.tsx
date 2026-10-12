import MatchTimeline from "@/components/MatchTimeline";
import TournamentSummary from "@/components/TournamentSummary";
import {
  eloByMatch,
  getAllMatches,
  getEloHistory,
  getLatestSnapshotMinute,
  getPlayerSeasonStats,
  getTeamSeasons,
} from "@/lib/queries";
import { isComplete } from "@/lib/season";
import { getActiveSeason } from "@/lib/season-server";
import { summarizeTournament } from "@/lib/tournament";

// Rendered per request so the page always mirrors the database (the worker is
// the only writer; a re-run of finalize_season shows up immediately).
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const season = await getActiveSeason();
  const complete = isComplete(season);
  const [matches, teamSeasons, history, players] = await Promise.all([
    getAllMatches(season),
    getTeamSeasons(season),
    getEloHistory(season),
    complete ? getPlayerSeasonStats(season) : Promise.resolve([]),
  ]);

  if (matches.length === 0) {
    return (
      <p className="text-sm text-muted">
        No fixtures for {season} yet. Check back once the schedule is published.
      </p>
    );
  }

  // Latest live clock per in-play match (only ever non-empty mid-tournament).
  const liveIds = matches.filter((m) => m.status === "live").map((m) => m.id);
  const liveMinutes: Record<number, number | null> = {};
  await Promise.all(
    liveIds.map(async (id) => {
      liveMinutes[id] = await getLatestSnapshotMinute(id);
    }),
  );

  const eloByTeam: Record<number, { elo: number; initial_elo: number | null }> = {};
  for (const ts of teamSeasons) {
    eloByTeam[ts.team_id] = { elo: ts.elo, initial_elo: ts.initial_elo };
  }

  return (
    <div className="space-y-12">
      {complete && <TournamentSummary season={season} summary={summarizeTournament(matches, players)} />}
      <MatchTimeline
        matches={matches}
        liveMinutes={liveMinutes}
        eloByTeam={eloByTeam}
        eloByMatch={eloByMatch(history)}
      />
    </div>
  );
}
