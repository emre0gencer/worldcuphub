/** Two-sided horizontal stat comparison (FotMob-style). */
export default function StatBar({
  label,
  home,
  away,
  format = (v: number) => `${v}`,
  homeColor,
  awayColor,
}: {
  label: string;
  home: number | null;
  away: number | null;
  format?: (v: number) => string;
  homeColor?: string;
  awayColor?: string;
}) {
  const h = home ?? 0;
  const a = away ?? 0;
  const total = h + a;
  const homeShare = total > 0 ? (h / total) * 100 : 50;
  return (
    <div className="py-2">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-mono tabular-nums font-semibold">{home == null ? "–" : format(h)}</span>
        <span className="text-[0.7rem] uppercase tracking-[0.12em] text-muted">{label}</span>
        <span className="font-mono tabular-nums font-semibold">{away == null ? "–" : format(a)}</span>
      </div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        <div
          className={homeColor ? undefined : "bg-neutral-900"}
          style={{ width: `${homeShare}%`, ...(homeColor ? { backgroundColor: homeColor } : {}) }}
        />
        <div
          className={awayColor ? undefined : "bg-neutral-300"}
          style={{ width: `${100 - homeShare}%`, ...(awayColor ? { backgroundColor: awayColor } : {}) }}
        />
      </div>
    </div>
  );
}
