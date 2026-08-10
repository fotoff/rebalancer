"use client";

import { useState, useEffect } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// Rotating hero word — cycles with a fade + colour change.
const ROTATING_WORDS = [
  { text: "Automatically.", color: "text-emerald-500" },
  { text: "Non-custodially.", color: "text-blue-500" },
  { text: "On autopilot.", color: "text-violet-500" },
  { text: "While you sleep.", color: "text-amber-500" },
  { text: "With AI.", color: "text-sky-500" },
];

function RotatingWord() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setI((prev) => (prev + 1) % ROTATING_WORDS.length),
      2400
    );
    return () => clearInterval(t);
  }, []);
  const w = ROTATING_WORDS[i];
  return (
    <span
      key={i}
      className={`inline-block animate-in fade-in slide-in-from-bottom-3 duration-500 ${w.color}`}
    >
      {w.text}
    </span>
  );
}

const FEATURES = [
  {
    icon: "🔐",
    title: "Your Own Vault",
    desc: "Deploy a personal vault — one per user. Only you can withdraw; the service can never move your funds out. Permissions are revocable anytime.",
  },
  {
    icon: "🛡️",
    title: "Oracle-Bounded Swaps",
    desc: "Where a Chainlink or TWAP oracle exists, the contract floors every swap minus your slippage — the operator can't execute at a bad rate. Output always returns to your vault.",
  },
  {
    icon: "✅",
    title: "Per-Pair Permissions",
    desc: "You allow exactly which pairs the service may rebalance, in both directions. For tokens with no oracle, you opt in to trusting the LI.FI quote — pair by pair.",
  },
  {
    icon: "🤖",
    title: "AI-Powered Signals",
    desc: "The built-in AI Advisor scans your wallet, analyzing price divergence, regime, and expected edge to recommend when and how to rebalance.",
  },
  {
    icon: "🧪",
    title: "Backtested, Not Guessed",
    desc: "Every pair is tested on real price history: cointegration, spread z-score and half-life — plus a fee-aware backtest showing whether rebalancing actually beat holding.",
  },
  {
    icon: "🔌",
    title: "Agent-Ready (x402)",
    desc: "Autonomous agents can buy rebalancing signals per call in USDC via x402 — no signup, no API key — and trade through vaults with budgets, expiry and revocable limits.",
  },
  {
    icon: "⚖️",
    title: "Timelocked & Verified",
    desc: "Contracts are verified on BaseScan and owned by a 48-hour timelock — no instant admin changes, and admins can never touch user funds.",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Connect & Create Vault",
    desc: "Connect on Base and deploy your personal vault in one click. Your keys, your tokens — only you can withdraw.",
  },
  {
    num: "02",
    title: "Fund & Find Opportunities",
    desc: "Deposit any token. The AI auto-scans your wallet on load and surfaces pairs with rebalancing potential.",
  },
  {
    num: "03",
    title: "Allow the Pairs You Want",
    desc: "From each pair card, allow auto-rebalance in both directions — oracle-priced where possible, or opt-in trusted quote for tokens without an oracle.",
  },
  {
    num: "04",
    title: "Set & Forget",
    desc: "Price/ratio triggers fire automatically within your limits, routed via LI.FI. Withdraw any time — even if the protocol is paused.",
  },
];

const STATS = [
  { value: "100%", label: "Non-custodial" },
  { value: "AI", label: "Pair discovery" },
  { value: "24/7", label: "Auto-monitoring" },
  { value: "Base", label: "Sub-cent gas" },
];

