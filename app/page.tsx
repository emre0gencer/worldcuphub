import MatchCard from "@/components/MatchCard";
import { getAllMatches } from "@/lib/queries";
import { resolveSeason } from "@/lib/season";
import type { MatchWithTeams } from "@/lib/types";

// Live scores must always be fresh — render per request.
export const dynamic = "force-dynamic";

function groupByDay(matches: MatchWithTeams[]): Map<string, MatchWithTeams[]> {
  const byDay = new Map<string, MatchWithTeams[]>();
  for (const m of matches) {
    const day = new Date(m.kickoff_at).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    byDay.set(day, [...(byDay.get(day) ?? []), m]);
  }
  return byDay;
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const season = resolveSeason(sp.season);
  const matches = await getAllMatches(season);
  const live = matches.filter((m) => m.status === "live");
  const rest = matches.filter((m) => m.status !== "live");

  return (
    <div className="space-y-10">
      {matches.length === 0 && (
        <p className="text-sm text-neutral-500">
          No fixtures for {season} yet. Check back once the schedule is published.
        </p>
      )}
      {live.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-red-600">
            Live now
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {live.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        </section>
      )}

      {[...groupByDay(rest)].map(([day, dayMatches]) => (
        <section key={day}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            {day}
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {dayMatches.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
