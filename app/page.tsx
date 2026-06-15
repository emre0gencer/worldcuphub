import MatchTimeline from "@/components/MatchTimeline";
import { getAllMatches, getLatestSnapshotMinute } from "@/lib/queries";
import { resolveSeason } from "@/lib/season";

// Live scores must always be fresh — render per request.
export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const season = resolveSeason(sp.season);
  const matches = await getAllMatches(season);

  if (matches.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
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

  return <MatchTimeline matches={matches} liveMinutes={liveMinutes} />;
}
