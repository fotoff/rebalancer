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
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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
      <Card>
        <CardContent className="p-4">
          <p className="mb-4 text-sm text-muted-foreground">Loading chart...</p>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (!data?.data?.length) return null;

  const addr1 = token1.toLowerCase();
  const addr2 = token2.toLowerCase();

  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-4 text-sm text-muted-foreground">
          Price dynamics (% from period start)
        </p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data.data}
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fill: "#64748b", fontSize: 10 }}
                tickFormatter={(v) => new Date(v).toLocaleDateString("ru", { day: "2-digit", month: "short" })}
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 10 }}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "white",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
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
              <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" />
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
      </CardContent>
    </Card>
  );
}
