# 🌑 DarkPool Lite

**MEV-Protected OTC Trading on BNB Chain, Powered by TEE + AI**

> Every on-chain order is public. Bots exploit it before you can blink.
> DarkPool Lite fixes this.

[![BuidlHack 2026](https://img.shields.io/badge/BuidlHack-2026-blue)]()
[![BNB Chain](https://img.shields.io/badge/BNB_Chain-Testnet-F0B90B)]()
[![NEAR AI](https://img.shields.io/badge/NEAR_AI-TEE-00C1DE)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-green)]()

---

## The Problem

DeFi traders lose **$1.3B+** to MEV (Maximal Extractable Value) attacks annually. Front-running bots watch the public mempool and exploit pending orders before they settle. Market makers flee to centralized exchanges, liquidity dries up, and spreads widen — everyday traders pay the price.

## The Solution

DarkPool Lite is a **decentralized dark pool** for MEV-free OTC trading on BNB Chain. Orders are matched inside a **Trusted Execution Environment (TEE)** where no one — not even the server operator — can see the order book. AI calculates fair pricing from multiple DEX feeds, and matched trades settle via **on-chain atomic swaps** with zero counterparty risk.

### Key Features

- **TEE Privacy** — Orders matched inside NEAR AI Cloud TEE. Order data never leaves the enclave.
- **AI-Powered Pricing** — Real-time fair price aggregated from PancakeSwap & Binance with dynamic slippage guardrails.
- **Rule-Based Matching** — Transparent price-priority → time-priority (FIFO) matching with partial fill support.
- **Atomic Settlement** — Escrow-based deposit → TEE-signed match → on-chain atomic swap. No counterparty risk.
- **MEV Structural Impossibility** — Not just mitigation — MEV is architecturally impossible because order data only exists inside the TEE.

---

## Architecture

```
┌──────────────┐     ┌──────────────────────────────┐     ┌─────────────────┐
│              │     │     TEE Matching Engine       │     │                 │
│   Frontend   │────▶│  ┌─────────────────────────┐  │────▶│   BSC Escrow    │
│  (React +    │ WS  │  │ Rule-Based Matcher      │  │ TX  │   Contract      │
│   wagmi)     │◀────│  │ AI Fair Price (LLM)     │  │◀────│  (Solidity)     │
│              │     │  │ Slippage Guardrail      │  │     │                 │
└──────┬───────┘     │  └─────────────────────────┘  │     └─────────────────┘
       │             │     NEAR AI Cloud             │
       │             └──────────────────────────────┘
       │
       ▼
  ┌──────────┐
  │ MetaMask │  approve + deposit
  │ (BSC)    │  ───────────────▶  Escrow Contract
  └──────────┘
```

### Data Flow

1. **User deposits** tokens into the escrow smart contract on BSC (on-chain)
2. **Encrypted order** is sent to the TEE matching engine (off-chain)
3. **AI fetches** live prices from PancakeSwap & Binance, calculates fair mid-price (off-chain, inside TEE)
4. **Rule-based matcher** executes price-priority → time-priority matching with partial fills (off-chain, inside TEE)
5. **TEE signs** the match result → contract verifies signature → **atomic swap executes** (on-chain)

Only deposit and swap transactions appear on-chain. **No order information is ever recorded on the blockchain.**

---

## Monorepo Structure

```
darkpool-lite/
├── apps/
│   ├── contracts/       # Solidity — DarkPoolEscrow.sol (Hardhat)
│   ├── engine/          # Python — TEE matching engine (FastAPI + NEAR AI)
│   └── frontend/        # TypeScript — React + wagmi + ethers.js
├── packages/
│   └── contracts-abi/   # Shared ABI for frontend ↔ contract
├── tools/               # Dev utilities
└── .github/workflows/   # CI (path-filtered matrix)
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **Python** ≥ 3.11 + [uv](https://github.com/astral-sh/uv)
- **MetaMask** wallet with BSC Testnet configured
- **tBNB** from [BNB Chain Testnet Faucet](https://www.bnbchain.org/en/testnet-faucet)

### 1. Clone & Install

```bash
git clone https://github.com/BuidlHack-2026-DarkPool-Lite/darkpool-lite.git
cd darkpool-lite
```

### 2. Deploy Contracts

```bash
cd apps/contracts
cp .env.example .env
# Edit .env:
#   DEPLOYER_PRIVATE_KEY=0x...
#   TEE_SIGNER_ADDRESS=0x... (TEE signer wallet public address)

npx hardhat run scripts/deploy.js --network bscTestnet
```

Save the deployed contract address — you'll need it for the next steps.

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

> Without NEAR AI keys the demo still works — attestation shows "UNVERIFIED" and matching uses the rule engine. With keys, attestation shows "VERIFIED" and AI generates matching reasoning.

### 4. Start the Frontend

```bash
cd apps/frontend
cp .env.example .env
# Edit .env:
#   VITE_ESCROW_ADDRESS=0x... (from step 2)
#   VITE_TOKEN_BNB=0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd

npm install
npm run dev
```

### 5. Smoke Test

1. Open the app → Connect MetaMask (BSC Testnet)
2. **Tab 1 (Bob / MM):** Place a buy order for 100 BNB → approve + deposit
3. **Tab 2 (Alice / Trader):** Place a sell order for 80 BNB → approve + deposit
4. Watch the TEE match in seconds → atomic swap executes
5. Check BSCScan: only deposit and swap txs visible — **no order info on-chain**
6. Bob's remaining 20 BNB stays in the pool (partial fill)

---

## Matching Rules

All matching happens inside the TEE. The rules are public; the order data is not.

| Rule | Description |
|------|-------------|
| Price Compatibility | Buy limit ≥ Sell limit to match |
| Price Priority | Highest buy / Lowest sell matched first |
| Time Priority | Same price → FIFO |
| AI Fair Price | Mid-price calculated from multiple DEX feeds |
| Slippage Guard | Rejects matches outside ±1.5% of limit price (dynamic) |
| Partial Fills | 100 sell vs 60 buy → 60 filled, 40 remains in pool |
| Minimum Size | Prevents dust trades (e.g., min 1 BNB) |

---

## Why TEE over ZKP?

| | TEE (DarkPool Lite) | ZKP |
|---|---|---|
| Matching latency | Milliseconds | Seconds to minutes (proof generation) |
| Multi-party matching | Native support | Extremely complex circuits |
| Real-time pricing | Live DEX feeds inside enclave | Hard to incorporate external data |
| Implementation complexity | Production-ready (NEAR AI Cloud) | Research-stage for matching |

---

## Market Maker Incentive

Traditional DEX market makers lose spread profits to sandwich bots. In DarkPool Lite, order data lives exclusively inside the TEE — MEV is **structurally impossible**. This protected spread is the core incentive for MM participation.

**Roadmap:**
- **MVP** — Team acts as MM for demo
- **Phase 2** — 0.1% per-trade fee + MM rebate + priority matching
- **Phase 3** — LP pool: MM 40% / LP 40% / Protocol 20%

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Smart Contract | Solidity (Hardhat) on BSC/opBNB Testnet |
| TEE Engine | Python, FastAPI, NEAR AI Cloud TEE |
| AI Pricing | Multi-source aggregation (PancakeSwap, Binance) + LLM reasoning |
| Frontend | React, TypeScript, wagmi, ethers.js |
| CI | GitHub Actions (path-filtered matrix) |

---

## Team

Built at **BuidlHack 2026** — BNB Chain + NEAR AI Track.

| Name | Role | Focus |
|------|------|-------|
| Daeyun | PM / Pitch | Strategy + demo + submission |
| Hyunseung | Lead / TEE Backend | NEAR AI Cloud + matching engine |
| Jinsung | Frontend | wagmi + React UX |
| Kiho | AI Matching | Price feed + optimization |
| Seungjae | Contract Lead | Solidity escrow + atomic swap |

---

## Links

- 🎬 [Demo Video](#) <!-- TODO: insert link -->
- 📊 [Pitch Deck](#) <!-- TODO: insert link -->
- 🐦 [Tweet](#) <!-- TODO: insert link -->

---

## License

MIT
