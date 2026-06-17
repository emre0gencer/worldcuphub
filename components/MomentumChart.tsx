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
  homeColor = "#171717",
  awayColor = "#9ca3af",
  curveType = "stepAfter",
}: {
  title: string;
  data: MomentumPoint[];
  homeName: string;
  awayName: string;
  homeColor?: string;
  awayColor?: string;
  curveType?: "stepAfter" | "monotone" | "linear";
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h3 className="text-xs uppercase tracking-wide text-muted">{title}</h3>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: homeColor }} />
            {homeName}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: awayColor }} />
            {awayName}
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
          <XAxis dataKey="minute" tick={{ fontSize: 11 }} unit="'" />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip
            labelFormatter={(m) => `Minute ${m}`}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Line type={curveType} dataKey="home" name={homeName} stroke={homeColor} strokeWidth={2.5} dot={false} />
          <Line type={curveType} dataKey="away" name={awayName} stroke={awayColor} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
