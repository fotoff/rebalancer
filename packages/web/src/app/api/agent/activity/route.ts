import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem, isAddress } from "viem";
import { base } from "viem/chains";
import { log } from "@/lib/logger";

/**
 * Recent AgentTraded events for one agent vault.
 *
 * Agents run outside this service, so their trades cannot come from our
 * execution log the way operator rebalances do — the chain is the only honest
 * source. Base's public RPC caps eth_getLogs at 10k blocks per call, so the
 * window is walked in chunks and deliberately bounded: this endpoint reports
 * *recent* activity, not all-time history. `truncated` says so explicitly
 * rather than letting a partial list read as complete.
 */

export const dynamic = "force-dynamic";

const AGENT_TRADED = parseAbiItem(
  "event AgentTraded(address indexed agent, address indexed from, address indexed to, uint256 amountIn, uint256 netOut, uint256 fee)"
);

const CHUNK = 10_000n; // public Base RPC rejects wider ranges
const MAX_CHUNKS = 9; // ~90k blocks ≈ 2 days at 2s/block

export async function GET(req: NextRequest) {
  const vault = req.nextUrl.searchParams.get("vault");
  if (!vault || !isAddress(vault)) {
    return NextResponse.json({ error: "vault required" }, { status: 400 });
  }

  // The public endpoint is used on purpose: our provider rejects eth_getLogs.
  const client = createPublicClient({
    chain: base,
    transport: http("https://mainnet.base.org"),
  });

  try {
    const latest = await client.getBlockNumber();
    const trades: Array<{
      agent: string;
      from: string;
      to: string;
      amountIn: string;
      netOut: string;
      fee: string;
      txHash: string;
      blockNumber: string;
      timestamp: number | null;
    }> = [];

    let chunks = 0;
    for (let hi = latest; chunks < MAX_CHUNKS; chunks++) {
      const lo = hi > CHUNK ? hi - CHUNK : 0n;
      const logs = await client.getLogs({
        address: vault as `0x${string}`,
        event: AGENT_TRADED,
        fromBlock: lo,
        toBlock: hi,
      });
      for (const l of logs) {
        trades.push({
          agent: l.args.agent as string,
          from: l.args.from as string,
          to: l.args.to as string,
          amountIn: (l.args.amountIn as bigint).toString(),
          netOut: (l.args.netOut as bigint).toString(),
          fee: (l.args.fee as bigint).toString(),
          txHash: l.transactionHash,
          blockNumber: l.blockNumber.toString(),
          timestamp: null,
        });
      }
      if (lo === 0n) break;
      hi = lo - 1n;
    }

    // Timestamps only for what we return — one block read per trade.
    const recent = trades
      .sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)))
      .slice(0, 25);
    await Promise.all(
      recent.map(async (t) => {
        try {
          const b = await client.getBlock({ blockNumber: BigInt(t.blockNumber) });
          t.timestamp = Number(b.timestamp);
        } catch {
          /* leave null rather than guess */
        }
      })
    );

    const scannedFrom = latest - CHUNK * BigInt(chunks);
    return NextResponse.json({
      vault,
      trades: recent,
      count: trades.length,
      scannedFromBlock: (scannedFrom > 0n ? scannedFrom : 0n).toString(),
      latestBlock: latest.toString(),
      truncated: true,
      note: `Only the last ~${(CHUNK * BigInt(MAX_CHUNKS)).toString()} blocks are scanned; older trades exist on-chain but are not listed here.`,
    });
  } catch (err) {
    log.error("agent-activity", "getLogs failed", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to read agent activity", detail: String(err) },
      { status: 200 }
    );
  }
}
