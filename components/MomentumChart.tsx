"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface MomentumPoint {
  minute: number;
  home: number;
  away: number;
}

/** Cumulative stat time-series from Track 1 snapshots (e.g. shots, xG). */
export default function MomentumChart({
  title,
  data,
  homeName,
  awayName,
}: {
  title: string;
  data: MomentumPoint[];
  homeName: string;
  awayName: string;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs uppercase tracking-wide text-neutral-500">{title}</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
          <XAxis dataKey="minute" tick={{ fontSize: 11 }} unit="'" />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip
            labelFormatter={(m) => `Minute ${m}`}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Line type="stepAfter" dataKey="home" name={homeName} stroke="#171717" strokeWidth={2} dot={false} />
          <Line type="stepAfter" dataKey="away" name={awayName} stroke="#9ca3af" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
