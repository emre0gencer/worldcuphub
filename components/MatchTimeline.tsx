"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MatchCard, { type EloEntry } from "@/components/MatchCard";
import type { MatchWithTeams } from "@/lib/types";

// How long after kickoff a match is treated as live when the DB status hasn't
// been refreshed by the worker — covers 90' + half-time + stoppage, plus extra
// time / penalties in knockouts.
const LIVE_WINDOW_MS = 140 * 60 * 1000;

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isLiveNow(m: MatchWithTeams, now: number): boolean {
  if (m.status === "finished") return false;
  if (m.status === "live") return true;
  const ko = new Date(m.kickoff_at).getTime();
  return now >= ko && now < ko + LIVE_WINDOW_MS;
}

function fullDate(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// Returns the primary heading plus, for relative labels, the absolute date to
// show alongside it. For non-relative days the label already is the date, so the
// secondary slot stays empty to avoid repetition.
function dayLabel(key: string, todayKey: string): { label: string; date: string | null } {
  const date = new Date(`${key}T00:00:00`);
  const today = new Date(`${todayKey}T00:00:00`);
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return { label: "Today", date: fullDate(key) };
  if (diff === -1) return { label: "Yesterday", date: fullDate(key) };
  if (diff === 1) return { label: "Tomorrow", date: fullDate(key) };
  return { label: fullDate(key), date: null };
}

export default function MatchTimeline({
  matches,
  liveMinutes = {},
  eloByTeam,
}: {
  matches: MatchWithTeams[];
  liveMinutes?: Record<number, number | null>;
  eloByTeam?: Record<number, EloEntry>;
}) {
  // Re-evaluate live windows every minute without a server round-trip.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const todayKey = localDateKey(new Date(now));

  const days = useMemo(() => {
    const map = new Map<string, MatchWithTeams[]>();
    for (const m of matches) {
      const k = localDateKey(new Date(m.kickoff_at));
      map.set(k, [...(map.get(k) ?? []), m]);
    }
    for (const arr of map.values()) {
      arr.sort(
        (a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime(),
      );
    }
    return [...map.keys()].sort().map((key) => ({ key, matches: map.get(key)! }));
  }, [matches]);

  const hasToday = days.some((d) => d.key === todayKey);

  // A completed tournament (e.g. the 2022 archive) has no match today or in the
  // future. There's no meaningful "today" there, so we drop the Today marker and
  // the scroll-to-today entirely and simply start at the beginning (the earliest
  // matchday, top of the list).
  const isArchived = days.length > 0 && !days.some((d) => d.key >= todayKey);

  // For a live tournament: on every mount — including navigating back from
  // another page — start at the top and then *animate* a smooth scroll down to
  // today, so the scroll effect is visible rather than an instant jump. Past
  // results sit above (scroll up), upcoming fixtures below (scroll down). The
  // double rAF defers past Next.js's own scroll-to-top so we begin cleanly.
  const anchorRef = useRef<HTMLElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (isArchived || scrolled.current) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    scrolled.current = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0 });
        // Brief beat at the top so the downward scroll reads as deliberate.
        setTimeout(() => anchor.scrollIntoView({ block: "start", behavior: "smooth" }), 300);
      }),
    );
  }, [days.length, isArchived]);

  const rows: React.ReactNode[] = [];
  let markerPlaced = false;
  for (const d of days) {
    if (!isArchived && !hasToday && !markerPlaced && d.key > todayKey) {
      rows.push(<TodayMarker key="today-marker" date={fullDate(todayKey)} anchorRef={anchorRef} />);
      markerPlaced = true;
    }
    const isToday = d.key === todayKey;
    const { label, date } = dayLabel(d.key, todayKey);
    rows.push(
      <DaySection
        key={d.key}
        label={label}
        date={date}
        matches={d.matches}
        now={now}
        liveMinutes={liveMinutes}
        eloByTeam={eloByTeam}
        isToday={isToday}
        anchorRef={isToday ? anchorRef : undefined}
      />,
    );
  }
  // Live tournament with a gap (no fixtures today, but more to come) → anchor the
  // present between past and upcoming. Archived tournaments get no marker.
  if (!isArchived && !hasToday && !markerPlaced) {
    rows.push(<TodayMarker key="today-marker" date={fullDate(todayKey)} anchorRef={anchorRef} />);
  }

  return <div className="space-y-12">{rows}</div>;
}

function DaySection({
  label,
  date,
  matches,
  now,
  liveMinutes,
  eloByTeam,
  isToday,
  anchorRef,
}: {
  label: string;
  date: string | null;
  matches: MatchWithTeams[];
  now: number;
  liveMinutes: Record<number, number | null>;
  eloByTeam?: Record<number, EloEntry>;
  isToday: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  const liveCount = matches.filter((m) => isLiveNow(m, now)).length;
  return (
    <section ref={anchorRef} id={isToday ? "today-anchor" : undefined} className="scroll-mt-24">
      <div className="mb-3 flex items-baseline gap-3">
        <h2
          className={
            isToday
              ? "font-display text-2xl font-black tracking-tight text-ink"
              : "font-mono text-xs font-semibold uppercase tracking-[0.14em] text-foil"
          }
        >
          {label}
        </h2>
        {date && (
          <span className="text-xs font-normal normal-case text-muted">{date}</span>
        )}
        <span className="h-px flex-1 self-center bg-gradient-to-r from-border-warm to-transparent" />
        {liveCount > 0 && (
          <span className="flex items-center gap-1.5 font-mono text-xs font-semibold text-red-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />
            {liveCount} live
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        {matches.map((m) => (
          <MatchCard key={m.id} match={m} live={isLiveNow(m, now)} minute={liveMinutes[m.id]} eloByTeam={eloByTeam} />
        ))}
      </div>
    </section>
  );
}

function TodayMarker({
  date,
  anchorRef,
}: {
  date: string;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  return (
    <section ref={anchorRef} id="today-anchor" className="scroll-mt-24">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="font-display text-2xl font-black tracking-tight text-ink">Today</h2>
        <span className="text-xs font-normal text-muted">{date}</span>
        <span className="h-px flex-1 self-center bg-gradient-to-r from-border-warm to-transparent" />
      </div>
      <p className="text-sm text-muted">
        No fixtures today — scroll up for past results, down for what&apos;s next.
      </p>
    </section>
  );
}
