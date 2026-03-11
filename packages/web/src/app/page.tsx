"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Header } from "@/components/header";
import { Landing } from "@/components/landing";
import { PortfolioList } from "@/components/portfolio/portfolio-list";
import { PairCreator } from "@/components/pairs/pair-creator";
import { SavedPairs } from "@/components/pairs/saved-pairs";
import { VaultBalancesProvider } from "@/hooks/use-vault-balances";

const PairDashboard = dynamic(
  () =>
    import("@/components/rebalance/pair-dashboard").then(
      (m) => m.PairDashboard
    ),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border border-white/10 bg-white/5 p-12 text-center">
        <div className="text-white/50">Loading...</div>
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
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-8">
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
              <PortfolioList onAddToPair={handleAddToPair} />
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
      <footer className="mx-auto max-w-4xl px-4 pb-8 pt-12">
        <div className="border-t border-white/10 pt-6">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/30">
              <span>&copy; Rebalancer 2026</span>
              <span className="hidden sm:inline">·</span>
              <span>v2.0 closed beta</span>
              <span className="hidden sm:inline">·</span>
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
                href="https://github.com/fotoff/rebalancer"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white/50"
              >
                GitHub
              </a>
              <span>·</span>
              <a
                href={`https://basescan.org/address/${process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? ""}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white/50"
              >
                Vault on BaseScan
              </a>
              <span>·</span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Base Mainnet
              </span>
            </div>
          </div>
          <p className="mt-3 text-center text-[10px] text-white/20">
            Rebalancer is not financial advice. Use at your own risk.
            Smart contracts have not been audited.
          </p>
        </div>
      </footer>
    </div>
  );
}
