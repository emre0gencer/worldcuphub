/**
 * Editorial section heading — a small mono eyebrow (index / kicker) above a
 * Fraunces display title, with an optional standfirst. Shared across pages so
 * every section reads from the same typographic system.
 */
export default function SectionHeading({
  eyebrow,
  title,
  standfirst,
  as = "h1",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  standfirst?: React.ReactNode;
  as?: "h1" | "h2";
}) {
  const Title = as;
  return (
    <div>
      {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
      <Title className="font-display text-3xl font-black leading-[1.05] tracking-tight text-ink">
        {title}
      </Title>
      {standfirst && (
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">{standfirst}</p>
      )}
    </div>
  );
}

/** Compact eyebrow used to label sub-sections within a page. */
export function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-3 font-display text-lg font-bold tracking-tight text-ink">
      {children}
    </h2>
  );
}
