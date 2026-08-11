"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Header } from "@/components/header";
import { Skeleton } from "@/components/ui/skeleton";

// Wallet-dependent: render client-side only, like the pair dashboard.
const AgentVaultManager = dynamic(
  () =>
    import("@/components/agent/agent-vault-manager").then(
      (m) => m.AgentVaultManager
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

export default function AgentVaultPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Link
          href="/"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          &larr; Dashboard
        </Link>

        <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground">
          Agents
        </h1>
        <p className="mt-2 mb-8 text-sm leading-relaxed text-muted-foreground">
          Let an autonomous agent trade for you without handing over custody.
          You keep the keys; the agent gets a budgeted, expiring permission you
          can revoke at any time. Read the{" "}
          <Link
            href="/agents"
            className="text-foreground underline underline-offset-4"
          >
            agent docs
          </Link>{" "}
          for the contract-level details.
        </p>

        <AgentVaultManager />
      </main>
    </div>
  );
}
