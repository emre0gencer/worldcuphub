import MatchTimeline from "@/components/MatchTimeline";
import { getAllMatches } from "@/lib/queries";
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

  return <MatchTimeline matches={matches} />;
}
