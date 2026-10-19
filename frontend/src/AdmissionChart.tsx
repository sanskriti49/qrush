import {
  Area,
  ComposedChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Sample } from "./workspaceEngine";

export default function AdmissionChart({ history }: { history: Sample[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={history}
        margin={{ top: 12, right: 4, left: -12, bottom: 0 }}
      >
        <defs>
          <linearGradient id="admission-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2549e8" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#2549e8" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 5"
          vertical={false}
          stroke="#d9ddd4"
        />
        <XAxis
          dataKey="second"
          tickFormatter={(v) => `${v}s`}
          minTickGap={30}
          tick={{ fontSize: 13, fill: "#515c55" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="admission"
          domain={[0, (maximum: number) => Math.max(5, maximum)]}
          tick={{ fontSize: 13, fill: "#515c55" }}
          axisLine={false}
          tickLine={false}
          width={42}
        />
        <YAxis
          yAxisId="latency"
          orientation="right"
          tickFormatter={(v) => `${Number((v / 1000).toFixed(3))}s`}
          tick={{ fontSize: 12, fill: "#825017" }}
          axisLine={false}
          tickLine={false}
          width={68}
        />
        <Tooltip
          contentStyle={{
            border: "1px solid #899386",
            borderRadius: 4,
            fontSize: 14,
          }}
          labelFormatter={(v) => `At ${v} seconds`}
          formatter={(value, _name, item) => item.dataKey === "latency" ? [`${Number((Number(value) / 1000).toFixed(3))} seconds`, "Time to confirm"] : [value, "People entering / second"]}
        />
        <Area
          yAxisId="admission"
          type="stepAfter"
          dataKey="admission"
          name="People entering / second"
          stroke="#2549e8"
          strokeWidth={2.5}
          fill="url(#admission-area)"
          isAnimationActive={false}
        />
        <Line
          yAxisId="latency"
          type="monotone"
          dataKey="latency"
          name="Time to confirm"
          stroke="#b76a1b"
          strokeWidth={2}
          dot={false}
          strokeDasharray="4 3"
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
