import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Protocol stats — Rebalancer",
  description:
    "Live, verifiable protocol metrics for Rebalancer on Base: vaults deployed, TVL, and rebalance activity.",
};

export const revalidate = 60;

type Stats = {
  network?: string;
  factory?: string;
  vaults?: number;
  tvlUsd?: number;
  tvlByToken?: Record<string, number>;
  rebalances?: number;
  deposits?: number;
  activeUsers?: number;
  sources?: Record<string, string>;
  updatedAt?: string;
  error?: string;
};

async function getStats(): Promise<Stats> {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3001";
  try {
    const res = await fetch(`${base}/api/stats`, { next: { revalidate: 60 } });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return (await res.json()) as Stats;
  } catch (e) {
    return { error: String(e) };
  }
}

function Metric({
  value,
  label,
  source,
}: {
  value: string;
  label: string;
  source?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 text-center">
      <div className="text-3xl font-bold tracking-tight text-foreground">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      {source && (
        <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground/60">
          {source === "onchain" ? "verifiable on-chain" : "execution log"}
        </div>
      )}
    </div>
  );
}

export default async function StatsPage() {
  const s = await getStats();
  const fmtUsd = (n?: number) =>
    n == null
      ? "—"
      : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <Link href="/" className="text-xl font-bold tracking-tight text-foreground">
            Rebalancer
          </Link>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Base Mainnet
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
          Protocol stats
        </h1>
        <p className="mb-8 text-muted-foreground">
          Vaults and TVL are read directly from the factory contract on Base — anyone
          can reproduce them. Activity counts come from our execution log.
        </p>

        {s.error ? (
          <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
            Stats are temporarily unavailable.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric
                value={String(s.vaults ?? 0)}
                label="Vaults deployed"
                source={s.sources?.vaults}
              />
              <Metric
                value={fmtUsd(s.tvlUsd)}
                label="Total value in vaults"
                source={s.sources?.tvlUsd}
              />
              <Metric
                value={String(s.rebalances ?? 0)}
                label="Rebalances executed"
                source={s.sources?.rebalances}
              />
              <Metric
                value={String(s.activeUsers ?? 0)}
                label="Active users"
                source={s.sources?.activeUsers}
              />
            </div>

            <div className="mt-8 rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                Verify it yourself
              </h2>
              <dl className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Factory contract</dt>
                  <dd>
                    <a
                      href={`https://basescan.org/address/${s.factory ?? ""}#code`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all font-mono text-xs text-foreground hover:underline"
                    >
                      {s.factory ?? "—"}
                    </a>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Raw metrics (JSON)</dt>
                  <dd>
                    <a href="/api/stats" className="text-xs text-foreground hover:underline">
                      /api/stats
                    </a>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Agent API (x402)</dt>
                  <dd>
                    <a
                      href="/api/x402/manifest"
                      className="text-xs text-foreground hover:underline"
                    >
                      /api/x402/manifest
                    </a>
                  </dd>
                </div>
              </dl>
              {s.updatedAt && (
                <p className="mt-3 text-[10px] text-muted-foreground/70">
                  Updated {new Date(s.updatedAt).toUTCString()} · cached 60s
                </p>
              )}
            </div>
          </>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground hover:underline">
            ← Back to app
          </Link>
        </p>
      </main>
    </div>
  );
}
