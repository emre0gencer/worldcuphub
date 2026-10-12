import Link from "next/link";
import PlayerButton from "@/components/player/PlayerButton";
import { formatIngestionWindow, seasonInfo } from "@/lib/season";
import type { TournamentSummary as Summary } from "@/lib/tournament";
import type { MatchWithTeams, Team } from "@/lib/types";

/**
 * Archive hero for a completed tournament — the "cover page" of the almanac:
 * champion, podium, the final, and the tournament in numbers. Every value is
 * derived from owned data (see lib/tournament.ts), so the hero can never drift
 * from the match pages, bracket or leaderboards it links to.
 */

function TeamLogo({ team, className }: { team: Team | null; className: string }) {
  if (!team?.logo_url) return <span className={`${className} rounded-full bg-surface-warm`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={team.logo_url} alt="" className={`${className} object-contain`} />;
}

function scoreline(m: MatchWithTeams): string {
  const pens = m.pen_home != null ? ` (${m.pen_home}–${m.pen_away} pens)` : "";
  const aet = m.status_short === "AET" ? " a.e.t." : "";
  return `${m.home_team?.name ?? "TBD"} ${m.home_score}–${m.away_score} ${m.away_team?.name ?? "TBD"}${aet}${pens}`;
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2.5">
      <span className="font-mono text-xl font-semibold tabular-nums text-ink">{value}</span>
      <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-muted">{label}</span>
    </div>
  );
}

function PodiumStep({ place, team }: { place: string; team: Team | null }) {
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <span className="w-12 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-foil">{place}</span>
      <TeamLogo team={team} className="h-5 w-5" />
      <span className="truncate text-sm font-semibold text-ink">{team?.name ?? "—"}</span>
    </li>
  );
}

export default function TournamentSummary({
  season,
  summary,
}: {
  season: number;
  summary: Summary;
}) {
  const info = seasonInfo(season);
  const ingestWindow = formatIngestionWindow(info);
  const { final, champion } = summary;
  const finalDate = final
    ? new Date(final.kickoff_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <section className="reveal space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="eyebrow">Tournament complete</span>
        <span className="h-px flex-1 bg-gradient-to-r from-border-warm to-transparent" />
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-muted">
          {info.ingestion === "live"
            ? `Live ingestion ended${ingestWindow ? ` · ran ${ingestWindow}` : ""}`
            : "Backfilled archive"}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        {/* Champion card */}
        <div className="relative overflow-hidden rounded-2xl border border-border-warm bg-surface p-6 shadow-sm">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-4 -top-10 select-none font-display text-[10rem] font-black leading-none text-foil/[0.08]"
          >
            ★
          </span>
          <p className="eyebrow mb-3">{season} World Champions</p>
          {champion ? (
            <div className="flex items-center gap-4">
              <TeamLogo team={champion} className="h-14 w-14" />
              <h2 className="font-display text-4xl font-black leading-none tracking-tight text-ink sm:text-5xl">
                {champion.name}
              </h2>
            </div>
          ) : (
            <p className="text-sm text-muted">The final has no recorded winner yet.</p>
          )}
          {final && final.status === "finished" && (
            <Link
              href={`/matches/${final.id}`}
              className="mt-4 inline-flex flex-wrap items-baseline gap-x-2 text-sm text-muted transition-colors hover:text-ink"
            >
              <span className="font-mono font-semibold tabular-nums text-ink">{scoreline(final)}</span>
              <span>
                · Final{finalDate ? `, ${finalDate}` : ""}
                {final.venue ? ` · ${final.venue}` : ""} →
              </span>
            </Link>
          )}
          <ol className="mt-5 grid gap-x-6 border-t border-border-light pt-3 sm:grid-cols-3">
            <PodiumStep place="2nd" team={summary.runnerUp} />
            <PodiumStep place="3rd" team={summary.third} />
            <PodiumStep place="4th" team={summary.fourth} />
          </ol>
        </div>

        {/* Golden Boot + quick links */}
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-border-warm bg-surface p-5 shadow-sm">
            <p className="eyebrow mb-2">Top scorer</p>
            {summary.goldenBoot.length === 0 ? (
              <p className="text-sm text-muted">No goals recorded.</p>
            ) : (
              <ul className="space-y-1.5">
                {summary.goldenBoot.map((p) => (
                  <li key={p.player_id}>
                    <PlayerButton
                      playerId={p.player_id}
                      season={season}
                      highlight="goals"
                      name={p.player?.name}
                      className="flex w-full items-center justify-between gap-3"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {p.player?.photo_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.player.photo_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate font-display text-lg font-bold text-ink">
                            {p.player?.name ?? p.player_id}
                          </span>
                          <span className="block truncate text-xs text-muted">{p.team?.name}</span>
                        </span>
                      </span>
                      <span className="font-mono text-2xl font-semibold tabular-nums text-ink">{p.goals}</span>
                    </PlayerButton>
                  </li>
                ))}
              </ul>
            )}
            {summary.topAssist && (
              <p className="mt-3 border-t border-border-light pt-2 text-xs text-muted">
                Most assists:{" "}
                <span className="font-semibold text-ink">{summary.topAssist.player?.name}</span>{" "}
                <span className="font-mono tabular-nums">({summary.topAssist.assists})</span>
              </p>
            )}
          </div>
          <nav className="grid grid-cols-3 gap-2 text-center font-mono text-[0.65rem] uppercase tracking-[0.12em]">
            {[
              { href: "/standings", label: "Bracket" },
              { href: "/rankings", label: "Elo & form" },
              { href: "/players", label: "Players" },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-lg border border-border-warm bg-surface px-2 py-2.5 text-foil transition-colors hover:border-foil hover:text-ink"
              >
                {l.label} →
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* Tournament in numbers */}
      <div className="grid grid-cols-3 divide-x divide-y divide-border-light overflow-hidden rounded-xl border border-border-warm bg-surface shadow-sm sm:grid-cols-6 sm:divide-y-0">
        <Stat value={`${summary.played}/${summary.total}`} label="Matches" />
        <Stat value={summary.teams} label="Teams" />
        <Stat value={summary.goals} label="Goals" />
        <Stat value={summary.goalsPerMatch.toFixed(2)} label="Goals / match" />
        <Stat value={summary.extraTime} label="Extra time" />
        <Stat value={summary.shootouts} label="Shootouts" />
      </div>
      {(summary.highestScoring || summary.biggestWin) && (
        <p className="text-xs text-muted">
          {summary.highestScoring && (
            <>
              Highest-scoring:{" "}
              <Link href={`/matches/${summary.highestScoring.id}`} className="underline decoration-border-warm underline-offset-2 hover:text-ink">
                {scoreline(summary.highestScoring)}
              </Link>
            </>
          )}
          {summary.highestScoring && summary.biggestWin && " · "}
          {summary.biggestWin && (
            <>
              Biggest margin:{" "}
              <Link href={`/matches/${summary.biggestWin.id}`} className="underline decoration-border-warm underline-offset-2 hover:text-ink">
                {scoreline(summary.biggestWin)}
              </Link>
            </>
          )}
        </p>
      )}

      <div className="hairline pt-4" />
      <p className="eyebrow">Every match, in order</p>
    </section>
  );
}
