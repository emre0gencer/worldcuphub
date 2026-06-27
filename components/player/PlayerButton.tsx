"use client";

import type { PlayerStatKey } from "@/lib/types";
import { usePlayerModal } from "./PlayerModalProvider";

/**
 * Wraps any player area (name, photo, marker, table row) so clicking it opens
 * the PlayerWindow. Renders nothing interactive when `playerId` is missing —
 * callers can pass it unconditionally and let it degrade to a plain span.
 */
export default function PlayerButton({
  playerId,
  season,
  highlight,
  name,
  className = "",
  children,
}: {
  playerId: number | null | undefined;
  season: number;
  highlight?: PlayerStatKey;
  name?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { open } = usePlayerModal();

  if (playerId == null) {
    return <span className={className}>{children}</span>;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open({ playerId, season, highlight, name });
      }}
      title={name ? `View ${name}` : "View player"}
      className={`cursor-pointer rounded-sm text-left outline-none transition-colors hover:text-foil focus-visible:ring-2 focus-visible:ring-foil/60 ${className}`}
    >
      {children}
    </button>
  );
}
