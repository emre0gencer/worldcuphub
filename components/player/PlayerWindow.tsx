"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getPlayerProfile } from "@/lib/queries";
import { getTeamColors } from "@/lib/team-colors";
import { RatingBadge } from "@/components/RatingBadge";
import type {
  PlayerProfile,
  PlayerProfileTotals,
  PlayerStatKey,
  Stage,
} from "@/lib/types";
import type { PlayerModalRequest } from "./PlayerModalProvider";

// ── headline ("main stat") config, one per click context ─────────────────────
const HERO: Record<
  PlayerStatKey,
  { label: string; get: (t: PlayerProfileTotals) => number | null; fmt?: (v: number) => string }
> = {
  goals: { label: "Goals", get: (t) => t.goals },
  assists: { label: "Assists", get: (t) => t.assists },
  goal_contributions: { label: "Goal contributions", get: (t) => t.goalContributions },
  rating: { label: "Average rating", get: (t) => t.avgRating, fmt: (v) => v.toFixed(2) },
  saves: { label: "Saves", get: (t) => t.saves },
  clean_sheets: { label: "Clean sheets", get: (t) => t.cleanSheets },
  key_passes: { label: "Key passes", get: (t) => t.keyPasses },
  dribbles: { label: "Dribbles completed", get: (t) => t.dribblesSucceeded },
  shots: { label: "Shots", get: (t) => t.shots },
  tackles: { label: "Tackles", get: (t) => t.tackles },
  interceptions: { label: "Interceptions", get: (t) => t.interceptions },
  minutes: { label: "Minutes played", get: (t) => t.minutes },
};

const STAGE_SHORT: Record<Stage, string> = {
  group: "Group",
  R32: "R32",
  R16: "R16",
  QF: "QF",
  SF: "SF",
  third_place: "3rd",
  final: "Final",
};

const POSITION_LABEL: Record<string, string> = {
  G: "Goalkeeper",
  D: "Defender",
  M: "Midfielder",
  F: "Forward",
  Goalkeeper: "Goalkeeper",
  Defender: "Defender",
  Midfielder: "Midfielder",
  Attacker: "Forward",
};

const isGoalkeeper = (pos: string | null) => !!pos && pos[0]?.toUpperCase() === "G";

function chooseDefaultHighlight(p: PlayerProfile): PlayerStatKey {
  if (isGoalkeeper(p.position)) return "saves";
  if (p.totals.goalContributions > 0) return "goal_contributions";
  return "rating";
}

/** "67%" or null when there's nothing to divide by. */
const pct = (part: number, whole: number): string | null =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : null;

