"use client";

import { widgetsEnabled } from "./widgets-enabled";

/**
 * Generic client wrapper for one <api-sports-widget> instance.
 * Pass widget parameters as data-* attributes, e.g.:
 *   <ApiSportsWidget data-type="game" data-game-id="1234" />
 * Renders nothing when NEXT_PUBLIC_API_FOOTBALL_WIDGET_KEY is unset, so
 * pages can fall back to the custom Supabase-backed views.
 */
export default function ApiSportsWidget(
  props: Record<`data-${string}`, string> & { className?: string },
) {
  if (!widgetsEnabled) return null;
  return <api-sports-widget {...props} />;
}
