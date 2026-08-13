"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { Header } from "@/components/header";
import { Landing } from "@/components/landing";
import { PortfolioList } from "@/components/portfolio/portfolio-list";
import { NonCustodialVault } from "@/components/vault/noncustodial-vault";
import { AgentVaultLink } from "@/components/agent/agent-vault-link";
import { PairSuggestions } from "@/components/pairs/pair-suggestions";
import { PairCreator } from "@/components/pairs/pair-creator";
import { SavedPairs } from "@/components/pairs/saved-pairs";
import { VaultBalancesProvider } from "@/hooks/use-vault-balances";
import { Skeleton } from "@/components/ui/skeleton";
import { SocialLinks } from "@/components/social-links";

const PairDashboard = dynamic(
  () =>
    import("@/components/rebalance/pair-dashboard").then(
      (m) => m.PairDashboard
    ),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <Skeleton className="mx-auto h-4 w-24" />
      </div>
    ),
  }
);

export default function Home() {
  const { isConnected, address } = useAccount();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [pair, setPair] = useState<{ token1: string; token2: string } | null>(
    null
  );
  const [suggestForPair, setSuggestForPair] = useState<string | null>(null);

  const handleBack = useCallback(() => setPair(null), []);
  const handleSelectPair = useCallback(
    (t1: string, t2: string) => setPair({ token1: t1, token2: t2 }),
    []
  );
  const handleAddToPair = useCallback(
    (t: string) => setSuggestForPair(t),
    []
  );
  const handleSuggestConsumed = useCallback(
    () => setSuggestForPair(null),
    []
  );

  const handlePairCreated = useCallback(
    async (token1: string, token2: string) => {
      if (address) {
        await fetch("/api/pairs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userAddress: address, token1, token2 }),
        });
        queryClient.invalidateQueries({ queryKey: ["pairs", address] });
      }
      setPair({ token1, token2 });
    },
    [address, queryClient]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <Landing />;
  }

  if (!isConnected) {
    return <Landing />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-8">
        {pair ? (
          <VaultBalancesProvider>
            <PairDashboard
              token1={pair.token1}
              token2={pair.token2}
              onBack={handleBack}
            />
          </VaultBalancesProvider>
        ) : (
          <VaultBalancesProvider>
            <div className="space-y-8">
              <NonCustodialVault />
              <AgentVaultLink />
              <PortfolioList onAddToPair={handleAddToPair} />
              <PairSuggestions onCreatePair={handlePairCreated} />
              <SavedPairs onSelectPair={handleSelectPair} />
              <PairCreator
                suggestedToken={suggestForPair}
                onSuggestConsumed={handleSuggestConsumed}
                onPairCreated={handlePairCreated}
              />
            </div>
          </VaultBalancesProvider>
        )}
      </main>

      {/* Footer */}
      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-12">
        <div className="border-t border-border pt-6">
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
              <a href="/agent-vault" className="hover:text-foreground">
                Agents
              </a>
              <span>&middot;</span>
              <SocialLinks />
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
            Rebalancer is not financial advice. Use at your own risk.
            Smart contracts are covered by automated tests; an independent audit
            is pending.
          </p>
        </div>
      </footer>
    </div>
  );
}