function ageFrom(birth: string | null): number | null {
  if (!birth) return null;
  const d = new Date(birth);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

// ── small presentational helpers ─────────────────────────────────────────────

function Tile({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border-warm bg-surface px-3 py-2.5 text-center">
      <div
        className={`font-mono text-xl font-bold tabular-nums ${accent ? "text-foil" : "text-ink"}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[0.65rem] uppercase tracking-[0.1em] text-muted">{label}</div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-light py-1.5 last:border-b-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}

function StatGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="eyebrow mb-1.5">{title}</h4>
      <div className="rounded-xl border border-border-warm bg-surface px-3">{children}</div>
    </div>
  );
}

const RESULT_STYLE: Record<"W" | "D" | "L", { bg: string; fg: string }> = {
  W: { bg: "#16653420", fg: "#15803d" },
  D: { bg: "#8c817020", fg: "#8c8170" },
  L: { bg: "#b91c1c20", fg: "#b91c1c" },
};

// ── the modal ─────────────────────────────────────────────────────────────────

export default function PlayerWindow({
  request,
  onClose,
}: {
  request: PlayerModalRequest;
  onClose: () => void;
}) {
  const { playerId, season, highlight, name } = request;
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");

  // Lock body scroll + close on Escape while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Fetch the profile on mount. The provider remounts this component per
  // request (via key), so state always starts fresh in "loading".
  useEffect(() => {
    let cancelled = false;
    getPlayerProfile(playerId, season)
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          setState("empty");
          return;
        }
        setProfile(p);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("PlayerWindow: failed to load profile", err);
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [playerId, season]);

  return (
    <div
      className="modal-overlay fixed inset-0 z-[100] flex items-end justify-center bg-ink/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={name ? `${name} — player profile` : "Player profile"}
        onClick={(e) => e.stopPropagation()}
        className="modal-card relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-border-warm bg-paper shadow-2xl sm:rounded-3xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border-warm bg-surface/90 text-muted backdrop-blur transition-colors hover:text-ink"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        {state === "loading" && <LoadingBody name={name} />}
        {state === "error" && (
          <EmptyBody message="Couldn't load this player right now. Please try again." />
        )}
        {state === "empty" && (
          <EmptyBody message="No tournament data is tracked for this player yet." />
        )}
        {state === "ready" && profile && (
          <ProfileBody profile={profile} highlight={highlight} />
        )}
      </div>
    </div>
  );
}

function LoadingBody({ name }: { name?: string }) {
  return (
    <div className="animate-pulse p-6">
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 rounded-xl bg-surface-warm" />
        <div className="space-y-2">
          <div className="h-3 w-20 rounded bg-surface-warm" />
          <div className="h-5 w-40 rounded bg-surface-warm" />
          <div className="h-3 w-24 rounded bg-surface-warm" />
        </div>
      </div>
      <p className="mt-6 text-sm text-muted">Loading {name ?? "player"}…</p>
    </div>
  );
}

function EmptyBody({ message }: { message: string }) {
  return (
    <div className="p-10 text-center">
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}

function ProfileBody({
  profile,
  highlight,
}: {
  profile: PlayerProfile;
  highlight?: PlayerStatKey;
}) {
  const { player, team, totals, log, position, season } = profile;
  const accent = getTeamColors(team?.country_code ?? null).main;
  const heroKey = highlight ?? chooseDefaultHighlight(profile);
  const hero = HERO[heroKey];
  const heroValueRaw = hero.get(totals);
  const heroValue =
    heroValueRaw == null ? "–" : hero.fmt ? hero.fmt(heroValueRaw) : String(heroValueRaw);

  const first = player.firstname ?? "";
  const last = player.lastname ?? "";
  const hasSplit = !!(first || last);
  const age = ageFrom(player.birth_date);
  const posLabel = position ? (POSITION_LABEL[position] ?? position) : null;
  const gk = isGoalkeeper(position);

  // Derived, "smart audience" composites from the raw API counts.
  const t = totals;
  const shotsVal =
    t.shots > 0
      ? `${t.shots} · ${t.shotsOnTarget} on target (${pct(t.shotsOnTarget, t.shots)})`
      : String(t.shots);
  const dribbleSucc = pct(t.dribblesSucceeded, t.dribblesAttempted);
  const dribblesVal = `${t.dribblesSucceeded}/${t.dribblesAttempted}${dribbleSucc ? ` (${dribbleSucc})` : ""}`;
  const duelWin = pct(t.duelsWon, t.duels);
  const duelsVal = `${t.duelsWon}/${t.duels}${duelWin ? ` (${duelWin})` : ""}`;
  const passesVal = t.passes
    ? `${t.passes}${t.passAccuracy != null ? ` · ${t.passAccuracy.toFixed(0)}% acc` : ""}`
    : null;

  const penBits: string[] = [];
  if (t.penaltiesScored) penBits.push(`${t.penaltiesScored} scored`);
  if (t.penaltiesMissed) penBits.push(`${t.penaltiesMissed} missed`);
  if (t.penaltiesWon) penBits.push(`${t.penaltiesWon} won`);
  if (t.penaltiesCommitted) penBits.push(`${t.penaltiesCommitted} conceded`);
  // `saved` is surfaced in the goalkeeping group, so it's omitted here.

  return (
    <div>
      {/* Header band — tinted with the team's identity colour */}
      <div
        className="relative px-6 pb-5 pt-7"
        style={{
          background: `linear-gradient(135deg, ${accent}1f, transparent 70%)`,
        }}
      >
        <div className="flex items-center gap-4">
          {player.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.photo_url}
              alt=""
              className="h-20 w-20 shrink-0 rounded-xl border border-border-warm bg-surface object-cover shadow-sm"
            />
          ) : (
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-border-warm bg-surface font-display text-2xl font-black text-muted shadow-sm">
              {(last || player.name).slice(0, 1)}
            </div>
          )}
          <div className="min-w-0">
            {posLabel && <p className="eyebrow mb-1">{posLabel}</p>}
            <h2 className="font-display text-2xl font-black leading-[1.05] tracking-tight text-ink">
              {hasSplit ? (
                <>
                  <span className="block text-sm font-medium text-muted">{first}</span>
                  {last || player.name}
                </>
              ) : (
                player.name
              )}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              {team?.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={team.logo_url} alt="" className="h-4 w-4 object-contain" />
              )}
              {team && <span className="font-medium text-ink">{team.name}</span>}
              {age != null && (
                <>
                  <span aria-hidden>·</span>
                  <span>{age} yrs</span>
                </>
              )}
              {player.height && (
                <>
                  <span aria-hidden>·</span>
                  <span>{player.height}</span>
                </>
              )}
              {t.captainedMatches > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-foil/15 px-1.5 py-0.5 text-[0.7rem] font-medium text-foil">
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-foil text-[0.55rem] font-bold text-white">
                    C
                  </span>
                  Captain{t.captainedMatches > 1 ? ` ×${t.captainedMatches}` : ""}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-6 pt-4">
        {/* Headline ("main stat", chosen by click context) + quick context */}
        <div className="flex items-stretch gap-4 rounded-2xl border border-border-warm bg-surface p-4">
          <div className="flex flex-col justify-center border-r border-border-light pr-4">
            <span className="font-display text-5xl font-black leading-none tabular-nums text-ink">
              {heroValue}
            </span>
            <span className="mt-1.5 text-[0.7rem] uppercase tracking-[0.12em] text-foil">
              {hero.label}
            </span>
          </div>
          <div className="flex flex-1 items-center">
            <p className="text-sm leading-relaxed text-muted">
              {totals.appearances > 0 ? (
                <>
                  Across <strong className="font-semibold text-ink">{totals.appearances}</strong>{" "}
                  {totals.appearances === 1 ? "appearance" : "appearances"} ({totals.starts} start
                  {totals.starts === 1 ? "" : "s"}) and{" "}
                  <strong className="font-semibold text-ink">{totals.minutes}</strong> minutes at the{" "}
                  {season} World Cup.
                </>
              ) : (
                <>Yet to feature at the {season} World Cup.</>
              )}
            </p>
          </div>
        </div>

        {/* At-a-glance tiles */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Tile label="Apps" value={totals.appearances} />
          <Tile label="Mins" value={totals.minutes} />
          {gk ? (
            <>
              <Tile label="Saves" value={totals.saves} accent />
              <Tile label="Clean sheets" value={totals.cleanSheets} accent />
              <Tile label="Conceded" value={totals.goalsConceded} />
            </>
          ) : (
            <>
              <Tile label="Goals" value={totals.goals} accent />
              <Tile label="Assists" value={totals.assists} accent />
              <Tile label="Shots" value={totals.shots} />
            </>
          )}
          <Tile
            label="Rating"
            value={totals.avgRating != null ? totals.avgRating.toFixed(2) : "–"}
          />
        </div>

        {/* Full breakdown — role-aware */}
        <div className="grid gap-4 sm:grid-cols-2">
          {gk ? (
            <StatGroup title="Goalkeeping">
              <StatRow label="Saves" value={totals.saves} />
              <StatRow label="Clean sheets" value={totals.cleanSheets} />
              <StatRow label="Goals conceded" value={totals.goalsConceded} />
              <StatRow label="Penalties saved" value={totals.penaltiesSaved || null} />
              <StatRow
                label="Pass accuracy"
                value={totals.passAccuracy != null ? `${totals.passAccuracy.toFixed(0)}%` : null}
              />
            </StatGroup>
          ) : (
            <StatGroup title="Attacking">
              <StatRow label="Goals" value={totals.goals} />
              <StatRow label="Assists" value={totals.assists} />
              <StatRow label="Shots" value={shotsVal} />
              <StatRow label="Key passes" value={totals.keyPasses} />
              <StatRow label="Passes" value={passesVal} />
              <StatRow label="Dribbles" value={dribblesVal} />
              <StatRow label="Offsides" value={totals.offsides || null} />
            </StatGroup>
          )}

          {gk ? (
            <StatGroup title="Distribution & discipline">
              <StatRow label="Passes" value={totals.passes || null} />
              <StatRow label="Fouls committed" value={totals.foulsCommitted || null} />
              <StatRow label="Yellow cards" value={totals.yellow || null} />
              <StatRow label="Red cards" value={totals.red || null} />
              <StatRow label="Best rating" value={totals.bestRating?.toFixed(1) ?? null} />
            </StatGroup>
          ) : (
            <StatGroup title="Defending & discipline">
              <StatRow label="Tackles" value={totals.tackles} />
              <StatRow label="Interceptions" value={totals.interceptions} />
              <StatRow label="Blocks" value={totals.blocks || null} />
              <StatRow label="Dribbled past" value={totals.dribbledPast || null} />
              <StatRow label="Duels won" value={duelsVal} />
              <StatRow
                label="Fouls (won / committed)"
                value={`${totals.foulsDrawn} / ${totals.foulsCommitted}`}
              />
              <StatRow
                label="Cards (Y / R)"
                value={totals.yellow || totals.red ? `${totals.yellow} / ${totals.red}` : null}
              />
            </StatGroup>
          )}
        </div>

        {penBits.length > 0 && (
          <p className="text-xs text-muted">Penalties: {penBits.join(", ")}.</p>
        )}

        {/* Per-match log — chronological, each row links to the match */}
        {log.length > 0 && (
          <div>
            <h4 className="eyebrow mb-2">Match by match</h4>
            <div className="overflow-hidden rounded-xl border border-border-warm bg-surface">
              {log.map((e) => {
                const r = e.result ? RESULT_STYLE[e.result] : null;
                return (
                  <Link
                    key={e.matchId}
                    href={`/matches/${e.matchId}`}
                    className="flex items-center gap-3 border-b border-border-light px-3 py-2 text-sm transition-colors last:border-b-0 hover:bg-surface-warm"
                  >
                    <span className="w-10 shrink-0 font-mono text-[0.65rem] uppercase tracking-wide text-muted">
                      {e.stage === "group" && e.groupLetter ? `Gp ${e.groupLetter}` : STAGE_SHORT[e.stage]}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="text-[0.7rem] text-muted">{e.isHome ? "vs" : "@"}</span>
                      {e.opponent?.logo_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={e.opponent.logo_url} alt="" className="h-4 w-4 object-contain" />
                      )}
                      <span className="truncate text-ink">{e.opponent?.name ?? "TBD"}</span>
                    </span>
                    {r && (
                      <span
                        className="flex h-5 items-center rounded px-1.5 font-mono text-[0.7rem] font-bold tabular-nums"
                        style={{ backgroundColor: r.bg, color: r.fg }}
                      >
                        {e.result} {e.teamScore}–{e.opponentScore}
                      </span>
                    )}
                    <span className="w-14 shrink-0 text-right font-mono text-[0.7rem] tabular-nums text-muted">
                      {(e.goals ?? 0) > 0 && <span className="text-ink">{e.goals}⚽ </span>}
                      {(e.assists ?? 0) > 0 && <span className="text-ink">{e.assists}🅰 </span>}
                      {e.minutes ?? 0}′
                    </span>
                    <span className="w-11 shrink-0 text-right">
                      <RatingBadge rating={e.rating} />
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-center text-[0.7rem] text-muted">
          {season} World Cup · stats from finished matches · data: API-Football
        </p>
      </div>
    </div>
  );
}
