"use client";

/**
 * Horizontal World-Cup knockout bracket (R32 → Final) rendered in the app's
 * almanac aesthetic: engraved cards, animated foil hairline connectors that are
 * *measured* from the real card geometry (so the tree stays exact at any size),
 * and a per-team "recent games" popover that opens into whichever vertical
 * blank space sits next to the hovered slot.
 */

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BracketData, BracketMatchNode, BracketSlot, GameLine } from "@/lib/bracket";

const COL_W = 212; // round column width (px)
const GAP = 56; // gutter between rounds — room for the connector S-curves
const UNIT = 86; // vertical slot per R32 tie; sets the whole bracket height
const CHAMP_W = 164;

// ── recent-games popover ─────────────────────────────────────────────────────

function resultStyle(r: GameLine["result"]): string {
  if (r === "W") return "bg-pitch/15 text-pitch";
  if (r === "L") return "bg-flare/15 text-flare";
  return "bg-neutral-300/60 text-neutral-600";
}

function RecentGamesPopover({
  teamName,
  games,
  anchor,
  openUp,
  onEnter,
  onLeave,
}: {
  teamName: string;
  games: GameLine[];
  anchor: DOMRect;
  openUp: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const width = 248;
  const left = Math.max(8, Math.min(anchor.left - 4, window.innerWidth - width - 8));
  const style: React.CSSProperties = openUp
    ? { bottom: window.innerHeight - anchor.top + 6, left, width }
    : { top: anchor.bottom + 6, left, width };

  return createPortal(
    <div
      className="bracket-pop fixed z-[80]"
      style={style}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="overflow-hidden rounded-xl border border-border-warm bg-surface/95 shadow-[0_12px_40px_-12px_rgba(27,22,19,0.45)] backdrop-blur-sm ring-1 ring-foil/10">
        <div className="flex items-center justify-between gap-2 border-b border-border-light bg-surface-warm/60 px-3 py-2">
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-foil">
            Recent games
          </span>
          <span className="truncate font-display text-xs font-bold text-ink">{teamName}</span>
        </div>
        {games.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted">No matches played yet.</p>
        ) : (
          // 3-game window; the rest is reachable by scrolling
          <ul className="max-h-[126px] divide-y divide-border-light overflow-y-auto overscroll-contain">
            {games.map((g) => (
              <li key={g.matchId}>
                <Link
                  href={`/matches/${g.matchId}`}
                  className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-surface-warm/70"
                >
                  <span className="w-12 shrink-0 font-mono text-[0.58rem] uppercase tracking-wider text-muted">
                    {g.stageLabel}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    {g.oppLogo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.oppLogo} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />
                    )}
                    <span className="truncate text-xs text-ink/90">{g.oppName}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-ink">
                    {g.teamScore}–{g.oppScore}
                    {g.pens && <span className="text-[0.6rem] text-muted"> {g.pens}</span>}
                  </span>
                  {g.live ? (
                    <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500" />
                  ) : (
                    <span
                      className={`grid h-4 w-4 shrink-0 place-items-center rounded text-[0.6rem] font-bold ${resultStyle(g.result)}`}
                    >
                      {g.result}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── a single team row inside a match card ────────────────────────────────────

function TeamRow({
  slot,
  onHover,
  onLeaveTeam,
}: {
  slot: BracketSlot;
  onHover: (teamId: number, name: string, rect: DOMRect) => void;
  onLeaveTeam: () => void;
}) {
  const hoverable = slot.teamId != null;
  return (
    <div
      onMouseEnter={
        hoverable
          ? (e) => onHover(slot.teamId!, slot.name ?? "", e.currentTarget.getBoundingClientRect())
          : undefined
      }
      onMouseLeave={hoverable ? onLeaveTeam : undefined}
      className={`group/row relative flex items-center gap-1.5 px-2.5 py-1.5 transition-colors ${
        hoverable ? "cursor-default hover:bg-foil/[0.06]" : ""
      } ${slot.winner ? "" : slot.name ? "" : "text-muted"}`}
    >
      {slot.winner && (
        <span className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-gradient-to-b from-foil-bright to-foil" />
      )}
      {slot.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slot.logoUrl} alt="" className="h-4 w-4 shrink-0 object-contain" />
      ) : (
        <span className="h-4 w-4 shrink-0 rounded-full border border-dashed border-border-warm" />
      )}
      <span
        className={`min-w-0 flex-1 truncate text-[0.8rem] ${
          slot.name
            ? slot.winner
              ? "font-semibold text-ink"
              : "text-ink/75"
            : "font-mono text-[0.66rem] uppercase tracking-wider text-muted/80"
        }`}
      >
        {slot.name ?? slot.label}
      </span>
      {slot.name && (
        <span className="shrink-0 font-mono text-[0.58rem] uppercase tracking-wider text-muted/55">
          {slot.label}
        </span>
      )}
      <span className="ml-0.5 w-6 shrink-0 text-right font-mono text-[0.8rem] font-semibold tabular-nums text-ink">
        {slot.score ?? ""}
        {slot.pens != null && <span className="text-[0.6rem] text-muted"> {slot.pens}</span>}
      </span>
    </div>
  );
}

// ── a match card ─────────────────────────────────────────────────────────────

function MatchCard({
  node,
  cardRef,
  onHover,
  onLeaveTeam,
}: {
  node: BracketMatchNode;
  cardRef: (el: HTMLElement | null) => void;
  onHover: (teamId: number, name: string, rect: DOMRect) => void;
  onLeaveTeam: () => void;
}) {
  const isLive = node.status === "live";
  const isEmpty = node.status === "empty";
  const body = (
    <>
      <TeamRow slot={node.home} onHover={onHover} onLeaveTeam={onLeaveTeam} />
      <div className="mx-2.5 h-px bg-border-light" />
      <TeamRow slot={node.away} onHover={onHover} onLeaveTeam={onLeaveTeam} />
      {isLive && (
        <span className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-red-500 px-1.5 py-0.5 font-mono text-[0.55rem] font-bold uppercase tracking-wider text-white shadow-sm">
          ● Live
        </span>
      )}
    </>
  );

  const shell = `relative w-full overflow-hidden rounded-lg border bg-surface/90 py-0.5 transition-all duration-200 ${
    isEmpty
      ? "border-dashed border-border-warm/70 bg-surface/40"
      : isLive
        ? "border-red-300 shadow-[0_0_0_3px_rgba(239,68,68,0.10)]"
        : "border-border-warm shadow-sm hover:-translate-y-0.5 hover:border-foil hover:shadow-[0_10px_28px_-14px_rgba(176,136,66,0.6)]"
  }`;

  return (
    <div ref={cardRef} className="relative" style={{ width: COL_W }}>
      {node.matchId != null ? (
        <Link href={`/matches/${node.matchId}`} className={`block ${shell}`}>
          {body}
        </Link>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </div>
  );
}

// ── the bracket ──────────────────────────────────────────────────────────────

interface HoverState {
  teamId: number;
  name: string;
  anchor: DOMRect;
  openUp: boolean;
}

export default function KnockoutBracket({ data }: { data: BracketData }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cards = useRef<Map<string, HTMLElement>>(new Map());
  const [links, setLinks] = useState<string[]>([]);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rows = data.rounds[0]?.matches.length ?? 0;
  const height = Math.max(rows * UNIT, 320);

  // Measure card geometry and rebuild the connector paths.
  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wb = wrap.getBoundingClientRect();
    const edge = (el: HTMLElement, side: "left" | "right") => {
      const b = el.getBoundingClientRect();
      return {
        x: (side === "right" ? b.right : b.left) - wb.left,
        y: b.top - wb.top + b.height / 2,
      };
    };
    const curve = (
      a: { x: number; y: number },
      b: { x: number; y: number },
    ) => {
      const dx = Math.max((b.x - a.x) / 2, 12);
      return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
    };

    const paths: string[] = [];
    for (let L = 1; L < data.rounds.length; L++) {
      const prev = data.rounds[L - 1].matches;
      data.rounds[L].matches.forEach((node, j) => {
        const parent = cards.current.get(node.id);
        const c0 = cards.current.get(prev[2 * j]?.id ?? "");
        const c1 = cards.current.get(prev[2 * j + 1]?.id ?? "");
        if (!parent) return;
        const p = edge(parent, "left");
        for (const child of [c0, c1]) {
          if (child) paths.push(curve(edge(child, "right"), p));
        }
      });
    }
    // Final → champion plinth
    const finalEl = cards.current.get(data.rounds[data.rounds.length - 1]?.matches[0]?.id ?? "");
    const champEl = cards.current.get("champion");
    if (finalEl && champEl) paths.push(curve(edge(finalEl, "right"), edge(champEl, "left")));

    setLinks(paths);
    setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
  }, [data]);

  useLayoutEffect(() => {
    measure();
    const t = setTimeout(measure, 120); // after fonts/images settle
    return () => clearTimeout(t);
  }, [measure]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    window.addEventListener("resize", measure);
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => {});
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const registerCard = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) cards.current.set(id, el);
      else cards.current.delete(id);
    },
    [],
  );

  const clearClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    clearClose();
    closeTimer.current = setTimeout(() => setHover(null), 140);
  };

  const onHover = useCallback((teamId: number, name: string, anchor: DOMRect) => {
    clearClose();
    const wrap = wrapRef.current;
    let openUp = false;
    if (wrap) {
      const wb = wrap.getBoundingClientRect();
      const rel = (anchor.top + anchor.height / 2 - wb.top) / Math.max(wb.height, 1);
      openUp = rel > 0.5; // lower half of the bracket → grow upward into the gap
    }
    // keep it on-screen regardless of the bracket-relative preference
    if (openUp && anchor.top < 160) openUp = false;
    if (!openUp && window.innerHeight - anchor.bottom < 160) openUp = true;
    setHover({ teamId, name, anchor, openUp });
  }, []);

  return (
    <div className="-mx-1 overflow-x-auto pb-4">
      <div className="min-w-max px-1">
        {/* round labels */}
        <div className="mb-4 flex" style={{ gap: GAP }}>
          {data.rounds.map((round, i) => (
            <div
              key={round.key}
              className="reveal text-center"
              style={{ width: COL_W, "--d": `${i * 70}ms` } as React.CSSProperties}
            >
              <div className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-foil">
                {round.label}
              </div>
              <div className="mt-1 h-px bg-gradient-to-r from-transparent via-foil/40 to-transparent" />
            </div>
          ))}
          <div
            className="reveal text-center"
            style={{ width: CHAMP_W, "--d": `${data.rounds.length * 70}ms` } as React.CSSProperties}
          >
            <div className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-foil">
              Champion
            </div>
            <div className="mt-1 h-px bg-gradient-to-r from-transparent via-foil/40 to-transparent" />
          </div>
        </div>

        {/* bracket body */}
        <div ref={wrapRef} className="relative flex" style={{ gap: GAP, height }}>
          {/* connector layer */}
          <svg
            className="pointer-events-none absolute inset-0"
            width={size.w}
            height={size.h}
            fill="none"
          >
            <defs>
              <linearGradient id="foilLink" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--color-foil)" stopOpacity="0.25" />
                <stop offset="100%" stopColor="var(--color-foil)" stopOpacity="0.7" />
              </linearGradient>
            </defs>
            {links.map((d, i) => (
              <path
                key={i}
                d={d}
                pathLength={1}
                className="bracket-link"
                stroke="url(#foilLink)"
                strokeWidth={1.5}
                style={{ animationDelay: `${300 + i * 12}ms` }}
              />
            ))}
          </svg>

          {/* round columns */}
          {data.rounds.map((round, i) => (
            <div
              key={round.key}
              className="reveal relative z-10 flex flex-col justify-around"
              style={{ width: COL_W, "--d": `${i * 70 + 120}ms` } as React.CSSProperties}
            >
              {round.matches.map((node) => (
                <MatchCard
                  key={node.id}
                  node={node}
                  cardRef={registerCard(node.id)}
                  onHover={onHover}
                  onLeaveTeam={scheduleClose}
                />
              ))}
            </div>
          ))}

          {/* champion plinth */}
          <div
            className="reveal relative z-10 flex flex-col justify-around"
            style={
              { width: CHAMP_W, "--d": `${data.rounds.length * 70 + 120}ms` } as React.CSSProperties
            }
          >
            <ChampionPlinth
              champion={data.champion}
              hint={data.finalistHint}
              cardRef={registerCard("champion")}
            />
          </div>
        </div>
      </div>

      {hover && (
        <RecentGamesPopover
          teamName={hover.name}
          games={data.recentGames[hover.teamId] ?? []}
          anchor={hover.anchor}
          openUp={hover.openUp}
          onEnter={clearClose}
          onLeave={scheduleClose}
        />
      )}
    </div>
  );
}

