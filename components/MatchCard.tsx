import Link from "next/link";
import type { MatchWithTeams, Team } from "@/lib/types";
import { getTeamColors } from "@/lib/team-colors";

export type EloEntry = { elo: number; initial_elo: number | null };

// ── color helpers ─────────────────────────────────────────────────────────────

function shiftColor(hex: string, amount: number): string {
  const r = Math.min(255, Math.max(0, parseInt(hex.slice(1, 3), 16) + amount));
  const g = Math.min(255, Math.max(0, parseInt(hex.slice(3, 5), 16) + amount));
  const b = Math.min(255, Math.max(0, parseInt(hex.slice(5, 7), 16) + amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Scale bright colors darker (preserving hue) so white text stays readable. */
function ensureWhiteContrast(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = r * 0.299 + g * 0.587 + b * 0.114;
  if (lum <= 145) return hex;
  const f = 145 / lum;
  const nr = Math.round(r * f);
  const ng = Math.round(g * f);
  const nb = Math.round(b * f);
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

// ── sub-components ────────────────────────────────────────────────────────────

function CompactElo({ elo, initial }: { elo: number; initial: number }) {
  const delta = Math.round(elo - initial);
  const rounded = Math.round(elo);
  const up = delta > 0;
  return (
    <span className="flex items-center gap-0.5 tabular-nums text-[10px] font-bold leading-none text-white">
      <span>{rounded}</span>
      {delta !== 0 && (
        <span
          className="rounded-sm px-0.5"
          style={{ backgroundColor: up ? "#16a34a" : "#dc2626" }}
          title={`${up ? "+" : ""}${delta} since tournament start`}
        >
          {up ? "▲" : "▼"}{Math.abs(delta)}
        </span>
      )}
    </span>
  );
}

const STAGE_LABEL: Record<string, string> = {
  group: "Group",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  third_place: "Third place",
  final: "Final",
};

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
  eloEntry,
  color,
}: {
  team: Team | null;
  score: number | null;
  pens: number | null;
  eloEntry?: EloEntry | null;
  color: string;
}) {
  const c = ensureWhiteContrast(color);
  const gradient = `linear-gradient(135deg, ${shiftColor(c, 18)} 0%, ${c} 45%, ${shiftColor(c, -28)} 100%)`;

  return (
    <div
      className="flex items-center justify-between gap-3 px-3 py-2.5 text-white"
      style={{ background: gradient }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {team?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={team.logo_url}
            alt=""
            className="h-5 w-5 rounded-full object-cover ring-1 ring-white/25"
          />
        ) : (
          <span
            className="h-5 w-5 rounded-full"
            style={{ backgroundColor: shiftColor(color, 30) }}
          />
        )}
        <div className="min-w-0">
          <span className="block truncate text-sm font-bold">
            {team?.name ?? "TBD"}
          </span>
          {eloEntry?.initial_elo != null && (
            <CompactElo elo={eloEntry.elo} initial={eloEntry.initial_elo} />
          )}
        </div>
      </div>
      <div className="flex items-baseline gap-1 shrink-0">
        <span className="text-lg tabular-nums font-bold">
          {score ?? ""}
        </span>
        {pens != null && (
          <span className="text-xs tabular-nums font-bold">
            ({pens})
          </span>
        )}
      </div>
    </div>
  );
}

// ── card ───────────────────────────────────────────────────────────────────────

const FALLBACK_HOME = "#404040";
const FALLBACK_AWAY = "#6b6b6b";

export default function MatchCard({
  match,
  live,
  minute,
  eloByTeam,
}: {
  match: MatchWithTeams;
  live?: boolean;
  minute?: number | null;
  eloByTeam?: Record<number, EloEntry>;
}) {
  const kickoff = new Date(match.kickoff_at);
  const isLive = live ?? match.status === "live";
  const phase = isLive
    ? match.status_short === "HT"
      ? "HT"
      : minute != null
        ? `${minute}'`
        : LIVE_PHASE[match.status_short] ?? "LIVE"
    : null;

  const homeColor = match.home_team
    ? getTeamColors(match.home_team.country_code).main
    : FALLBACK_HOME;
  const awayColor = match.away_team
    ? getTeamColors(match.away_team.country_code).secondary
    : FALLBACK_AWAY;

  return (
    <Link
      href={`/matches/${match.id}`}
      className={
        "block w-56 shrink-0 overflow-hidden rounded-xl border transition-shadow hover:shadow-lg " +
        (isLive
          ? "border-red-500/60 ring-1 ring-red-500/30"
          : "border-neutral-200 dark:border-neutral-800")
      }
    >
      {/* Header */}
      <div className="flex items-center justify-between bg-white px-3.5 pt-2.5 pb-2 text-xs dark:bg-neutral-950">
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
      {/* Team rows — opaque team-color gradient fills */}
      <TeamRow
        team={match.home_team}
        score={match.home_score}
        pens={match.pen_home}
        eloEntry={match.home_team_id != null ? eloByTeam?.[match.home_team_id] : null}
        color={homeColor}
      />
      <TeamRow
        team={match.away_team}
        score={match.away_score}
        pens={match.pen_away}
        eloEntry={match.away_team_id != null ? eloByTeam?.[match.away_team_id] : null}
        color={awayColor}
      />
    </Link>
  );
}
