"use client";

import Link from "next/link";
import { useAgentVault } from "@/hooks/use-agent-vault";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Entry point to the agent layer from the dashboard. The agent vault is a
 * separate contract from the UserVault card above it, and without this the only
 * way to reach an already-deployed one was a footer link.
 */
export function AgentVaultLink() {
  const { factoryConfigured, vaultAddress, hasVault, isLoading } =
    useAgentVault();

  if (!factoryConfigured || isLoading) return null;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-foreground">
              Agent vault
            </span>
            {hasVault && (
              <Badge variant="success" className="text-[10px]">
                deployed
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasVault ? (
              <>
                Separate from the vault above — this one is for autonomous
                agents.{" "}
                <span className="font-mono text-xs">
                  {short(vaultAddress!)}
                </span>
              </>
            ) : (
              "Let an autonomous agent trade for you, inside budgets and an expiry you set."
            )}
          </p>
        </div>
        <Button asChild variant={hasVault ? "outline" : "default"} size="sm">
          <Link href="/agent-vault">
            {hasVault ? "Manage agents" : "Set up"}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