export function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-muted/60 blur-3xl" />

        <header className="relative border-b border-border bg-background/80 backdrop-blur-sm">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
            <h1 className="text-xl font-bold tracking-tight text-foreground">Rebalancer</h1>
            <ConnectButton />
          </div>
        </header>

        <div className="relative mx-auto max-w-4xl px-4 pb-20 pt-24 text-center">
          <Badge variant="secondary" className="mb-6 gap-2 px-4 py-1.5 text-sm">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Live on Base Mainnet
          </Badge>

          <h2 className="mb-6 text-5xl font-extrabold leading-tight tracking-tight text-foreground sm:text-6xl">
            Rebalance your tokens.
            <br />
            <RotatingWord />
          </h2>

          <p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground">
            Non-custodial token rebalancing on Base — and a safe execution layer for
            trading agents. Backtested signals, on-chain price bounds, and
            revocable per-agent limits. Your keys, always.
          </p>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <ConnectButton />
            <Button variant="outline" asChild>
              <a href="#how-it-works">How it works</a>
            </Button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-border bg-muted/50">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 px-4 py-10 sm:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-2xl font-bold text-foreground">{s.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-4 py-20">
        <div className="mb-12 text-center">
          <h3 className="mb-3 text-3xl font-bold tracking-tight text-foreground">
            Everything you need for smart rebalancing
          </h3>
          <p className="text-muted-foreground">
            Professional-grade tools, zero complexity.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card
              key={f.title}
              className="transition hover:border-foreground/20 hover:shadow-md"
            >
              <CardContent className="p-6">
                <div className="mb-3 text-2xl">{f.icon}</div>
                <h4 className="mb-2 text-lg font-semibold text-foreground">
                  {f.title}
                </h4>
                <p className="text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Pair Discovery */}
      <section className="bg-muted/30 py-20">
        <div className="mx-auto max-w-4xl px-4">
          <div className="mb-12 text-center">
            <h3 className="mb-3 text-3xl font-bold tracking-tight text-foreground">
              Discover rebalancing opportunities
            </h3>
            <p className="mx-auto max-w-2xl text-muted-foreground">
              Don&apos;t know which pairs to create? The AI scans your entire
              wallet and finds the best rebalancing candidates automatically.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            {[
              { icon: "👛", title: "Wallet Scan", desc: "AI reads all tokens in your wallet and fetches real-time prices and price changes across multiple timeframes." },
              { icon: "📈", title: "Divergence Analysis", desc: "Every possible token pair is analyzed for price divergence (1h, 6h, 24h), market regime, and expected edge in basis points." },
              { icon: "✅", title: "Ranked Suggestions", desc: "Pairs are scored and ranked. Actionable opportunities (Set Triggers, Rebalance Now) are highlighted — add a pair with one click." },
            ].map((item) => (
              <Card key={item.title} className="text-center">
                <CardContent className="p-6">
                  <div className="mb-3 text-2xl">{item.icon}</div>
                  <h4 className="mb-2 text-lg font-semibold text-foreground">
                    {item.title}
                  </h4>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Mock card */}
          <div className="mt-10 flex justify-center">
            <Card className="w-full max-w-sm">
              <CardContent className="px-5 py-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium text-foreground">ETH / USDC</span>
                  <Badge variant="secondary" className="text-[10px]">Set triggers</Badge>
                </div>
                <div className="mb-2 flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">Mean Reversion</span>
                  <span className="text-muted-foreground">
                    Edge:{" "}
                    <span className="text-emerald-600">+156 bps</span>
                  </span>
                </div>
                <div className="mb-2 flex gap-4 text-xs">
                  <span>
                    <span className="text-muted-foreground">1h: </span>
                    <span className="text-emerald-600">+0.4%</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">6h: </span>
                    <span className="text-red-600">-1.2%</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">24h: </span>
                    <span className="text-emerald-600">+5.2%</span>
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  ETH/USDC: Moderate divergence (5.2%), ETH leads
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* AI Advisor spotlight */}
      <section className="mx-auto max-w-4xl px-4 py-20">
        <Card className="bg-muted/40">
          <CardContent className="p-8 sm:p-12">
            <div className="mb-6 flex items-center gap-3">
              <span className="text-2xl">🤖</span>
              <h3 className="text-3xl font-bold tracking-tight text-foreground">
                AI Advisor built in
              </h3>
            </div>
            <p className="mb-6 max-w-2xl text-muted-foreground">
              The AI engine analyzes real-time price data from DexScreener,
              historical trends from CoinGecko, and momentum signals — then
              delivers actionable recommendations with full transparency.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { title: "Price Divergence", desc: "Detects when one token outperforms the other and calculates optimal rebalance timing." },
                { title: "Risk Guardrails", desc: "Every recommendation passes slippage, gas, liquidity, and edge checks before reaching you." },
                { title: "Clear Explanations", desc: "Each signal comes with a plain-language rationale, so you always know why a move is suggested." },
              ].map((item) => (
                <div key={item.title} className="rounded-lg bg-background p-4 shadow-sm">
                  <div className="mb-1 text-sm font-medium text-foreground">
                    {item.title}
                  </div>
                  <div className="text-xs text-muted-foreground">{item.desc}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* For agents (x402) */}
      <section className="mx-auto max-w-4xl px-4 py-20">
        <Card className="bg-muted/40">
          <CardContent className="p-8 sm:p-12">
            <div className="mb-6 flex items-center gap-3">
              <span className="text-2xl">🔌</span>
              <h3 className="text-3xl font-bold tracking-tight text-foreground">
                Built for autonomous agents
              </h3>
            </div>
            <p className="mb-6 max-w-2xl text-muted-foreground">
              Agents need two things people already have: a way to pay for data,
              and a way to trade without being handed someone&apos;s funds.
              Rebalancer provides both on Base.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  title: "Pay-per-call signals",
                  desc: "POST /api/x402/signal returns HTTP 402, the agent pays $0.01 USDC via x402, and gets a rebalancing decision back. No account, no key.",
                },
                {
                  title: "Discoverable",
                  desc: "A public manifest describes every paid endpoint, its price and its schema, so an agent can decide on its own whether to call it.",
                },
                {
                  title: "Safe execution",
                  desc: "Grant an agent a budgeted, expiring right to trade specific pairs. It can never withdraw, never exceed your cap, and you revoke it any time.",
                },
              ].map((item) => (
                <div key={item.title} className="rounded-lg bg-background p-4 shadow-sm">
                  <div className="mb-1 text-sm font-medium text-foreground">
                    {item.title}
                  </div>
                  <div className="text-xs text-muted-foreground">{item.desc}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="outline" size="sm" asChild>
                <a href="/api/x402/manifest">View agent manifest</a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href="/stats">Live protocol stats</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-muted/30 py-20">
        <div className="mx-auto max-w-4xl px-4">
          <div className="mb-12 text-center">
            <h3 className="mb-3 text-3xl font-bold tracking-tight text-foreground">
              How it works
            </h3>
            <p className="text-muted-foreground">
              From connect to auto-rebalancing in 4 simple steps.
            </p>
          </div>
          <div className="grid gap-8 sm:grid-cols-2">
            {STEPS.map((s) => (
              <div key={s.num} className="flex gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
                  {s.num}
                </div>
                <div>
                  <h4 className="mb-1 text-lg font-semibold text-foreground">
                    {s.title}
                  </h4>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {s.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-muted/50 py-20">
        <div className="mx-auto max-w-2xl px-4 text-center">
          <h3 className="mb-4 text-3xl font-bold tracking-tight text-foreground">
            Start rebalancing smarter
          </h3>
          <p className="mb-8 text-muted-foreground">
            Connect your wallet and let AI manage your token pairs on Base.
            Non-custodial. Transparent. Automatic.
          </p>
          <div className="flex justify-center">
            <ConnectButton />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-4xl px-4">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>&copy; Rebalancer 2026</span>
              <span className="hidden sm:inline">&middot;</span>
              <span>v2.0 closed beta</span>
              <span className="hidden sm:inline">&middot;</span>
              <span>
                Powered by{" "}
                <a
                  href="https://li.fi"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/60 hover:text-foreground hover:underline"
                >
                  LI.FI
                </a>
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <a
                href="https://github.com/fotoff/rebalancer"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground"
              >
                GitHub
              </a>
              <span>&middot;</span>
              <a href="/stats" className="hover:text-foreground">
                Stats
              </a>
              <span>&middot;</span>
              <a
                href={`https://basescan.org/address/${process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? ""}#code`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground"
              >
                Factory on BaseScan
              </a>
              <span>&middot;</span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Base Mainnet
              </span>
            </div>
          </div>
          <p className="mt-3 text-center text-[10px] text-muted-foreground/70">
            Rebalancer is not financial advice. Use at your own risk. Smart
            contracts are covered by automated tests; an independent audit is pending.
          </p>
        </div>
      </footer>
    </div>
  );
}
