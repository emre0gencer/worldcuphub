import Link from "next/link";
import type { MatchWithTeams, Team } from "@/lib/types";

const STAGE_LABEL: Record<string, string> = {
  group: "Group",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  third_place: "Third place",
  final: "Final",
};

// Map an API "short" status to a compact live-phase label for the badge.
const LIVE_PHASE: Record<string, string> = {
  "1H": "1H",
  "2H": "2H",
  HT: "HT",
  ET: "ET",
  BT: "ET",
  P: "PEN",
  SUSP: "SUSP",
  INT: "INT",
  LIVE: "LIVE",
};

function TeamRow({
  team,
  score,
  pens,
}: {
  team: Team | null;
  score: number | null;
  pens: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {team?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={team.logo_url} alt="" className="h-4 w-6 rounded-[2px] object-cover" />
        ) : (
          <span className="h-4 w-6 rounded-[2px] bg-neutral-200 dark:bg-neutral-800" />
        )}
        <span className="truncate text-sm font-medium">{team?.name ?? "TBD"}</span>
      </div>
      <span className="text-sm tabular-nums font-semibold">
        {score ?? ""}
        {pens != null && <span className="text-neutral-400 font-normal"> ({pens})</span>}
      </span>
    </div>
  );
}

export default function MatchCard({
  match,
  live,
  minute,
}: {
  match: MatchWithTeams;
  live?: boolean;
  minute?: number | null;
}) {
  const kickoff = new Date(match.kickoff_at);
  // `live` is supplied by the timeline (time-aware); fall back to the DB status.
  const isLive = live ?? match.status === "live";
  // FIFA-style running clock: prefer the live minute; HT shows "HT"; fall back
  // to the phase label (1H/2H/…) only when no minute is available yet.
  const phase = isLive
    ? match.status_short === "HT"
      ? "HT"
      : minute != null
        ? `${minute}'`
        : LIVE_PHASE[match.status_short] ?? "LIVE"
    : null;

  return (
    <Link
      href={`/matches/${match.id}`}
      className={
        "block w-56 shrink-0 rounded-xl border p-4 transition-colors " +
        (isLive
          ? "border-red-500/60 bg-red-50/70 ring-1 ring-red-500/30 hover:border-red-500 dark:bg-red-950/20"
          : "border-neutral-200 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600")
      }
    >
      <div className="mb-3 flex items-center justify-between text-xs">
        <span className="text-neutral-500">
          {match.stage === "group" && match.group_letter
            ? `Group ${match.group_letter}`
            : STAGE_LABEL[match.stage]}
        </span>
        {isLive ? (
          <span className="flex items-center gap-1.5 rounded-full bg-red-600 px-2 py-0.5 font-semibold text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            {phase}
          </span>
        ) : match.status === "finished" ? (
          <span className="text-neutral-500">
            {match.pen_home != null ? "PEN" : match.status_short === "AET" ? "AET" : "FT"}
          </span>
        ) : (
          <span className="tabular-nums text-neutral-500">
            {kickoff.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      <div className="space-y-2">
        <TeamRow team={match.home_team} score={match.home_score} pens={match.pen_home} />
        <TeamRow team={match.away_team} score={match.away_score} pens={match.pen_away} />
      </div>
    </Link>
  );
}
