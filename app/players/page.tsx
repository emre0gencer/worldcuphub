import type { Metadata } from "next";
import { getPlayerSeasonStats } from "@/lib/queries";
import { resolveSeason } from "@/lib/season";
import type { PlayerSeasonStats } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Players — World Cup HUB",
};

function Leaderboard({
  title,
  rows,
  value,
  format = (v) => String(v),
}: {
  title: string;
  rows: PlayerSeasonStats[];
  value: (p: PlayerSeasonStats) => number;
  format?: (v: number) => string;
}) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h2>
      <ol className="rounded-xl border border-neutral-200 dark:border-neutral-800">
        {rows.map((p, i) => (
          <li
            key={p.player_id}
            className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2 last:border-b-0 dark:border-neutral-900"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-5 text-right text-xs tabular-nums text-neutral-400">{i + 1}</span>
              {p.player?.photo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.player.photo_url}
                  alt=""
                  className="h-6 w-6 rounded-full object-cover"
                />
              )}
              <div className="min-w-0">
                <div className="truncate text-sm">{p.player?.name ?? p.player_id}</div>
                <div className="truncate text-xs text-neutral-400">{p.team?.name}</div>
              </div>
            </div>
            <span className="text-sm font-semibold tabular-nums">{format(value(p))}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default async function PlayersPage({ searchParams }: PageProps<"/players">) {
  const sp = await searchParams;
  const season = resolveSeason(sp.season);
  const stats = await getPlayerSeasonStats(season);

  const top = (value: (p: PlayerSeasonStats) => number, filter?: (p: PlayerSeasonStats) => boolean) =>
    stats
      .filter((p) => value(p) > 0 && (!filter || filter(p)))
      .sort(
        (a, b) =>
          value(b) - value(a) ||
          (a.minutes ?? Infinity) - (b.minutes ?? Infinity) ||
          (a.player?.name ?? "").localeCompare(b.player?.name ?? ""),
      )
      .slice(0, 10);

  const topScorers = top((p) => p.goals ?? 0);
  const topAssists = top((p) => p.assists ?? 0);
  // Rating requires meaningful minutes to be comparable.
  const bestRated = top(
    (p) => p.rating ?? 0,
    (p) => (p.minutes ?? 0) >= 180,
  );
  const mostSaves = top((p) => p.saves ?? 0);
  const mostKeyPasses = top((p) => p.key_passes ?? 0);
  const mostDribbles = top((p) => p.dribbles_succeeded ?? 0);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="mb-1 text-xl font-bold">Players</h1>
        <p className="text-sm text-neutral-500">
          Tournament leaderboards for {season}, from per-match player statistics.
        </p>
      </section>

      {stats.length === 0 ? (
        <p className="text-sm text-neutral-500">No player data for {season} yet.</p>
      ) : (
        <div className="grid gap-8 md:grid-cols-3">
          <Leaderboard title="Top scorers" rows={topScorers} value={(p) => p.goals ?? 0} />
          <Leaderboard title="Top assists" rows={topAssists} value={(p) => p.assists ?? 0} />
          <Leaderboard
            title="Best rated (180+ min)"
            rows={bestRated}
            value={(p) => p.rating ?? 0}
            format={(v) => v.toFixed(2)}
          />
          <Leaderboard title="Most saves" rows={mostSaves} value={(p) => p.saves ?? 0} />
          <Leaderboard title="Key passes" rows={mostKeyPasses} value={(p) => p.key_passes ?? 0} />
          <Leaderboard
            title="Successful dribbles"
            rows={mostDribbles}
            value={(p) => p.dribbles_succeeded ?? 0}
          />
        </div>
      )}
    </div>
  );
}
