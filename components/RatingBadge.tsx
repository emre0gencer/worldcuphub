/**
 * Player match-rating chip, colour-coded by band the way mainstream football
 * sites surface ratings:
 *   > 9.5  blue   · elite
 *   > 8.0  green  · excellent
 *   > 7.0  light orange · good
 *   > 6.0  orange · average
 *   > 5.0  red    · poor
 *   ≤ 5.0  deep red · very poor
 */
export function ratingBand(rating: number): { bg: string; fg: string } {
  if (rating > 9.5) return { bg: "#2563eb", fg: "#ffffff" }; // blue
  if (rating > 8.0) return { bg: "#16a34a", fg: "#ffffff" }; // green
  if (rating > 7.0) return { bg: "#fbbf24", fg: "#3a2c00" }; // light orange
  if (rating > 6.0) return { bg: "#f97316", fg: "#ffffff" }; // orange
  if (rating > 5.0) return { bg: "#ef4444", fg: "#ffffff" }; // red
  return { bg: "#b91c1c", fg: "#ffffff" }; // deep red
}

export function RatingBadge({ rating }: { rating: number | null }) {
  if (rating == null) {
    return <span className="text-xs text-muted">–</span>;
  }
  const { bg, fg } = ratingBand(rating);
  return (
    <span
      className="inline-flex min-w-[2.4rem] justify-center rounded-md px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums shadow-sm"
      style={{ backgroundColor: bg, color: fg }}
    >
      {rating.toFixed(1)}
    </span>
  );
}
