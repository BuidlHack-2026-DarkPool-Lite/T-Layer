# 🌑 T-LAYER

**MEV-Protected OTC Trading on BNB Chain, Powered by Competitive TEE Matching + AI**

> Every on-chain order is public. Bots exploit it before you can blink.
> T-LAYER fixes this.

[![BuidlHack 2026](https://img.shields.io/badge/BuidlHack-2026-blue)]()
[![BNB Chain](https://img.shields.io/badge/BNB_Chain-Testnet-F0B90B)]()
[![NEAR AI](https://img.shields.io/badge/NEAR_AI-TEE-00C1DE)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-green)]()

---

## The Problem

DeFi traders lose **$1.3B+** to MEV (Maximal Extractable Value) attacks annually. Front-running bots watch the public mempool and exploit pending orders before they settle. Market makers flee to centralized exchanges, liquidity dries up, and spreads widen — everyday traders pay the price.

## The Solution

T-LAYER is a **decentralized dark pool** for MEV-free OTC trading on BNB Chain. Three competing AI strategies match orders inside a **NEAR AI Trusted Execution Environment (TEE)**, a Judge AI picks the optimal result, and matched trades settle via **on-chain atomic swaps**. No one — not even the server operator — can see the order book or tamper with matching results.

### Key Features

- **Competitive TEE Matching** — 3 AI strategies race in parallel; a Judge scores and selects the best result. Proves the outcome is better than alternatives.
- **Double-Layer Privacy** — Wallet addresses are stripped before entering the TEE. Even if the TEE is compromised, trader identity stays hidden.
- **AI-Powered Pricing** — Real-time fair price aggregated from Binance, Chainlink oracle, and PancakeSwap with dynamic slippage guardrails.
- **Atomic Settlement** — Escrow deposit → TEE-signed match → on-chain atomic swap. Zero counterparty risk.
- **MEV Structural Impossibility** — Not just mitigation — MEV is architecturally impossible because order data only exists inside the TEE.

---

## Architecture: Competitive TEE Matching

```
┌──────────────┐    ┌──────────────┐    ┌─────────────────────────────────────────────┐
│              │    │              │    │           NEAR AI TEE ENCLAVE               │
│  1. User     │───▶│ 2. Anonymize │───▶│                                             │
│  Order       │    │  Strip wallet│    │  ┌────────────┐┌────────────┐┌────────────┐ │
│  MetaMask →  │    │  Order ID    │    │  │ TEE Call 1 ││ TEE Call 2 ││ TEE Call 3 │ │
│  Frontend →  │    │  only        │    │  │Conservative││ Volume Max ││   Free     │ │
│  Backend API │    │              │    │  │Safe matching││Max fill    ││ Optimizer  │ │
└──────────────┘    └──────────────┘    │  │            ││ rate       ││LLM decides │ │
                                        │  └─────┬──────┘└─────┬──────┘└─────┬──────┘ │
                                        │        └─────────────┼─────────────┘        │
                                        │                      ▼                      │
                                        │             ┌──────────────┐                │
                                        │             │  TEE Call 4  │  Scoring:      │
                                        │             │    JUDGE     │  Fill Rate 40% │
                                        │             │ Score &      │  Spread    30% │
                                        │             │ Select Winner│  Fairness  30% │
                                        │             └──────┬───────┘                │
                                        └────────────────────┼────────────────────────┘
                                                             ▼
┌──────────────┐    ┌──────────────────────┐    ┌─────────────────┐
│ 7. Result    │◀───│ 6. On-chain          │◀───│ 5. TEE          │
│ to User      │    │ Settlement           │    │ Signature       │
│ via WebSocket│    │ executeSwap() on BSC │    │ ECDSA +         │
│ TX hash +    │    │ DarkPoolEscrow       │    │ NVIDIA GPU      │
│ Winner +     │    │                      │    │ Attestation     │
│ Score table  │    │                      │    │                 │
└──────────────┘    └──────────────────────┘    └─────────────────┘
```

### How the 4 TEE Calls Work

Each role runs on a **different TEE-protected model** inside NEAR AI Cloud for maximum diversity.

| TEE Call | Strategy | Model | Approach |
|----------|----------|-------|----------|
| **Call 1: Conservative** | Safe matching | Qwen3-30B-A3B | Match by smallest price gap first. If uncertain, don't match. |
| **Call 2: Volume Max** | Max fill rate | GPT-OSS-120B | Fill as many orders as possible. Aggressive partial fills. |
| **Call 3: Free Optimizer** | LLM decides | GPT-OSS-120B | Balance fill rate, price quality, and fairness holistically. |
| **Call 4: Judge** | Score & select | Qwen3-30B-A3B | Evaluate all 3 results: Fill Rate (40%) + Spread (30%) + Fairness (30%). Pick the winner. |

### Why Competitive > Single Matching

A single TEE matcher can only prove *"this TEE was fair."*
Competitive TEE matching proves *"this result was **better** than the alternatives."*

---

## Privacy Design

Wallet addresses are **stripped before entering the TEE**:

| TEE Receives | TEE Does NOT Know |
|---|---|
| `{ id: "order-001", side: "buy", pair: "BNB/USDT", amount: 10, price: 590 }` | Wallet address (`0x7F...3b9A`), IP address, trade history |

The TEE returns `"order-001 ↔ order-003 matched"` → Backend restores order ID → wallet mapping → executes on-chain. Even if the TEE is compromised, trader identity is never exposed.

---

## Monorepo Structure

```
T-Layer/
├── apps/
│   ├── contracts/                # Solidity (Hardhat) — 32 tests
│   │   ├── contracts/
│   │   │   ├── DarkPoolEscrow.sol   # Escrow + atomic swap + TEE sig verify
│   │   │   ├── TestToken.sol        # ERC20 test tokens (tUSDT, tBNBT)
│   │   │   └── mocks/              # MockERC20, ReentrancyAttacker
│   │   ├── scripts/
│   │   │   ├── deploy.js            # Escrow-only deploy
│   │   │   └── deploy-full.js       # Full deploy (tokens + escrow + mint)
│   │   └── test/DarkPoolEscrow.test.js
│   ├── engine/                   # Python (FastAPI + NEAR AI TEE)
│   │   └── src/
│   │       ├── matching/
│   │       │   ├── engine.py          # _competitive_match() — 3 strategies + Judge
│   │       │   ├── llm_engine.py      # TEE call functions (4 parallel calls)
│   │       │   ├── prompt.py          # Strategy-specific system prompts
│   │       │   ├── runner.py          # Matching cycle orchestrator
│   │       │   ├── validator.py       # Match result validation
│   │       │   └── schema.py          # Data models
│   │       ├── attestation/           # NEAR AI + NVIDIA GPU attestation
│   │       ├── pricing/               # Binance, Chainlink, PancakeSwap feeds
│   │       │   ├── aggregator.py      # Multi-source price aggregation
│   │       │   └── dynamic_slippage.py # Volatility-aware slippage control
│   │       ├── signer/                # ECDSA signing + BSC submission
│   │       │   ├── hash_builder.py    # EIP-191 struct hash for executeSwap
│   │       │   ├── signer.py          # TEE wallet ECDSA signing
│   │       │   ├── submitter.py       # BSC transaction broadcast
│   │       │   └── pipeline.py        # Sign → submit → broadcast pipeline
│   │       ├── mm_bot/                # Market maker bot (auto-quotes on BSC testnet)
│   │       ├── models/                # Order, OrderBook, Match data models
│   │       └── main.py / routes.py / ws.py
│   └── frontend/                 # React + Vite + wagmi
│       └── src/
│           ├── App.tsx                # Main UI + matching result display
│           ├── hooks/                 # useWallet, useEscrow
│           ├── services/              # API + WebSocket clients
│           └── config.ts / abi.ts
├── packages/contracts-abi/       # Shared ABI (single source of truth)
├── tools/                        # Dev utilities
└── .github/workflows/            # CI (path-filtered matrix)
```

---

## Live Demo

| Service | URL |
|---------|-----|
| **Frontend** | [tlayer-test1.vercel.app](https://tlayer-test1.vercel.app) |
| **Engine API** | [t-layer-production.up.railway.app](https://t-layer-production.up.railway.app) |

## Deployed Contracts (BSC Testnet)

| Contract | Address |
|----------|---------|
| **DarkPoolEscrow** | [`0xfc0279c78F800ffb963f89E507e2E6909A40d407`](https://testnet.bscscan.com/address/0xfc0279c78F800ffb963f89E507e2E6909A40d407) |
| **TestToken tUSDT** | [`0xF34fB8fDe28c4162F998Cf9B42068a828a417bC3`](https://testnet.bscscan.com/address/0xF34fB8fDe28c4162F998Cf9B42068a828a417bC3) |
| **TestToken tBNBT** | [`0x1Ef37FA15bc5933398a1177EF04302399A4588d4`](https://testnet.bscscan.com/address/0x1Ef37FA15bc5933398a1177EF04302399A4588d4) |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **Python** ≥ 3.11 + [uv](https://github.com/astral-sh/uv)
- **MetaMask** wallet with BSC Testnet configured
- **tBNB** from [BNB Chain Testnet Faucet](https://www.bnbchain.org/en/testnet-faucet)

### 1. Clone & Install

```bash
git clone https://github.com/BuidlHack-2026-DarkPool-Lite/T-Layer.git
cd T-Layer
```

### 2. Deploy Contracts

```bash
cd apps/contracts
cp .env.example .env
# Edit .env:
#   DEPLOYER_PRIVATE_KEY=0x...
#   TEE_SIGNER_ADDRESS=0x... (TEE signer wallet public address)

npx hardhat run scripts/deploy-full.js --network bscTestnet
```

This deploys tUSDT + tBNBT test tokens, DarkPoolEscrow, and mints 100K tokens to the MM bot. Save the output addresses.

Optional — verify on BSCScan:
```bash
npx hardhat verify --network bscTestnet <CONTRACT_ADDRESS> <TEE_SIGNER_ADDRESS>
```

### 3. Start the Engine

```bash
cd apps/engine
cp .env.example .env
# Edit .env:
#   ESCROW_CONTRACT_ADDRESS=0x... (from step 2)
#   TEE_PRIVATE_KEY=0x... (TEE signer wallet private key)
#   BSC_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545
#   NEARAI_CLOUD_API_KEY=... (optional, from https://app.near.ai)
#   NEAR_AI_API_KEY=... (optional, for LLM matching reasoning)

uv run uvicorn src.main:app --reload
```

> **NEAR AI keys required** for competitive TEE matching (3 strategies + Judge).
> Attestation shows "VERIFIED" + AI reasoning displayed in UI.

### 4. Start the Frontend

```bash
cd apps/frontend
cp .env.example .env
# Edit .env:
#   VITE_ESCROW_ADDRESS=0x... (from step 2)
#   VITE_TOKEN_BNB=0x... (tBNBT address from step 2)
#   VITE_TOKEN_USDT=0x... (tUSDT address from step 2)

npm install
npm run dev
```

### 5. Smoke Test

1. Open the app → Connect MetaMask (BSC Testnet)
2. Place a **buy** order for BNB → MetaMask approve + deposit
3. Built-in **MM bot** auto-places the counterparty sell order
4. Watch 3 strategies compete inside the TEE (~30-60s) → Judge picks the winner
5. `executeSwap` settles on-chain atomically
6. Results display across **5 paginated screens**: Trade Summary → TEE Matching → Attestation → Analysis → Privacy Report
7. Check BSCScan: only deposit and swap txs visible — **no order info on-chain**

---

## Why TEE Is Essential

| Attack Scenario | Without TEE | With TEE |
|---|---|---|
| Operator manipulates match results | Possible — server can modify | Impossible — execution inside TEE |
| Operator rigs Judge scores | Possible — scoring logic editable | Impossible — Judge runs inside TEE |
| Operator reads orders pre-match | Possible — server logs visible | Meaningless — wallet addresses stripped |
| Third-party verification | "Trust me, it was fair" | Attestation report proves it |

**Key insight:** A single TEE proves fairness. Competitive TEE proves *optimality*.

---

## Why TEE over ZKP?

| | TEE (T-LAYER) | ZKP |
|---|---|---|
| Matching latency | Milliseconds | Seconds to minutes (proof generation) |
| Multi-party matching | Native support | Extremely complex circuits |
| Real-time pricing | Live DEX feeds inside enclave | Hard to incorporate external data |
| Competitive strategies | Multiple LLMs in parallel | Not feasible with ZK circuits |
| Implementation complexity | Production-ready (NEAR AI Cloud) | Research-stage for matching |

---

## Market Maker Incentive

Traditional DEX market makers lose spread profits to sandwich bots. In T-LAYER, order data lives exclusively inside the TEE — MEV is **structurally impossible**. This protected spread is the core incentive for MM participation.

**Roadmap:**
- **MVP** — Team acts as MM for demo
- **Phase 2** — 0.1% per-trade fee + MM rebate + priority matching
- **Phase 3** — LP pool: MM 40% / LP 40% / Protocol 20%

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Smart Contract | Solidity (Hardhat) — BSC Testnet |
| TEE Engine | Python, FastAPI, NEAR AI Cloud TEE |
| AI Matching | 4 TEE models: Qwen3-30B-A3B, GPT-OSS-120B (NEAR AI Cloud TEE) |
| AI Pricing | Multi-source aggregation (Binance, Chainlink, PancakeSwap) |
| Frontend | React, TypeScript, Vite, wagmi, viem |
| Real-time | WebSocket (FastAPI ↔ React) — live match results + order updates |
| Verification | NEAR AI attestation + NVIDIA GPU attestation + ECDSA signature recovery |
| CI | GitHub Actions (path-filtered matrix) |

---

## Team

Built at **BuidlHack 2026** — BNB Chain + NEAR AI Track.

| Name | Role | Focus |
|------|------|-------|
| Daeyun | PM / Pitch | Product strategy + pitch deck + submission |
| Hyeonseung | Lead / TEE Backend | NEAR AI Cloud + matching engine |
| Jinsung | Frontend | wagmi + React UX |
| Giho | AI Matching | Price feed + optimization |
| Seungjae | Contract Lead | Solidity escrow + atomic swap |

---

## Links

- [Live Demo](https://tlayer-test1.vercel.app)
- [GitHub](https://github.com/BuidlHack-2026-DarkPool-Lite/T-Layer)

---

## License

MIT
