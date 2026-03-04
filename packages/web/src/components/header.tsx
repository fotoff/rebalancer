"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

export function Header() {
  return (
    <header className="border-b border-white/10 bg-black/50 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <h1 className="text-xl font-bold text-white">Rebalancer</h1>
        <ConnectButton />
      </div>
    </header>
  );
}
