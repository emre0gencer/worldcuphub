"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { PlayerStatKey } from "@/lib/types";
import PlayerWindow from "./PlayerWindow";

/** A request to open the PlayerWindow for one player. */
export interface PlayerModalRequest {
  playerId: number;
  season: number;
  /** Which stat to feature as the headline — set by the click context. */
  highlight?: PlayerStatKey;
  /** Fallback display name shown until the profile loads. */
  name?: string;
}

interface PlayerModalContextValue {
  open: (req: PlayerModalRequest) => void;
  close: () => void;
}

const PlayerModalContext = createContext<PlayerModalContextValue | null>(null);

/**
 * App-wide host for the PlayerWindow modal. Mounted once in the root layout so
 * any clickable player area — squad lists, lineups, ratings, leaderboards,
 * timeline names — can open the same modal via {@link usePlayerModal}. No URL
 * change: the season travels with the request, never through a query param.
 */
export default function PlayerModalProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<PlayerModalRequest | null>(null);

  const open = useCallback((req: PlayerModalRequest) => setRequest(req), []);
  const close = useCallback(() => setRequest(null), []);

  const value = useMemo<PlayerModalContextValue>(() => ({ open, close }), [open, close]);

  return (
    <PlayerModalContext.Provider value={value}>
      {children}
      {request && (
        // Remount per request so each open starts cleanly in its loading state.
        <PlayerWindow
          key={`${request.playerId}-${request.season}`}
          request={request}
          onClose={close}
        />
      )}
    </PlayerModalContext.Provider>
  );
}

export function usePlayerModal(): PlayerModalContextValue {
  const ctx = useContext(PlayerModalContext);
  if (!ctx) {
    throw new Error("usePlayerModal must be used within a <PlayerModalProvider>");
  }
  return ctx;
}
