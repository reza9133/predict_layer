<div align="center">

# 🔮 PredictLayer

### AI-Adjudicated Prediction Markets, Powered by GenLayer

*Decentralized forecasting where AI consensus — not human oracles — settles the truth.*

[![Status](https://img.shields.io/badge/status-live-brightgreen)](https://predict-layer.pages.dev)
[![Network](https://img.shields.io/badge/network-GenLayer%20Bradbury%20Testnet-6E56CF)](https://studio.genlayer.com)
[![Built with](https://img.shields.io/badge/built%20with-Next.js%2013-black?logo=next.js)](https://nextjs.org/)
[![Contracts](https://img.shields.io/badge/contracts-GenLayer%20Intelligent%20Contracts-orange)](#-smart-contract-details)
[![License](https://img.shields.io/badge/license-MIT-blue)](#)

[🌐 Live App](https://predict-layer.pages.dev) · [💻 Repository](https://github.com/reza9133/predict_layer) · [🧠 GenLayer Docs](https://docs.genlayer.com)

</div>

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Architecture & Tech Stack](#️-architecture--tech-stack)
- [Resolution Flow](#-resolution-flow)
- [Getting Started](#-getting-started)
- [Smart Contract Details](#-smart-contract-details)
- [Author & Socials](#-author--socials)

---

## 🧭 Overview

**PredictLayer** is a decentralized, AI-adjudicated prediction market protocol built on **[GenLayer](https://genlayer.com)** — a blockchain purpose-built for *Intelligent Contracts* that can reason over real-world, off-chain data with non-deterministic AI consensus.

Instead of relying on centralized oracles or manual dispute resolution, PredictLayer bridges **live market data from Polymarket** directly into on-chain markets, and settles outcomes through a network of independent AI validator nodes that read the same real-world sources, reason over them, and converge on a single, trust-minimized answer.

The result is a prediction market where **creation is permissionless, betting is trustless, and resolution is autonomous.**

---

## ✨ Key Features

- **📡 Live Polymarket Integration** — Markets are seeded and enriched using the Polymarket Gamma API, with full pagination support for browsing live, real-world markets.
- **🤖 AI-Adjudicated Smart Contracts** — Market resolution runs through GenLayer's non-deterministic consensus model, where validator nodes independently research an outcome and agree on-chain.
- **👛 Wallet-Scoped History** — A personal **"My Predictions"** dashboard tracks every market a connected wallet has created or bet on.
- **🎨 Custom Ledger Aesthetic** — A bespoke khaki, paper-ledger inspired UI, typeset in **Fraunces** (serif display) and **JetBrains Mono** (data/numerals) for a tactile, editorial feel.

---

## 🏗️ Architecture & Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend Framework** | Next.js 13 (App Router) | Server/client rendering, routing, React 18 |
| **Styling** | Tailwind CSS + custom theme tokens | Khaki ledger aesthetic, responsive layout |
| **Typography** | Fraunces & JetBrains Mono | Editorial display type + monospaced data |
| **Blockchain Layer** | GenLayer Protocol (Bradbury Testnet) | Intelligent Contracts w/ AI consensus |
| **Contract Language** | Python Intelligent Contracts | Non-deterministic, LLM-aware contract logic |
| **Chain Client SDK** | `genlayer-js` | Read/write client, wallet-aware transactions |
| **Wallet Layer** | `ethers.js` + injected providers | Multi-wallet detection (MetaMask, Rabby, OKX, etc.) |
| **External Data** | Polymarket Gamma API | Live market sourcing & reference pricing |

---

## 🔄 Resolution Flow

PredictLayer's core innovation is replacing a human/oracle resolution step with **autonomous AI validator consensus**, natively enforced by the GenLayer protocol.

```
 1. CREATE MARKET
    ┌─────────────────────────────────────────────┐
    │ create_market(question, sources_json,        │
    │                duration_days, fee_bps)        │
    └─────────────────────────────────────────────┘
                        │
                        ▼
 2. MARKET OPEN — USERS BET
    ┌─────────────────────────────────────────────┐
    │ bet(market_id, is_yes)  [payable]             │
    │   • YES pool          • NO pool               │
    │   • pools accumulate until duration_days ends │
    └─────────────────────────────────────────────┘
                        │
                        ▼  (duration elapses)
 3. RESOLUTION TRIGGERED
    ┌─────────────────────────────────────────────┐
    │ resolve_market(market_id)                     │
    └─────────────────────────────────────────────┘
                        │
                        ▼
 4. NON-DETERMINISTIC AI CONSENSUS
    ┌─────────────────────────────────────────────┐
    │ • Independent GenLayer validator nodes wake up│
    │ • Each validator's LLM reads the market's     │
    │   `sources_json` (e.g. Polymarket, news, APIs)│
    │ • Each validator reasons over the question     │
    │   and proposes an outcome (YES / NO)          │
    │ • Validators compare outputs and converge on  │
    │   a majority-consensus result on-chain        │
    └─────────────────────────────────────────────┘
                        │
                        ▼
 5. CLAIM WINNINGS
    ┌─────────────────────────────────────────────┐
    │ claim(market_id)                              │
    │   • Winning-side bettors withdraw their share │
    │     of the losing pool, minus protocol fee    │
    └─────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm (or yarn / pnpm / bun)
- A browser wallet (MetaMask, Rabby, OKX, etc.) configured for the **GenLayer Bradbury Testnet**

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/reza9133/predict_layer.git
cd predict_layer

# 2. Install dependencies
npm install

# 3. Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to see PredictLayer running locally.

> **Note:** This project uses `legacy-peer-deps=true` (see `.npmrc`) to resolve peer dependency overlaps between `ethers` and `genlayer-js`.

---

## 📜 Smart Contract Details

PredictLayer's markets are governed by a GenLayer Intelligent Contract exposing the following entry points:

| Function | Type | Description |
|---|---|---|
| `create_market(question, sources_json, duration_days, fee_bps)` | Write | Deploys a new market with a question, reference data sources, betting duration, and protocol fee (in basis points). Returns the new `market_id`. |
| `bet(market_id, is_yes)` | Write · `payable` | Places a wager on the `YES` or `NO` side of an open market. |
| `resolve_market(market_id)` | Write | Triggers GenLayer's validator network to research the market's sources and reach non-deterministic AI consensus on the outcome. |
| `claim(market_id)` | Write | Allows a winning bettor to withdraw their proportional share of the resolved market's pool. |
| `get_market(market_id)` | Read | Returns the full state of a market (question, pools, status, resolution) as JSON. |
| `get_bet(market_id, user, is_yes)` | Read | Returns a specific user's bet on a given side of a market as JSON. |

---

## 👤 Author & Socials

Built with ❤️ by **amirhp77**

[![X (Twitter)](https://img.shields.io/badge/X-@amirhp771-black?logo=x)](https://x.com/amirhp771)
[![GitHub](https://img.shields.io/badge/GitHub-reza9133-black?logo=github)](https://github.com/reza9133)

---

<div align="center">

*PredictLayer — where AI consensus settles the future.*

</div>
