"use client";

import Script from "next/script";
import { DEFAULT_SEASON } from "@/lib/season";
import { widgetsEnabled } from "./widgets-enabled";

/**
 * Loads the API-Sports widgets script once and renders the single required
 * global config element. All <api-sports-widget> instances on any page
 * inherit these settings.
 *
 * The widget key is intentionally separate from the server-side pipeline key
 * (API_FOOTBALL_KEY): it is exposed client-side by design, so it must be
 * domain-restricted in the API-Sports dashboard. data-refresh is kept
 * conservative (60s, the same cadence as the ingestion worker) to protect
 * the request quota.
 */
export default function ApiSportsConfig() {
  if (!widgetsEnabled) return null;

  return (
    <>
      <Script
        src="https://widgets.api-sports.io/3.1.0/widgets.js"
        type="module"
        strategy="afterInteractive"
      />
      <api-sports-widget
        data-type="config"
        data-key={process.env.NEXT_PUBLIC_API_FOOTBALL_WIDGET_KEY}
        data-sport="football"
        data-lang="en"
        data-theme="white"
        data-show-logos="true"
        data-show-errors="false"
        data-refresh="60"
        data-league="1"
        data-season={String(DEFAULT_SEASON)}
        data-game-tab="statistics"
        data-team-statistics="true"
        data-team-squad="true"
        data-player-statistics="true"
        data-player-trophies="true"
        data-target-team="modal"
        data-target-player="modal"
        data-target-game="modal"
      />
    </>
  );
}
