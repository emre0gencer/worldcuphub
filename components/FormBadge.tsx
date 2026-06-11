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
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : value <= 40
        ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
        : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums ${tone}`}>
      {value.toFixed(1)}
      {sampleSize !== undefined && sampleSize < 3 && (
        <span title={`Based on only ${sampleSize} match${sampleSize === 1 ? "" : "es"} — noisy early-tournament estimate`} className="text-xs font-normal opacity-60">
          n={sampleSize}
        </span>
      )}
    </span>
  );
}
