import type { MatchEvent } from "@/lib/types";

/**
 * Crisp inline-SVG glyphs for match events — deliberately no emoji and no ASCII
 * abbreviations ("OG", "pen", "VAR"). Each icon scales to the surrounding text
 * via `em` sizing and carries an aria-label so the meaning survives for screen
 * readers. Visual distinctions (own goal, penalty, miss) are encoded by colour
 * and form, the way a modern sports site renders them.
 */
export function MatchEventIcon({ event, className = "" }: { event: MatchEvent; className?: string }) {
  const base = `inline-block shrink-0 align-[-0.15em] ${className}`;
  const size = "1.05em";

  if (event.type === "Goal") {
    const own = event.detail === "Own Goal";
    const penalty = event.detail === "Penalty";
    const missed = event.detail === "Missed Penalty";
    const fill = own ? "var(--color-flare)" : missed ? "none" : "var(--color-ink)";
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        className={base}
        role="img"
        aria-label={own ? "Own goal" : missed ? "Penalty missed" : penalty ? "Penalty goal" : "Goal"}
      >
        <circle
          cx="8"
          cy="8"
          r="6.4"
          fill={fill}
          stroke={missed ? "var(--color-muted)" : "none"}
          strokeWidth="1.4"
        />
        {!missed && <path d="M8 4.1l2.55 1.85-0.97 3H6.42l-0.97-3z" fill="#fff" />}
        {/* penalty spot inside the ball */}
        {penalty && !missed && <circle cx="8" cy="8" r="1.05" fill="var(--color-ink)" />}
        {missed && <line x1="3.7" y1="12.3" x2="12.3" y2="3.7" stroke="var(--color-flare)" strokeWidth="1.6" />}
      </svg>
    );
  }

  if (event.type === "Card") {
    const red = event.detail === "Red Card";
    const second = event.detail === "Second Yellow card";
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className={base} role="img" aria-label={red ? "Red card" : second ? "Second yellow — sent off" : "Yellow card"}>
        {second ? (
          <>
            <rect x="2.5" y="3" width="6.5" height="9.5" rx="1.4" transform="rotate(-9 5.75 7.75)" fill="#e9b80a" />
            <rect x="6.5" y="3.5" width="6.5" height="9.5" rx="1.4" transform="rotate(9 9.75 8.25)" fill="var(--color-flare)" />
          </>
        ) : (
          <rect x="4" y="2.6" width="8" height="11" rx="1.6" transform="rotate(8 8 8)" fill={red ? "var(--color-flare)" : "#e9b80a"} />
        )}
      </svg>
    );
  }

  if (event.type === "subst") {
    // Twin arrows: green up (on) over red down (off) — the universal swap glyph.
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className={base} role="img" aria-label="Substitution">
        <path d="M5 9.5V3.2m0 0L2.8 5.6M5 3.2l2.2 2.4" fill="none" stroke="#16a34a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11 6.5v6.3m0 0l2.2-2.4M11 12.8l-2.2-2.4" fill="none" stroke="var(--color-flare)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (event.type === "Var") {
    // Referee's "TV rectangle" hand signal — the recognised VAR symbol.
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className={base} role="img" aria-label="VAR review">
        <rect x="2" y="3.5" width="12" height="9" rx="1.6" fill="none" stroke="var(--color-ink)" strokeWidth="1.5" />
        <rect x="4.4" y="5.7" width="7.2" height="4.6" rx="0.8" fill="var(--color-ink)" />
      </svg>
    );
  }

  return null;
}

/** Small green ▲ (on) / red ▼ (off) markers for the substitution row. */
export function SubArrow({ direction }: { direction: "in" | "out" }) {
  const inbound = direction === "in";
  return (
    <svg
      width="0.7em"
      height="0.7em"
      viewBox="0 0 10 10"
      className="inline-block shrink-0 align-[0.02em]"
      role="img"
      aria-label={inbound ? "On" : "Off"}
    >
      {inbound ? (
        <path d="M5 1.5l3.5 6h-7z" fill="#16a34a" />
      ) : (
        <path d="M5 8.5l-3.5-6h7z" fill="var(--color-flare)" />
      )}
    </svg>
  );
}
