# Rebalancer

**AI-powered non-custodial token rebalancing on Base L2.**

Rebalancer automatically monitors token pairs and executes rebalancing swaps when price conditions are met — keeping your portfolio balanced while you stay in full control of your funds.

## Features

- **Non-Custodial Vault** — Your tokens are held in a smart contract you control. No third-party access.
- **Smart Triggers** — Set ratio-based, price-based, or trend-guarded triggers. The system monitors 24/7 and executes when conditions are met.
- **AI Advisor** — Built-in AI analyzes price divergence, volatility trends, and social sentiment to recommend optimal rebalancing actions.
- **Best DEX Routing** — Swaps are executed via [LI.FI](https://li.fi) aggregator for optimal rates across multiple DEXes.
- **Base L2** — Built on Base for fast, cheap transactions with sub-cent gas fees.
- **Policy Guardrails** — Built-in safety checks: max slippage, minimum edge, cooldowns, and liquidity verification.

## Architecture

```
packages/
├── web/              # Next.js 15 frontend + API
├── ai-advisor/       # Python/FastAPI AI recommendation engine
├── trigger-checker/  # Node.js trigger monitoring service
└── contracts/        # Solidity smart contracts (RebalancerVault V3)
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React, Tailwind CSS, RainbowKit, wagmi, viem |
| Backend API | Next.js API Routes, SQLite (better-sqlite3) |
| AI Advisor | Python 3.12+, FastAPI, numpy, pandas, httpx |
| Smart Contract | Solidity, Hardhat, Base Mainnet |
| Swap Routing | LI.FI API |
| Market Data | DexScreener, CoinGecko |
| Automation | PM2 process manager, Nginx reverse proxy |

## How It Works

1. **Connect Wallet** — Connect to Base network via RainbowKit
2. **Create a Pair** — Select two tokens and deposit them into the vault
3. **Set Triggers** — Manually or via AI recommendations, set conditions for rebalancing
4. **Auto-Rebalance** — Trigger checker monitors prices and executes swaps automatically when conditions are met

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.12+ (for AI Advisor)
- npm

### Setup

```bash
# Install root dependencies
npm install

# Setup web package
cd packages/web
cp ../../.env.example .env.local
# Fill in your API keys in .env.local
npm install
npm run dev

# Setup AI Advisor (optional)
cd packages/ai-advisor
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Fill in your config in .env
uvicorn src.main:app --host 127.0.0.1 --port 8000
```

### Environment Variables

Copy `.env.example` to `.env.local` (web) or `.env` (ai-advisor) and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `ALCHEMY_API_KEY` | Yes | Alchemy API key for token balance scanning |
| `NEXT_PUBLIC_VAULT_ADDRESS` | Yes | Deployed RebalancerVault contract address |
| `INTERNAL_API_KEY` | Yes | Shared secret for trigger-checker authentication |
| `GOPLUS_API_KEY` | No | GoPlus Security for scam token detection |
| `AI_ADVISOR_URL` | No | URL of AI Advisor service (default: http://127.0.0.1:8000) |
| `AI_SERVICE_SECRET` | No | HMAC shared secret between web and AI Advisor |

## Smart Contract

**RebalancerVault V3** — deployed on Base Mainnet.

- Multi-token vault with per-user accounting
- Owner-controlled executor for automated swaps
- Deposit, withdraw, and rebalance functions
- No admin access to user funds

## Deployment

The project runs on a VDS with PM2 process manager:

```bash
# Web (Next.js)
pm2 start npm --name rebalancer-web -- start

# AI Advisor (Python)
pm2 start ecosystem.config.cjs  # in packages/ai-advisor/

# Trigger Checker (Node.js)
pm2 start checker.mjs --name trigger-checker  # in packages/trigger-checker/
```

## License

Private. All rights reserved.

---

Built on [Base](https://base.org) | Swaps via [LI.FI](https://li.fi)
