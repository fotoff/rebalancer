"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

const FEATURES = [
  {
    icon: "🔄",
    title: "Automatic Rebalancing",
    desc: "Set triggers and let the system rebalance your token pairs automatically when conditions are met.",
  },
  {
    icon: "🤖",
    title: "AI-Powered Signals",
    desc: "Built-in AI Advisor analyzes price divergence, volatility, and social sentiment to recommend optimal rebalancing.",
  },
  {
    icon: "🔐",
    title: "Non-Custodial Vault",
    desc: "Your tokens stay in a smart contract vault you control. No one else can access your funds.",
  },
  {
    icon: "⚡",
    title: "Base L2 Speed",
    desc: "Built on Base for fast, cheap transactions. Sub-cent gas fees mean more profit for you.",
  },
  {
    icon: "📊",
    title: "Smart Triggers",
    desc: "Set ratio-based, price-based, or trend-guarded triggers. The system monitors 24/7 and executes when ready.",
  },
  {
    icon: "🛡️",
    title: "Policy Guardrails",
    desc: "Built-in safety: max slippage, minimum edge, cooldowns, and liquidity checks protect every trade.",
  },
];

const STEPS = [
  {
    num: "01",
    title: "Connect Wallet",
    desc: "Connect your wallet to Base network. Your keys, your tokens.",
  },
  {
    num: "02",
    title: "Create a Pair",
    desc: "Pick two tokens you want to rebalance. Deposit them into the vault.",
  },
  {
    num: "03",
    title: "Get AI Recommendation",
    desc: "AI Advisor analyzes price dynamics and suggests optimal triggers or immediate rebalance.",
  },
  {
    num: "04",
    title: "Set & Forget",
    desc: "Triggers fire automatically when conditions are met. Rebalance executes via best DEX route.",
  },
];

const STATS = [
  { value: "24/7", label: "Monitoring" },
  { value: "<$0.01", label: "Avg gas per tx" },
  { value: "5+", label: "DEX routes" },
  { value: "100%", label: "Non-custodial" },
];

export function Landing() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-600/10 via-transparent to-transparent" />
        <div className="absolute left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-blue-500/5 blur-3xl" />

        <header className="relative border-b border-white/10 bg-black/50 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
            <h1 className="text-xl font-bold text-white">Rebalancer</h1>
            <ConnectButton />
          </div>
        </header>

        <div className="relative mx-auto max-w-4xl px-4 pb-20 pt-24 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-1.5 text-sm text-blue-400">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
            Live on Base Mainnet
          </div>

          <h2 className="mb-6 text-5xl font-extrabold leading-tight tracking-tight text-white sm:text-6xl">
            Rebalance your tokens.
            <br />
            <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              Automatically.
            </span>
          </h2>

          <p className="mx-auto mb-10 max-w-2xl text-lg text-white/60">
            AI-powered token rebalancer on Base. Set triggers, get smart
            recommendations, and let the system manage your pairs — while you
            stay in full control of your funds.
          </p>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <ConnectButton />
            <a
              href="#how-it-works"
              className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-medium text-white/80 transition hover:bg-white/10"
            >
              How it works
            </a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 px-4 py-10 sm:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-2xl font-bold text-white">{s.value}</div>
              <div className="mt-1 text-sm text-white/40">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-4 py-20">
        <div className="mb-12 text-center">
          <h3 className="mb-3 text-3xl font-bold text-white">
            Everything you need for smart rebalancing
          </h3>
          <p className="text-white/50">
            Professional-grade tools, zero complexity.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-white/20 hover:bg-white/[0.05]"
            >
              <div className="mb-3 text-3xl">{f.icon}</div>
              <h4 className="mb-2 text-lg font-semibold text-white">
                {f.title}
              </h4>
              <p className="text-sm leading-relaxed text-white/50">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-white/[0.02] py-20">
        <div className="mx-auto max-w-4xl px-4">
          <div className="mb-12 text-center">
            <h3 className="mb-3 text-3xl font-bold text-white">
              How it works
            </h3>
            <p className="text-white/50">
              From connect to auto-rebalancing in 4 simple steps.
            </p>
          </div>
          <div className="grid gap-8 sm:grid-cols-2">
            {STEPS.map((s) => (
              <div key={s.num} className="flex gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-lg font-bold text-blue-400">
                  {s.num}
                </div>
                <div>
                  <h4 className="mb-1 text-lg font-semibold text-white">
                    {s.title}
                  </h4>
                  <p className="text-sm leading-relaxed text-white/50">
                    {s.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI Advisor spotlight */}
      <section className="mx-auto max-w-4xl px-4 py-20">
        <div className="rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 p-8 sm:p-12">
          <div className="mb-6 flex items-center gap-3">
            <span className="text-4xl">🤖</span>
            <h3 className="text-2xl font-bold text-white">
              AI Advisor built in
            </h3>
          </div>
          <p className="mb-6 max-w-2xl text-white/60">
            Our AI engine analyzes real-time price data from DexScreener,
            historical trends from CoinGecko, and social sentiment — then
            delivers actionable recommendations with full transparency.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-white/5 p-4">
              <div className="mb-1 text-sm font-medium text-white/80">
                Price Divergence
              </div>
              <div className="text-xs text-white/40">
                Detects when one token outperforms the other and calculates
                optimal rebalance timing.
              </div>
            </div>
            <div className="rounded-lg bg-white/5 p-4">
              <div className="mb-1 text-sm font-medium text-white/80">
                Risk Guardrails
              </div>
              <div className="text-xs text-white/40">
                Every recommendation passes slippage, gas, liquidity, and
                edge checks before reaching you.
              </div>
            </div>
            <div className="rounded-lg bg-white/5 p-4">
              <div className="mb-1 text-sm font-medium text-white/80">
                Social Sentiment
              </div>
              <div className="text-xs text-white/40">
                Monitors community signals to adjust confidence and flag
                high-uncertainty conditions.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/10 bg-white/[0.02] py-20">
        <div className="mx-auto max-w-2xl px-4 text-center">
          <h3 className="mb-4 text-3xl font-bold text-white">
            Start rebalancing smarter
          </h3>
          <p className="mb-8 text-white/50">
            Connect your wallet and let AI manage your token pairs on Base.
            Non-custodial. Transparent. Automatic.
          </p>
          <ConnectButton />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8">
        <div className="mx-auto max-w-4xl px-4">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/30">
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
                  className="text-white/50 hover:text-white/80 hover:underline"
                >
                  LI.FI
                </a>
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-white/30">
              <a
                href={`https://basescan.org/address/${process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? ""}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white/50"
              >
                Vault on BaseScan
              </a>
              <span>&middot;</span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Base Mainnet
              </span>
            </div>
          </div>
          <p className="mt-3 text-center text-[10px] text-white/20">
            Rebalancer is not financial advice. Use at your own risk. Smart
            contracts have not been audited.
          </p>
        </div>
      </footer>
    </div>
  );
}
