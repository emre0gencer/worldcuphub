import Link from "next/link";
import type { MatchWithTeams, Team } from "@/lib/types";

const STAGE_LABEL: Record<string, string> = {
  group: "Group",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  final: "Final",
};

function TeamRow({ team, score }: { team: Team | null; score: number | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {team?.flag_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={team.flag_url} alt="" className="h-4 w-6 rounded-[2px] object-cover" />
        ) : (
          <span className="h-4 w-6 rounded-[2px] bg-neutral-200 dark:bg-neutral-800" />
        )}
        <span className="truncate text-sm font-medium">{team?.name ?? "TBD"}</span>
      </div>
      <span className="text-sm tabular-nums font-semibold">{score ?? ""}</span>
    </div>
  );
}

export default function MatchCard({ match }: { match: MatchWithTeams }) {
  const kickoff = new Date(match.kickoff_at);
  return (
    <Link
      href={`/matches/${match.id}`}
      className="block w-56 shrink-0 rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 transition-colors hover:border-neutral-400 dark:hover:border-neutral-600"
    >
      <div className="mb-3 flex items-center justify-between text-xs text-neutral-500">
        <span>
          {match.stage === "group" && match.group_letter
            ? `Group ${match.group_letter}`
            : STAGE_LABEL[match.stage]}
        </span>
        {match.status === "live" ? (
          <span className="flex items-center gap-1 font-semibold text-red-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />
            LIVE
          </span>
        ) : match.status === "finished" ? (
          <span>FT</span>
        ) : (
          <span className="tabular-nums">
            {kickoff.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      <div className="space-y-2">
        <TeamRow team={match.home_team} score={match.home_score} />
        <TeamRow team={match.away_team} score={match.away_score} />
      </div>
    </Link>
  );
}
