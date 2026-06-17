/** Form Score on the 0–100 display scale (50 = tournament average). */
export default function FormBadge({
  value,
  sampleSize,
}: {
  value: number;
  sampleSize?: number;
}) {
  const tone =
    value >= 60
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15"
      : value <= 40
        ? "bg-red-50 text-red-700 ring-red-600/15"
        : "bg-surface-warm text-ink ring-border-warm";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-sm font-semibold tabular-nums ring-1 ring-inset ${tone}`}>
      {value.toFixed(1)}
      {sampleSize !== undefined && sampleSize < 3 && (
        <span title={`Based on only ${sampleSize} match${sampleSize === 1 ? "" : "es"} — noisy early-tournament estimate`} className="text-xs font-normal opacity-60">
          n={sampleSize}
        </span>
      )}
    </span>
  );
}
