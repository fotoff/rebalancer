import { NextRequest, NextResponse } from "next/server";
import { keccak256, toBytes, decodeAbiParameters, type Address } from "viem";

const VAULT_ADDRESS = (
  process.env.NEXT_PUBLIC_VAULT_ADDRESS ||
  "0x0000000000000000000000000000000000000000"
).toLowerCase();

const FROM_BLOCK = "41900000"; // approximate vault V2 deploy block

// Event topic0 hashes
const DEPOSIT_TOPIC = keccak256(
  toBytes("Deposit(address,address,uint256)")
);
const WITHDRAW_TOPIC = keccak256(
  toBytes("Withdraw(address,address,uint256)")
);
const REBALANCE_TOPIC = keccak256(
  toBytes("Rebalance(address,address,address,uint256,uint256)")
);

const BASESCAN_API = "https://api.basescan.org/api";

// Fetch logs from BaseScan API (no block-range limits, unlike RPC getLogs)
async function fetchBasescanLogs(
  topic0: string,
  userTopic: string
): Promise<
  { topics: string[]; data: string; transactionHash: string; blockNumber: string }[]
> {
  const params = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: VAULT_ADDRESS,
    topic0,
    topic0_1_opr: "and",
    topic1: userTopic,
    fromBlock: FROM_BLOCK,
    toBlock: "latest",
  });

  const res = await fetch(`${BASESCAN_API}?${params}`, {
    next: { revalidate: 30 },
  });
  const json = await res.json();

  if (json.status === "1" && Array.isArray(json.result)) {
    return json.result;
  }
  // status "0" with message "No records found" is valid (empty)
  if (json.message === "No records found") {
    return [];
  }
  console.error("BaseScan API error:", json);
  return [];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userAddress = searchParams.get("address") as Address | null;

  if (!userAddress) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  // Pad user address to 32 bytes for topic filter
  const userTopic = `0x000000000000000000000000${userAddress.slice(2).toLowerCase()}`;

  try {
    // Fetch all events in parallel via BaseScan
    const [depositLogs, withdrawLogs, rebalanceLogs] = await Promise.all([
      fetchBasescanLogs(DEPOSIT_TOPIC, userTopic),
      fetchBasescanLogs(WITHDRAW_TOPIC, userTopic),
      fetchBasescanLogs(REBALANCE_TOPIC, userTopic),
    ]);

    // --- Parse Deposit events ---
    // Deposit(address indexed user, address indexed token, uint256 amount)
    // topic1 = user, topic2 = token, data = amount
    const deposited: Record<string, string> = {};
    for (const log of depositLogs) {
      const token = ("0x" + log.topics[2].slice(26)).toLowerCase(); // extract address from topic
      const [amount] = decodeAbiParameters(
        [{ type: "uint256" }],
        log.data as `0x${string}`
      );
      const prev = BigInt(deposited[token] ?? "0");
      deposited[token] = (prev + (amount as bigint)).toString();
    }

    // --- Parse Withdraw events ---
    // Withdraw(address indexed user, address indexed token, uint256 amount)
    // topic1 = user, topic2 = token, data = amount
    const withdrawn: Record<string, string> = {};
    for (const log of withdrawLogs) {
      const token = ("0x" + log.topics[2].slice(26)).toLowerCase();
      const [amount] = decodeAbiParameters(
        [{ type: "uint256" }],
        log.data as `0x${string}`
      );
      const prev = BigInt(withdrawn[token] ?? "0");
      withdrawn[token] = (prev + (amount as bigint)).toString();
    }

    // --- Parse Rebalance events ---
    // Rebalance(address indexed user, address fromToken, address toToken, uint256 amountIn, uint256 amountOut)
    // topic1 = user, data = (fromToken, toToken, amountIn, amountOut)
    const rebalances = rebalanceLogs.map((log) => {
      const [fromToken, toToken, amountIn, amountOut] = decodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint256" },
          { type: "uint256" },
        ],
        log.data as `0x${string}`
      );
      return {
        fromToken: (fromToken as string).toLowerCase(),
        toToken: (toToken as string).toLowerCase(),
        amountIn: (amountIn as bigint).toString(),
        amountOut: (amountOut as bigint).toString(),
        blockNumber: parseInt(log.blockNumber, 16),
        txHash: log.transactionHash,
      };
    });

    return NextResponse.json({
      deposited,
      withdrawn,
      rebalances,
    });
  } catch (err) {
    console.error("Vault events error:", err);
    return NextResponse.json(
      { error: "Failed to fetch events", detail: String(err) },
      { status: 500 }
    );
  }
}
