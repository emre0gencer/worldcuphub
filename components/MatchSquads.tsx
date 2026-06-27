"use client";

import PlayerButton from "@/components/player/PlayerButton";
import { RatingBadge } from "@/components/RatingBadge";
import type { Team } from "@/lib/types";

export interface SquadPlayer {
  playerId: number | null;
  name: string;
  number: number | null;
  position: string | null; // G / D / M / F
  starter: boolean;
  minutes: number | null;
  rating: number | null;
  goals: number | null;
  assists: number | null;
}

function PlayerRow({ p, season, color }: { p: SquadPlayer; season: number; color: string }) {
  return (
    <li>
      <PlayerButton
        playerId={p.playerId}
        season={season}
        highlight="rating"
        name={p.name}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-warm"
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/60 font-mono text-[0.7rem] font-bold tabular-nums text-white shadow-sm"
          style={{ backgroundColor: color }}
        >
          {p.number ?? "–"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
          {p.position && (
            <span className="text-[0.65rem] uppercase tracking-[0.1em] text-muted">
              {p.position}
            </span>
          )}
        </span>
        <span className="shrink-0 font-mono text-[0.7rem] tabular-nums text-muted">
          {(p.goals ?? 0) > 0 && <span className="text-ink">{p.goals}⚽ </span>}
          {(p.assists ?? 0) > 0 && <span className="text-ink">{p.assists}🅰 </span>}
          {p.minutes != null && p.minutes > 0 ? `${p.minutes}′` : ""}
        </span>
        <span className="w-11 shrink-0 text-right">
          <RatingBadge rating={p.rating} />
        </span>
      </PlayerButton>
    </li>
  );
}

function TeamColumn({
  team,
  players,
  season,
  color,
}: {
  team: Team;
  players: SquadPlayer[];
  season: number;
  color: string;
}) {
  const starters = players.filter((p) => p.starter);
  const subs = players.filter((p) => !p.starter);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {team.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={team.logo_url} alt="" className="h-5 w-5 object-contain" />
        )}
        <h3 className="font-display text-base font-bold tracking-tight text-ink">{team.name}</h3>
      </div>
      <ul className="space-y-0.5">
        {starters.map((p, i) => (
          <PlayerRow key={p.playerId ?? `s-${i}`} p={p} season={season} color={color} />
        ))}
      </ul>
      {subs.length > 0 && (
        <>
          <p className="mb-1 mt-3 flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-muted">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            Substitutes
          </p>
          <ul className="space-y-0.5">
            {subs.map((p, i) => (
              <PlayerRow key={p.playerId ?? `b-${i}`} p={p} season={season} color={color} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Scrollable, fully-clickable squad sheet for a match — every player opens the
 * PlayerWindow. Shown in the Squads tab below the scoreboard.
 */
export default function MatchSquads({
  season,
  home,
  away,
  homeSquad,
  awaySquad,
  homeColor,
  awayColor,
}: {
  season: number;
  home: Team;
  away: Team;
  homeSquad: SquadPlayer[];
  awaySquad: SquadPlayer[];
  homeColor: string;
  awayColor: string;
}) {
  if (homeSquad.length === 0 && awaySquad.length === 0) {
    return (
      <p className="rounded-xl border border-border-warm bg-surface px-4 py-5 text-center text-sm text-muted">
        Squad information isn&apos;t available for this match.
      </p>
    );
  }
  return (
    <div className="max-h-[32rem] overflow-y-auto rounded-xl border border-border-warm bg-surface p-3">
      <div className="grid gap-5 sm:grid-cols-2">
        <TeamColumn team={home} players={homeSquad} season={season} color={homeColor} />
        <TeamColumn team={away} players={awaySquad} season={season} color={awayColor} />
      </div>
      <p className="mt-3 px-2 text-[0.7rem] text-muted">Tap any player for their tournament profile.</p>
    </div>
  );
}
