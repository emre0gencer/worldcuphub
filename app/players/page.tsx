import type { Metadata } from "next";
import SectionHeading from "@/components/SectionHeading";
import PlayerButton from "@/components/player/PlayerButton";
import { getPlayerSeasonStats } from "@/lib/queries";
import { getActiveSeason } from "@/lib/season-server";
import type { PlayerSeasonStats, PlayerStatKey } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Players — World Cup HUB",
};

function Leaderboard({
  title,
  rows,
  value,
  season,
  highlight,
  format = (v) => String(v),
}: {
  title: string;
  rows: PlayerSeasonStats[];
  value: (p: PlayerSeasonStats) => number;
  season: number;
  highlight: PlayerStatKey;
  format?: (v: number) => string;
}) {
  return (
    <div>
      <h2 className="eyebrow mb-2.5">{title}</h2>
      <ol className="overflow-hidden rounded-xl border border-border-warm bg-surface shadow-sm">
        {rows.map((p, i) => (
          <li key={p.player_id} className="border-b border-border-light last:border-b-0">
            <PlayerButton
              playerId={p.player_id}
              season={season}
              highlight={highlight}
              name={p.player?.name ?? undefined}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-surface-warm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-5 text-right font-mono text-xs tabular-nums text-foil">{i + 1}</span>
                {p.player?.photo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.player.photo_url}
                    alt=""
                    className="h-6 w-6 rounded-full object-cover"
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm">{p.player?.name ?? p.player_id}</span>
                  <span className="block truncate text-xs text-muted">{p.team?.name}</span>
                </span>
              </span>
              <span className="font-mono text-sm font-semibold tabular-nums text-ink">{format(value(p))}</span>
            </PlayerButton>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default async function PlayersPage() {
  const season = await getActiveSeason();
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
    <div className="space-y-12">
      <section className="reveal">
        <SectionHeading
          eyebrow="Leaderboards"
          title="Players"
          standfirst={`Tournament leaderboards for ${season}, from per-match player statistics.`}
        />
      </section>

      {stats.length === 0 ? (
        <p className="text-sm text-muted">No player data for {season} yet.</p>
      ) : (
        <div className="reveal grid gap-8 md:grid-cols-3" style={{ "--d": "80ms" } as React.CSSProperties}>
          <Leaderboard title="Top scorers" rows={topScorers} value={(p) => p.goals ?? 0} season={season} highlight="goals" />
          <Leaderboard title="Top assists" rows={topAssists} value={(p) => p.assists ?? 0} season={season} highlight="assists" />
          <Leaderboard
            title="Best rated (180+ min)"
            rows={bestRated}
            value={(p) => p.rating ?? 0}
            format={(v) => v.toFixed(2)}
            season={season}
            highlight="rating"
          />
          <Leaderboard title="Most saves" rows={mostSaves} value={(p) => p.saves ?? 0} season={season} highlight="saves" />
          <Leaderboard title="Key passes" rows={mostKeyPasses} value={(p) => p.key_passes ?? 0} season={season} highlight="key_passes" />
          <Leaderboard
            title="Successful dribbles"
            rows={mostDribbles}
            value={(p) => p.dribbles_succeeded ?? 0}
            season={season}
            highlight="dribbles"
          />
        </div>
      )}
    </div>
  );
}
