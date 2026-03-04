"use client";

import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";

type PriceChartProps = {
  token1: string;
  token2: string;
  symbol1: string;
  symbol2: string;
};

export function PriceChart({
  token1,
  token2,
  symbol1,
  symbol2,
}: PriceChartProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["chart", token1, token2],
    queryFn: async () => {
      const res = await fetch(
        `/api/chart?addresses=${encodeURIComponent(token1)},${encodeURIComponent(token2)}&days=30`
      );
      if (!res.ok) return null;
      return res.json() as Promise<{
        data: Array<Record<string, number | string>>;
        labels: string[];
      }>;
    },
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/30 p-4">
        <p className="mb-4 text-sm text-white/60">Loading chart…</p>
        <div className="h-64 flex items-center justify-center text-white/40">Loading</div>
      </div>
    );
  }
  if (!data?.data?.length) return null;

  const addr1 = token1.toLowerCase();
  const addr2 = token2.toLowerCase();

  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-4">
      <p className="mb-4 text-sm text-white/60">
        Price dynamics (% from period start)
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data.data}
            margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis
              dataKey="date"
              tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 10 }}
              tickFormatter={(v) => new Date(v).toLocaleDateString("ru", { day: "2-digit", month: "short" })}
            />
            <YAxis
              tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 10 }}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(0,0,0,0.9)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "8px",
              }}
              labelStyle={{ color: "#fff" }}
              formatter={(value: number | undefined) => [value != null ? `${value.toFixed(2)}%` : "—", undefined]}
              labelFormatter={(label) =>
                new Date(label).toLocaleDateString("ru", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              }
            />
            <Legend />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" />
            {data.data[0]?.[addr1] !== undefined && (
              <Line
                type="monotone"
                dataKey={addr1}
                name={symbol1}
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            )}
            {data.data[0]?.[addr2] !== undefined && (
              <Line
                type="monotone"
                dataKey={addr2}
                name={symbol2}
                stroke="#d48beb"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
