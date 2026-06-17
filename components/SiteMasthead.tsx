import { DEFAULT_SEASON } from "@/lib/season";

/**
 * Season-aware masthead — the dateline band of the almanac. Rendered in the
 * root layout (so it heads every page) with the active season passed in.
 * Reads as the title block of a printed football annual: edition mark, a
 * foil-stamped year, host, and the project's current status.
 */

interface SeasonMeta {
  bigYear: string; // ghost watermark
  yearLabel: string; // foil-stamped "’22"
  hostShort: string; // inline with the title
  hostDetail: string | null; // optional smaller line
  edition: string; // almanac edition mark
  statusLabel: string;
  live: boolean;
  note: string;
}

const SEASON_META: Record<number, SeasonMeta> = {
  2022: {
    bigYear: "22",
    yearLabel: "’22",
    hostShort: "Qatar",
    hostDetail: null,
    edition: "22nd Edition",
    statusLabel: "Finished demo",
    live: false,
    note: "A finished demonstration of the product — the 2022 tournament, ingested end to end.",
  },
  2026: {
    bigYear: "26",
    yearLabel: "’26",
    hostShort: "USA · Mexico · Canada",
    hostDetail: null,
    edition: "26th Edition",
    statusLabel: "Live ingestion",
    live: true,
    note: "An ongoing live ingestion — a project on continuum, updating as the 2026 tournament unfolds.",
  },
};

function StatusPill({ live, label }: { live: boolean; label: string }) {
  return live ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-red-700 ring-1 ring-inset ring-red-600/20">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />
      {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-foil ring-1 ring-inset ring-border-warm">
      <span className="h-1.5 w-1.5 rounded-full bg-foil" />
      {label}
    </span>
  );
}

export default function SiteMasthead({ season }: { season: number }) {
  const meta = SEASON_META[season] ?? SEASON_META[DEFAULT_SEASON] ?? SEASON_META[2026];

  return (
    <section className="relative overflow-hidden border-b border-border-warm bg-surface-warm/55">
      {/* Ghost year — almanac cover numeral */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-9 right-2 select-none font-display text-[9rem] font-black leading-none text-foil/[0.07] sm:text-[12rem]"
      >
        {meta.bigYear}
      </span>

      <div className="relative mx-auto max-w-5xl px-4 py-7">
        {/* Dateline rule */}
        <div className="mb-4 flex items-center gap-3">
          <span className="eyebrow">{meta.edition}</span>
          <span className="h-px flex-1 bg-gradient-to-r from-border-warm to-transparent" />
          <span className="hidden font-mono text-[0.6rem] uppercase tracking-[0.16em] text-muted sm:inline">
            Matches · Stats · Form · Predictions
          </span>
        </div>

        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          {/* Title block */}
          <div
            className="reveal max-w-xl"
            style={{ "--d": "40ms" } as React.CSSProperties}
          >
            <p className="font-display text-4xl font-black leading-[0.95] tracking-tight text-ink sm:text-5xl">
              World&nbsp;Cup{" "}
              <span className="align-baseline font-mono text-3xl font-semibold not-italic text-foil sm:text-4xl">
                {meta.yearLabel}
              </span>
            </p>
            <p className="mt-1.5 font-display text-2xl font-semibold leading-tight tracking-tight text-muted sm:text-3xl">
              — {meta.hostShort}
            </p>
            {meta.hostDetail && (
              <p className="mt-2 font-mono text-[0.68rem] uppercase tracking-[0.2em] text-foil">
                {meta.hostDetail}
              </p>
            )}
            <p className="mt-2.5 max-w-md text-sm leading-relaxed text-muted">
              A read-only almanac of the FIFA World Cup — live scores, owned
              statistics, opponent-adjusted form &amp; match predictions.
            </p>
          </div>

          {/* Status block */}
          <div
            className="reveal flex shrink-0 flex-col gap-2 sm:items-end"
            style={{ "--d": "140ms" } as React.CSSProperties}
          >
            <StatusPill live={meta.live} label={meta.statusLabel} />
            <p className="max-w-xs text-xs leading-relaxed text-muted sm:text-right">
              {meta.note}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
