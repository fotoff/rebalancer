"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <h1 className="text-xl font-bold text-foreground">Rebalancer</h1>
        <ConnectButton />
      </div>
    </header>
  );
}
