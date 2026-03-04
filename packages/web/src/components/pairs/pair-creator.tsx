"use client";

import { useState, useEffect } from "react";
import { TokenSelector } from "./token-selector";

type PairCreatorProps = {
  suggestedToken?: string | null;
  onSuggestConsumed?: () => void;
  onPairCreated: (token1: string, token2: string) => void;
};

export function PairCreator({
  suggestedToken,
  onSuggestConsumed,
  onPairCreated,
}: PairCreatorProps) {
  const [token1, setToken1] = useState<string | null>(null);
  const [token2, setToken2] = useState<string | null>(null);

  useEffect(() => {
    if (suggestedToken && onSuggestConsumed) {
      if (!token1) {
        setToken1(suggestedToken);
      } else if (!token2 && token1.toLowerCase() !== suggestedToken.toLowerCase()) {
        setToken2(suggestedToken);
      }
      onSuggestConsumed();
    }
  }, [suggestedToken, onSuggestConsumed, token1, token2]);

  const handleCreate = () => {
    if (token1 && token2 && token1 !== token2) {
      onPairCreated(token1, token2);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h2 className="mb-4 text-lg font-semibold text-white">
        Create pair for tracking
      </h2>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-2 block text-sm text-white/60">
            Token 1 (sell)
          </label>
          <TokenSelector
            value={token1}
            onChange={setToken1}
            excludeAddress={token2 ?? undefined}
          />
        </div>
        <div className="flex items-center justify-center text-2xl text-white/40">
          ⟷
        </div>
        <div className="flex-1">
          <label className="mb-2 block text-sm text-white/60">
            Token 2 (buy)
          </label>
          <TokenSelector
            value={token2}
            onChange={setToken2}
            excludeAddress={token1 ?? undefined}
          />
        </div>
      </div>
      <button
        onClick={handleCreate}
        disabled={!token1 || !token2 || token1 === token2}
        className="mt-4 rounded-lg bg-[#0052FF] px-6 py-2 font-medium text-white transition hover:bg-[#0046e0] disabled:opacity-50 disabled:hover:bg-[#0052FF]"
      >
        Create pair
      </button>
    </div>
  );
}
