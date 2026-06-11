/** Two-sided horizontal stat comparison (FotMob-style). */
export default function StatBar({
  label,
  home,
  away,
  format = (v: number) => `${v}`,
}: {
  label: string;
  home: number | null;
  away: number | null;
  format?: (v: number) => string;
}) {
  const h = home ?? 0;
  const a = away ?? 0;
  const total = h + a;
  const homeShare = total > 0 ? (h / total) * 100 : 50;
  return (
    <div className="py-2">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="tabular-nums font-semibold">{home == null ? "–" : format(h)}</span>
        <span className="text-xs uppercase tracking-wide text-neutral-500">{label}</span>
        <span className="tabular-nums font-semibold">{away == null ? "–" : format(a)}</span>
      </div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        <div className="bg-neutral-900 dark:bg-neutral-100" style={{ width: `${homeShare}%` }} />
        <div className="bg-neutral-300 dark:bg-neutral-700" style={{ width: `${100 - homeShare}%` }} />
      </div>
    </div>
  );
}
