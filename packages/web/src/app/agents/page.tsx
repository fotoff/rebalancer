import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "For agents — Rebalancer",
  description:
    "How autonomous agents buy rebalancing signals over x402 and trade through user-owned AgentVaults on Base, without ever taking custody.",
};

const AGENT_FACTORY =
  process.env.NEXT_PUBLIC_AGENT_FACTORY_ADDRESS ??
  "0xcE7328D01cD32114CF0da856588b891b06d3D2b9";
const CONFIG_FACTORY =
  process.env.NEXT_PUBLIC_FACTORY_ADDRESS ??
  "0x24bbf692267b84801D0052812eEDC2885Fc6E171";

function Code({ children }: { children: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-muted/50">
      <pre className="p-4 text-xs leading-relaxed text-foreground">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Section({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border pt-10">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {n}
      </div>
      <h2 className="mb-4 text-2xl font-bold tracking-tight text-foreground">
        {title}
      </h2>
      <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export default function AgentsPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-16">
        <Link
          href="/"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          &larr; Rebalancer
        </Link>

        <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground">
          For agents
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          Two things an autonomous agent needs that a human already has: a way to
          pay for data, and a way to trade without being handed someone&apos;s
          funds. Both are live on Base.
        </p>

        <div className="mt-10 space-y-12">
          <Section n="01" title="Buy a signal — x402, no signup">
            <p>
              Call the endpoint. You get{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">402</code>{" "}
              with payment requirements, pay $0.01 USDC on Base, retry, and get a
              decision. No account, no API key. Payment settles only on a
              successful response — a failed signal is not charged.
            </p>
            <Code>{`curl -i -X POST https://tokenrebalancer.com/api/x402/signal \\
  -H 'content-type: application/json' \\
  -d '{"tokenA":"0x4200000000000000000000000000000000000006",
       "tokenB":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"}'
# -> HTTP/1.1 402 Payment Required`}</Code>
            <p>
              Response shape:{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                action
              </code>{" "}
              (HOLD | REBALANCE_NOW | SUGGEST_TRIGGERS),{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                regime
              </code>{" "}
              (MEAN_REVERSION | TREND | NEUTRAL),{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                expected_edge_bps
              </code>
              ,{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                cost_bps
              </code>
              ,{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                rationale
              </code>
              ,{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                suggested_triggers
              </code>
              . Signals come from cointegration, spread z-score and OU half-life
              on real OHLCV, plus a fee-aware backtest against simply holding —
              the endpoint will tell you to do nothing when that is the right
              answer.
            </p>
            <p>
              Machine-readable discovery (free):{" "}
              <a
                href="/api/x402/manifest"
                className="text-foreground underline underline-offset-4"
              >
                /api/x402/manifest
              </a>
            </p>
          </Section>

          <Section n="02" title="Trade for a user — without custody">
            <p>
              A user deploys an <strong>AgentVault</strong> and grants you a
              narrow, revocable right to trade. You never hold their funds and
              have no path to withdraw them.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-1 text-xs font-medium text-foreground">
                  AgentVaultFactory
                </div>
                <a
                  href={`https://basescan.org/address/${AGENT_FACTORY}#code`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-mono text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {AGENT_FACTORY}
                </a>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-1 text-xs font-medium text-foreground">
                  Config factory (routers, oracles)
                </div>
                <a
                  href={`https://basescan.org/address/${CONFIG_FACTORY}#code`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-mono text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {CONFIG_FACTORY}
                </a>
              </div>
            </div>
            <p className="pt-2">What the user grants you, per pair direction:</p>
            <Code>{`// the USER calls these on their own vault — you cannot
setAgentPermission(
  agent, from, to, enabled,
  maxSlippageBps,   // your ceiling; the oracle floor still wins
  cooldown,         // seconds between your trades
  expiresAt,        // unix seconds, 0 = never (a session key that dies)
  maxNotional,      // largest amountIn per trade, 0 = unlimited
  trustAgentMinOut  // only for pairs with no oracle
)
setAgentBudget(agent, token, dailyLimit)  // rolling 24h spend cap`}</Code>
            <p>Then you trade:</p>
            <Code>{`agentTrade(from, to, amountIn, router, swapData, agentMinOut)
  returns (uint256 received)

// check first — free, and tells you why if not:
canTrade(agent, from, to, amountIn)
  returns (bool allowed, string reason)
  // "not permitted" | "expired" | "cooldown" | "protocol paused"
  // | "insufficient balance" | "notional too large" | "budget exceeded"`}</Code>
          </Section>

          <Section n="03" title="What you cannot do (by construction)">
            <ul className="list-inside list-disc space-y-2">
              <li>
                <strong className="text-foreground">Withdraw.</strong> Only the
                vault owner can. There is no code path that moves funds to an
                agent.
              </li>
              <li>
                <strong className="text-foreground">
                  Route output anywhere else.
                </strong>{" "}
                The swap&apos;s output is measured as a balance delta on the
                vault itself, so sending it elsewhere reverts.
              </li>
              <li>
                <strong className="text-foreground">
                  Quote yourself a bad price.
                </strong>{" "}
                When an oracle exists (Chainlink, else a Uniswap-V3 TWAP), the
                minimum output comes from the oracle — your{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  agentMinOut
                </code>{" "}
                can only raise it, never lower it. A stale oracle hard-reverts.
              </li>
              <li>
                <strong className="text-foreground">Outlive your grant.</strong>{" "}
                Expiry, cooldown, per-trade notional and a rolling 24h budget are
                all enforced on-chain, and the user can revoke at any moment.
              </li>
            </ul>
          </Section>

          <Section n="04" title="ABI & source">
            <p>
              Both contracts are verified on BaseScan — read the source and copy
              the ABI directly from the explorer, or from the{" "}
              <a
                href="https://github.com/fotoff/rebalancer/tree/main/packages/contracts/contracts/agent"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4"
              >
                repository
              </a>
              .
            </p>
            <p className="text-xs">
              Contracts are covered by automated tests but are{" "}
              <strong className="text-foreground">not yet audited</strong>. Treat
              them accordingly and start with small budgets.
            </p>
          </Section>
        </div>

        <footer className="mt-16 border-t border-border pt-6 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <Link href="/" className="hover:text-foreground">
              Home
            </Link>
            <span>&middot;</span>
            <Link href="/stats" className="hover:text-foreground">
              Live stats
            </Link>
            <span>&middot;</span>
            <a
              href="/api/x402/manifest"
              className="hover:text-foreground"
            >
              Manifest
            </a>
            <span>&middot;</span>
            <a
              href="https://github.com/fotoff/rebalancer"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground"
            >
              GitHub
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
