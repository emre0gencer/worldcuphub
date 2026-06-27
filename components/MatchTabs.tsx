"use client";

import { useState } from "react";

export interface MatchTab {
  key: string;
  label: string;
  content: React.ReactNode;
}

/**
 * Tab strip placed directly below the scoreboard (e.g. Timeline · Squads). Each
 * tab's content is rendered on the server and handed in as a node; only the
 * active panel is mounted.
 */
export default function MatchTabs({ tabs }: { tabs: MatchTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key);
  if (tabs.length === 0) return null;
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <section>
      <div
        role="tablist"
        aria-label="Match detail"
        className="mb-4 inline-flex gap-0.5 rounded-xl border border-border-warm bg-surface p-0.5"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={t.key === current.key}
            onClick={() => setActive(t.key)}
            className={`rounded-lg px-4 py-1.5 font-mono text-xs uppercase tracking-[0.1em] transition-colors ${
              t.key === current.key
                ? "bg-ink font-semibold text-paper"
                : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current.content}</div>
    </section>
  );
}
