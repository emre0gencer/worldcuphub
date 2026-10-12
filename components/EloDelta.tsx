export default function EloDelta({
  current,
  initial,
  scope = "tournament",
}: {
  current: number | null;
  initial: number | null;
  /** "match": initial→current is one match's replay step; "tournament": seed→now. */
  scope?: "match" | "tournament";
}) {
  if (current == null || initial == null) return <span>—</span>;
  const delta = Math.round(current - initial);
  const rounded = Math.round(current);
  if (delta === 0) return <span className="font-mono tabular-nums">{rounded}</span>;
  const up = delta > 0;
  const color = up
    ? "text-emerald-600"
    : "text-red-600";
  return (
    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
      <span>{rounded}</span>
      <span
        className={`text-xs ${color}`}
        title={`${up ? "+" : ""}${delta} Elo ${scope === "match" ? "from this match" : "since tournament start"}`}
      >
        {up ? "▲" : "▼"} {Math.abs(delta)}
      </span>
    </span>
  );
}
