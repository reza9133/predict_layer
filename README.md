<div align="center">

# 📊 PredictLayer

### Decentralized, AI-Adjudicated Prediction Markets — Powered by GenLayer

*Bridging live global event data with autonomous AI consensus validation.*

[![Live on GenLayer](https://img.shields.io/badge/Live%20on-GenLayer%20Bradbury%20Testnet-6366f1?style=for-the-badge)](https://genlayer.com)
[![Built with Next.js](https://img.shields.io/badge/Built%20with-Next.js%2013-000000?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Status](https://img.shields.io/badge/Status-Active%20Development-brightgreen?style=for-the-badge)]()

</div>

---

## 🧭 Overview

**PredictLayer** is a decentralized prediction market protocol built on **[GenLayer](https://genlayer.com)** — a blockchain that natively supports non-deterministic, AI-powered smart contracts. Unlike traditional prediction markets that rely on centralized oracles or manual dispute resolution, PredictLayer settles markets using an **autonomous consensus of AI validator nodes**, each independently reading real-world source data and voting on the outcome.

The protocol draws in **live market data from Polymarket** to seed relevant, real-world questions, and lets users create, bet on, and resolve markets entirely on-chain — with resolution logic that is transparent, reproducible, and resistant to single-point manipulation.

No centralized oracle. No manual arbitration committee. Just deterministic contract logic wrapping non-deterministic AI judgment, secured by GenLayer's validator consensus.

---

## ✨ Key Features

- 🔴 **Live Polymarket Integration** — Pulls trending and active markets directly from the Polymarket Gamma API, with full pagination support for smooth browsing of large market sets.
- 🤖 **AI-Adjudicated Smart Contracts** — Market resolution is handled by GenLayer's non-deterministic execution model (`gl.vm.run_nondet_unsafe`), where multiple validators independently fetch source URLs and reach consensus on a `YES` / `NO` / `UNRESOLVED` outcome.
- 👛 **Wallet-Scoped History** — A "My Predictions" dashboard that surfaces each connected wallet's bets, positions, and claimable payouts across every market.
- 🎨 **Custom Ledger Aesthetic** — A distinctive, editorial "ledger" visual identity: a warm khaki color palette paired with **Fraunces** (serif display) and **JetBrains Mono** (monospace data) typography for a feel that's part financial terminal, part paper ledger.

---

## 🏗️ Architecture & Tech Stack

| Layer | Technology |
|---|---|
| **Frontend Framework** | [Next.js 13](https://nextjs.org/) (App Router) |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) |
| **Smart Contracts** | [GenLayer Protocol](https://genlayer.com) — Python-based Intelligent Contracts |
| **Chain Interaction** | [`ethers.js`](https://docs.ethers.org/v5/) + [`genlayer-js`](https://www.npmjs.com/package/genlayer-js) |
| **Language** | TypeScript |
| **Off-chain Data Source** | Polymarket Gamma API |

### How resolution works

```
create_market()  →  users bet() YES/NO into pooled liquidity
        ↓
   deadline reached
        ↓
resolve_market()  →  leader node runs _resolve_nondet()
        ↓                    ↓
        │        each validator independently fetches
        │        the market's source URLs and asks an
        │        LLM oracle prompt: YES / NO / UNRESOLVED
        ↓
  validators compare results → consensus reached
        ↓
  outcome written on-chain → claim() unlocks payouts
```

Because the resolution prompt and its sanitized inputs are deterministic given the same source data, independent validators converge on the same answer — giving GenLayer's consensus mechanism something concrete to agree (or disagree) on.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm (or yarn / pnpm / bun)
- A GenLayer-compatible wallet for testnet interaction

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

### Other useful scripts

```bash
npm run build   # Production build
npm run start   # Serve the production build
npm run lint    # Run ESLint (next/core-web-vitals config)
```

---

## 📜 Smart Contract Details

The core protocol contract, `PredictLayer`, is written as a GenLayer Intelligent Contract in Python. Key entry points:

| Function | Type | Description |
|---|---|---|
| `create_market(question, sources_json, duration_days, fee_bps)` | Write | Creates a new market with 1–5 HTTPS source URLs, a betting deadline, and an optional creator fee (capped at 10%). |
| `bet(market_id, is_yes)` | Payable Write | Places a bet on `YES` or `NO` for an open market, pooling native value into the corresponding side. |
| `resolve_market(market_id)` | Write | Triggers non-deterministic AI resolution once the deadline has passed — validators independently evaluate the source data and reach consensus on `YES`, `NO`, or `UNRESOLVED`. |
| `claim(market_id)` | Write | Lets a bettor withdraw their winnings from a resolved market, or a full refund if the market was cancelled as `UNRESOLVED`. |
| `get_bet(market_id, user, is_yes)` | View | Returns the amount a given address has staked on a given side of a market. |
| `get_market(market_id)` / `get_all_markets(offset, limit)` | View | Read single or paginated market data for frontend rendering, with server-side pagination limits to prevent unbounded responses. |

Resolution uses a **checks-effects-interactions** pattern for payouts and fails closed whenever on-chain time data is unavailable, prioritizing safety over availability.

---

## 👤 Author & Links

Built by **amirhp77**

- 🐦 X (Twitter): [@amirhp771](https://x.com/amirhp771)
- 💻 GitHub: [reza9133/predict_layer](https://github.com/reza9133/predict_layer)

---

<div align="center">

*PredictLayer — where prediction markets meet autonomous intelligence.*

</div>
