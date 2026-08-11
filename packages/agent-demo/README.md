# Reference rebalancing agent

An autonomous agent that trades on Base without holding anyone's funds.

It buys a rebalancing decision over [x402](https://tokenrebalancer.com/agents)
(HTTP 402, $0.01 in USDC, no signup), then executes through an **AgentVault**
owned by someone else. The vault enforces every limit on-chain, so the agent's
own code is not what keeps the owner safe — the contract is.

What the agent **cannot** do, regardless of what this file says:

- withdraw — only the vault owner can;
- route the swap output anywhere but the vault — output is measured as a balance
  delta on the vault, so anything else reverts;
- accept a bad price — when an oracle exists, the minimum output comes from the
  oracle, and the agent's own `agentMinOut` can only raise it;
- exceed the grant — per-trade notional, a rolling 24h budget, a cooldown and an
  expiry are all checked in `agentTrade`.

## Setup

The **vault owner** does this once, at
[tokenrebalancer.com/agent-vault](https://tokenrebalancer.com/agent-vault):

1. Deploy an agent vault.
2. Send it the token to be traded (e.g. a little WETH).
3. Authorise the agent's address for a pair, with a per-trade cap, a daily
   budget and an expiry.

The **agent operator** then:

```bash
cp .env.example .env    # fill in AGENT_PRIVATE_KEY and AGENT_VAULT_ADDRESS
npm install --ignore-scripts
```

The agent wallet needs a little ETH on Base for gas — and USDC only if you run
with `--pay`. It never holds the traded funds.

## Running

```bash
node agent.mjs --once          # one cycle, free signal, nothing broadcast
node agent.mjs --once --pay    # same, but pay $0.01 over x402 for the signal
node agent.mjs --execute       # live: real trades, on a loop
```

**Nothing is broadcast without `--execute`.** A dry run does the full decision
path — preflight, signal, route — and prints the transaction it would have sent.
Start there.

## What one cycle does

1. **`canTrade(agent, from, to, amountIn)`** — asks the vault whether this trade
   is permitted right now. Cheaper than a reverted transaction, and it answers
   with a reason: `not permitted`, `expired`, `cooldown`, `budget exceeded`,
   `notional too large`, `insufficient balance`, `protocol paused`.
2. **Signal** — `POST /api/x402/signal` with `--pay`, otherwise the free
   `/api/ai/analyze-pair`. Both are backed by the same analysis: cointegration,
   spread z-score, OU half-life, and a fee-aware backtest against holding.
3. **Route** — LI.FI quote with the *vault* as both sender and recipient.
4. **`agentTrade(...)`** — submit. The vault takes the higher of our min-out and
   the oracle floor.

The agent holds when the signal doesn't favour rebalancing. On the free route
that means requiring the backtest to beat holding *and* the spread to be
stretched past 1.5σ — most cycles will correctly do nothing, which is the point.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_PRIVATE_KEY` | — | the agent's wallet (gas + optional x402 payments) |
| `AGENT_VAULT_ADDRESS` | — | the vault you were granted permission on |
| `FROM_TOKEN` / `TO_TOKEN` | WETH / USDC | the authorised pair direction |
| `TRADE_FRACTION` | `0.25` | share of the vault's `FROM` balance per trade |
| `INTERVAL_MS` | `900000` | 15 minutes between cycles |
| `BASE_RPC_URL` | public Base RPC | use your own for anything sustained |

## Contracts

| | |
|---|---|
| AgentVaultFactory | [`0xcE7328D01cD32114CF0da856588b891b06d3D2b9`](https://basescan.org/address/0xcE7328D01cD32114CF0da856588b891b06d3D2b9#code) |
| AgentVault implementation | [`0x36839b4d9C9a1d3Ee034B835bC1fc9d06E01Ee50`](https://basescan.org/address/0x36839b4d9C9a1d3Ee034B835bC1fc9d06E01Ee50#code) |

Both verified on BaseScan. They are covered by automated tests but **have not
been audited** — start with small budgets.
