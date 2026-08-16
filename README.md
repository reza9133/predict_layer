<div align="center">

# 🔮 PredictLayer

### AI-Adjudicated Prediction Markets, powered by GenLayer

*Trustless markets. No oracles. No committees. Just AI consensus.*

[![Status](https://img.shields.io/badge/status-live-brightgreen?style=for-the-badge)](https://predict-layer.pages.dev)
[![Network](https://img.shields.io/badge/network-GenLayer%20Testnet-6366f1?style=for-the-badge)](https://studio.genlayer.com)
[![Built with Next.js](https://img.shields.io/badge/Next.js-13-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](#-license)

[**Live Demo**](https://predict-layer.pages.dev) · [**Report a Bug**](https://github.com/reza9133/predict_layer/issues) · [**Request a Feature**](https://github.com/reza9133/predict_layer/issues)

</div>

<br>

## 📖 Overview

Every prediction market has the same load-bearing weakness: **the oracle**. Somewhere, a centralized party — a multisig, an admin key, a single API — decides what "really happened." That party can be bribed, censored, go offline, or simply be wrong, and the entire market inherits that fragility.

**PredictLayer removes the oracle entirely.**

Built on [GenLayer's](https://genlayer.com) Intelligent Contracts, PredictLayer resolves markets through **autonomous AI consensus**. When a market expires, independent validator nodes each fetch the source data, run their own LLM-based analysis, and vote on the outcome — all inside the deterministic execution environment of the contract itself. No single node's opinion matters; only the emergent consensus does. The result is an oracle that is decentralized, auditable, and cannot be unilaterally overridden.

Markets are seeded with real-world questions pulled live from **Polymarket's Gamma API**, giving users a familiar, liquid set of events to trade against — but settled entirely on-chain, entirely by AI, entirely without trust in a middleman.

<br>

## ✨ Key Features

- 🌐 **Polymarket-Sourced Markets** — Live market data is bridged in from Polymarket's Gamma API, so every question is grounded in real, actively-traded events.
- 🤖 **Autonomous AI Adjudication** — GenLayer validators independently research each market's sources and reach consensus through non-deterministic, LLM-powered resolution — no human oracle, ever.
- 🔗 **Fully On-Chain Settlement** — Bets, pools, and payouts are all tracked and enforced by the Intelligent Contract on the GenLayer Bradbury Testnet.
- 💰 **Proportional Payouts** — Winning bettors split the losing pool pro-rata, net of a configurable creator fee (capped at 10%).
- 🛡️ **Automatic Refunds** — If consensus can't be reached, the market is cancelled and every bettor is refunded in full — no funds are ever stuck.
- 👛 **Wallet-Scoped History** — Every position, bet, and claim is tracked per-wallet, so users get a clean, personal view of their market activity.
- 🎨 **Bespoke Khaki Ledger UI** — A distinct, editorial visual language built with Tailwind CSS — this doesn't look like every other DeFi dashboard.

<br>

## 🔄 Resolution Flow

```
    ┌──────────────────────────┐
    │      1 · CREATE MARKET     │   Creator defines a question + up to 5 HTTPS sources
    └─────────────┬─────────────┘
                  │
                  ▼
    ┌──────────────────────────┐
    │       2 · USERS BET        │   YES / NO pools fill until the market's deadline
    └─────────────┬─────────────┘
                  │  deadline reached
                  ▼
    ┌──────────────────────────┐
    │   3 · AI CONSENSUS          │   Validators independently fetch sources, run LLM
    │       RESOLUTION            │   adjudication, and vote YES / NO / UNRESOLVED
    └─────────────┬─────────────┘
                  │  consensus reached
                  ▼
    ┌──────────────────────────┐
    │     4 · CLAIM WINNINGS      │   Winners claim a proportional payout
    │                             │   (or a full refund if UNRESOLVED)
    └──────────────────────────┘
```

<br>

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 13 (App Router), Tailwind CSS |
| **Wallet / Chain I/O** | ethers.js, genlayer-js |
| **Smart Contracts** | Python (GenLayer Intelligent Contracts) |
| **Network** | GenLayer Bradbury Testnet |
| **Market Data** | Polymarket Gamma API |

<br>

## 🚀 Getting Started (Local Dev)

**Prerequisites:** Node.js 18+, a GenLayer-compatible wallet (e.g. MetaMask) connected to the Bradbury Testnet.

```bash
# 1. Clone the repository
git clone https://github.com/reza9133/predict_layer.git

# 2. Move into the project directory
cd predict_layer

# 3. Install dependencies
npm install

# 4. Run the development server
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser. 🎉

<br>

## 📜 Smart Contract Architecture

The core `PredictLayer` Intelligent Contract exposes the following methods:

| Method | Type | Description |
|---|---|---|
| `create_market(question, sources_json, duration_days, fee_bps)` | ✍️ Write | Creates a new market from a question and 1–5 HTTPS sources. Fee is capped at 10% (1000 bps). |
| `bet(market_id, is_yes)` | ✍️ Write (payable) | Places a bet on the YES or NO side of an open market before its deadline. |
| `resolve_market(market_id)` | ✍️ Write | Callable once the deadline has passed. Triggers non-deterministic AI consensus across validators to settle the market as `YES`, `NO`, or `UNRESOLVED`. |
| `claim(market_id)` | ✍️ Write | Claims a proportional payout on a resolved market, or a full refund if the market was cancelled as `UNRESOLVED`. |
| `get_market(market_id)` | 👁️ View | Returns a market's full state (question, sources, pools, deadline, outcome) as JSON. |
| `get_bet(market_id, user, is_yes)` | 👁️ View | Returns a given user's bet amount on a specific side of a market. |

> Additional read-only helpers — `get_market_count()` and `get_all_markets(offset, limit)` — support paginated market listings for the frontend.

<br>

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

<br>

## 👤 Author

**Built by amirhp77**

[![X](https://img.shields.io/badge/X-@amirhp771-000000?style=flat-square&logo=x)](https://x.com/amirhp771)
[![GitHub](https://img.shields.io/badge/GitHub-reza9133-181717?style=flat-square&logo=github)](https://github.com/reza9133)

<br>

<div align="center">

*If PredictLayer sparked an idea, a ⭐ on the repo goes a long way.*

</div>
