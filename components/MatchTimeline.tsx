"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MatchCard from "@/components/MatchCard";
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

export default function MatchTimeline({ matches }: { matches: MatchWithTeams[] }) {
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

  // On every mount — including navigating back from another page — start at the
  // top and then *animate* a smooth scroll down to today, so the scroll effect
  // is visible rather than an instant jump. Past results sit above (scroll up),
  // upcoming fixtures below (scroll down). The double rAF defers past Next.js's
  // own scroll-to-top so we begin cleanly from the top.
  const anchorRef = useRef<HTMLElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current) return;
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
  }, [days.length]);

  const rows: React.ReactNode[] = [];
  let markerPlaced = false;
  for (const d of days) {
    if (!hasToday && !markerPlaced && d.key > todayKey) {
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
        isToday={isToday}
        anchorRef={isToday ? anchorRef : undefined}
      />,
    );
  }
  // All fixtures already played → anchor the present at the very bottom.
  if (!hasToday && !markerPlaced) {
    rows.push(<TodayMarker key="today-marker" date={fullDate(todayKey)} anchorRef={anchorRef} />);
  }

  return <div className="space-y-12">{rows}</div>;
}

function DaySection({
  label,
  date,
  matches,
  now,
  isToday,
  anchorRef,
}: {
  label: string;
  date: string | null;
  matches: MatchWithTeams[];
  now: number;
  isToday: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  const liveCount = matches.filter((m) => isLiveNow(m, now)).length;
  return (
    <section ref={anchorRef} id={isToday ? "today-anchor" : undefined} className="scroll-mt-24">
      <div className="mb-3 flex items-center gap-3">
        <h2
          className={
            isToday
              ? "text-base font-bold tracking-tight"
              : "text-sm font-semibold uppercase tracking-wide text-neutral-500"
          }
        >
          {label}
        </h2>
        {date && (
          <span className="text-xs font-normal normal-case text-neutral-400">{date}</span>
        )}
        <span className="h-px flex-1 bg-gradient-to-r from-neutral-200 to-transparent dark:from-neutral-800" />
        {liveCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />
            {liveCount} live
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        {matches.map((m) => (
          <MatchCard key={m.id} match={m} live={isLiveNow(m, now)} />
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
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-base font-bold tracking-tight">Today</h2>
        <span className="text-xs font-normal text-neutral-400">{date}</span>
        <span className="h-px flex-1 bg-gradient-to-r from-neutral-200 to-transparent dark:from-neutral-800" />
      </div>
      <p className="text-sm text-neutral-500">
        No fixtures today — scroll up for past results, down for what&apos;s next.
      </p>
    </section>
  );
}
