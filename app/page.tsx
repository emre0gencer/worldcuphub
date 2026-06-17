import MatchTimeline from "@/components/MatchTimeline";
import { getAllMatches, getLatestSnapshotMinute, getTeamSeasons } from "@/lib/queries";
import { resolveSeason } from "@/lib/season";

// Live scores must always be fresh — render per request.
export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const season = resolveSeason(sp.season);
  const [matches, teamSeasons] = await Promise.all([
    getAllMatches(season),
    getTeamSeasons(season),
  ]);

  if (matches.length === 0) {
    return (
      <p className="text-sm text-muted">
        No fixtures for {season} yet. Check back once the schedule is published.
      </p>
    );
  }

  // Latest live clock per in-play match (a handful at most) for the card badges.
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

  return <MatchTimeline matches={matches} liveMinutes={liveMinutes} eloByTeam={eloByTeam} />;
}
