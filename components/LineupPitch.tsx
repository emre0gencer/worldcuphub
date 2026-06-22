import type { MatchLineup, MatchLineupPlayer, Team } from "@/lib/types";

type Placed = { player: MatchLineupPlayer; x: number; y: number };

/**
 * Project a team's starting XI onto one half of a vertical pitch from the
 * API `grid` field ("row:col", row 1 = goalkeeper). Home defends the bottom,
 * away the top (mirrored), so the two formations face each other.
 */
function placeStarters(players: MatchLineupPlayer[], isHome: boolean): Placed[] {
  const starters = players.filter((p) => p.starter && p.grid);
  const rows = new Map<number, MatchLineupPlayer[]>();
  for (const p of starters) {
    const row = Number(p.grid!.split(":")[0]);
    (rows.get(row) ?? rows.set(row, []).get(row)!).push(p);
  }
  const rowNums = [...rows.keys()].sort((a, b) => a - b);
  const lastRow = Math.max(rowNums.length - 1, 1);

  const placed: Placed[] = [];
  rowNums.forEach((rowNum, rowIdx) => {
    const line = rows
      .get(rowNum)!
      .slice()
      .sort((a, b) => Number(a.grid!.split(":")[1]) - Number(b.grid!.split(":")[1]));
    // depth: 0 = goalkeeper (own goal line) → 1 = furthest forward (halfway)
    const depth = rowIdx / lastRow;
    const y = isHome ? 95 - depth * 43 : 5 + depth * 43;
    line.forEach((p, k) => {
      const spread = ((k + 1) / (line.length + 1)) * 100;
      placed.push({ player: p, x: isHome ? spread : 100 - spread, y });
    });
  });
  return placed;
}

function PlayerMarker({ placed, color }: { placed: Placed; color: string }) {
  const { player, x, y } = placed;
  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full border border-white/70 font-mono text-[0.7rem] font-bold text-white shadow-md"
        style={{ backgroundColor: color }}
      >
        {player.shirt_number ?? ""}
      </span>
      <span className="max-w-[5.5rem] truncate rounded bg-black/35 px-1 text-[0.6rem] font-medium leading-tight text-white">
        {player.player_name}
      </span>
    </div>
  );
}

function TeamHeader({ team, lineup, align }: { team: Team; lineup?: MatchLineup; align: "left" | "right" }) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <span className="font-display text-sm font-bold tracking-tight text-white drop-shadow">{team.name}</span>
      {lineup?.formation && (
        <span className="ml-2 font-mono text-[0.7rem] text-white/75">{lineup.formation}</span>
      )}
    </div>
  );
}

function SubsList({ team, players, color }: { team: Team; players: MatchLineupPlayer[]; color: string }) {
  const subs = players.filter((p) => !p.starter);
  if (subs.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-muted">
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        {team.name} · subs
      </p>
      <ul className="space-y-1 text-sm">
        {subs.map((p) => (
          <li key={p.id} className="flex items-baseline gap-2 text-muted">
            <span className="w-6 text-right font-mono text-xs tabular-nums">{p.shirt_number}</span>
            <span className="text-ink/80">{p.player_name}</span>
            {p.position && <span className="text-[0.65rem] uppercase tracking-wide">{p.position}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LineupPitch({
  home,
  away,
  homeLineup,
  awayLineup,
  homePlayers,
  awayPlayers,
  homeColor,
  awayColor,
}: {
  home: Team;
  away: Team;
  homeLineup?: MatchLineup;
  awayLineup?: MatchLineup;
  homePlayers: MatchLineupPlayer[];
  awayPlayers: MatchLineupPlayer[];
  homeColor: string;
  awayColor: string;
}) {
  const homePlaced = placeStarters(homePlayers, true);
  const awayPlaced = placeStarters(awayPlayers, false);

  return (
    <div className="space-y-5">
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-border-warm shadow-sm"
        style={{ aspectRatio: "3 / 4", backgroundColor: "var(--color-pitch)" }}
      >
        {/* mown stripes */}
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(255,255,255,0.10) 0 8.33%, transparent 8.33% 16.66%)",
          }}
        />
        {/* pitch markings */}
        <svg viewBox="0 0 100 133" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          <g fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.4">
            <rect x="3" y="3" width="94" height="127" />
            <line x1="3" y1="66.5" x2="97" y2="66.5" />
            <circle cx="50" cy="66.5" r="11" />
            <circle cx="50" cy="66.5" r="0.8" fill="rgba(255,255,255,0.5)" />
            {/* bottom box (home) */}
            <rect x="22" y="112" width="56" height="18" />
            <rect x="38" y="124" width="24" height="6" />
            {/* top box (away) */}
            <rect x="22" y="3" width="56" height="18" />
            <rect x="38" y="3" width="24" height="6" />
          </g>
        </svg>

        {/* team labels */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <TeamHeader team={away} lineup={awayLineup} align="left" />
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-end p-3">
          <TeamHeader team={home} lineup={homeLineup} align="right" />
        </div>

        {/* players */}
        {awayPlaced.map((pl) => (
          <PlayerMarker key={pl.player.id} placed={pl} color={awayColor} />
        ))}
        {homePlaced.map((pl) => (
          <PlayerMarker key={pl.player.id} placed={pl} color={homeColor} />
        ))}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <SubsList team={home} players={homePlayers} color={homeColor} />
        <SubsList team={away} players={awayPlayers} color={awayColor} />
      </div>
    </div>
  );
}