function ChampionPlinth({
  champion,
  hint,
  cardRef,
}: {
  champion: BracketSlot | null;
  hint: string | null;
  cardRef: (el: HTMLElement | null) => void;
}) {
  return (
    <div
      ref={cardRef}
      className="champ-plinth relative overflow-hidden rounded-xl border border-foil/40 bg-gradient-to-br from-[#fbf3df] to-[#f1e3c2] p-3 text-center shadow-[0_10px_30px_-12px_rgba(176,136,66,0.55)]"
      style={{ width: CHAMP_W }}
    >
      <div className="champ-sheen pointer-events-none absolute inset-0" />
      <div className="relative">
        <div className="text-2xl leading-none">🏆</div>
        <div className="mt-1.5 font-mono text-[0.55rem] uppercase tracking-[0.16em] text-foil">
          {champion ? "Champions" : "Awaiting"}
        </div>
        {champion ? (
          <div className="mt-1 flex items-center justify-center gap-1.5">
            {champion.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={champion.logoUrl} alt="" className="h-5 w-5 object-contain" />
            )}
            <span className="font-display text-sm font-black text-ink">{champion.name}</span>
          </div>
        ) : (
          <div className="mt-1 font-display text-xs font-semibold text-ink/55">
            {hint ?? "the final"}
          </div>
        )}
      </div>
    </div>
  );
}
