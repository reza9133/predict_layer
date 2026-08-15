"use client";

import { useCallback, useEffect, useState } from "react";
import { TransactionStatus } from "genlayer-js/types";
import {
  CONTRACT_ADDRESS,
  GENLAYER_NETWORK_NAME,
  BET_AMOUNT_WEI,
  getReadClient,
  getWriteClient,
} from "../utils/client";

const DUMMY_QUESTION = "Will ETH close above $10,000 by December 31, 2026?";
const DUMMY_SOURCES_JSON = JSON.stringify([
  "https://www.coingecko.com/en/coins/ethereum"
]);
const DUMMY_DURATION_DAYS = 7;
const DUMMY_FEE_BPS = 200; 

// --- Live Polymarket integration (Limit increased to 24) -------------
const POLYMARKET_API_URL =
  "https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=24";
const POLYMARKET_DEPLOY_FEE_BPS = 200;
const DEFAULT_POLYMARKET_DURATION_DAYS = 7;
const MAX_POLYMARKET_DURATION_DAYS = 365;
const MAX_SOURCES_PER_MARKET = 3;
const POLYMARKET_ITEMS_PER_PAGE = 6;

function shorten(value, head = 6, tail = 4) {
  if (!value) return "";
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function toMarketIdBigInt(rawInput) {
  const trimmed = (rawInput || "").trim();
  if (trimmed === "") {
    throw new Error("Enter a market ID first.");
  }
  try {
    const id = BigInt(trimmed);
    if (id < 0n) throw new Error("Market ID cannot be negative.");
    return id;
  } catch {
    throw new Error("Market ID must be a whole number, e.g. 1, 2, 3.");
  }
}

function formatGEN(weiValue) {
  if (!weiValue) return "0";
  try {
    const num = Number(weiValue) / 1e18;
    return num.toString();
  } catch {
    return weiValue.toString();
  }
}

function formatVolume(value) {
  if (!value) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function stateBadgeClasses(state) {
  if (state === "OPEN") return "border border-[#c9d3e0] bg-[#e9edf3] text-[#33465c]";
  if (state === "RESOLVED") return "border border-[#c3d4b3] bg-[#e9efe1] text-[#2f5233]";
  if (state === "CANCELLED") return "border border-[#e3c3ba] bg-[#f5e9e5] text-[#7a2e2e]";
  return "border border-[#ddd2ba] bg-[#efe9db] text-[#7a715f]";
}

function extractHttpsUrls(text) {
  if (typeof text !== "string" || !text) return [];
  const matches = text.match(/https:\/\/[^\s"')\]}<>]+/gi) || [];
  return matches
    .map((url) => url.replace(/[.,;:!?]+$/, ""))
    .filter((url) => {
      try {
        return new URL(url).protocol === "https:";
      } catch {
        return false;
      }
    });
}

function buildPolymarketEventUrl(market) {
  const eventSlug =
    market?.events?.[0]?.slug || market?.eventSlug || market?.slug || null;
  if (!eventSlug) return null;
  return `https://polymarket.com/event/${eventSlug}`;
}

function extractResolutionSources(market, maxSources = MAX_SOURCES_PER_MARKET) {
  const candidates = [];

  if (typeof market.resolutionSource === "string") {
    const direct = market.resolutionSource.trim();
    if (direct.startsWith("https://")) {
      candidates.push(direct.replace(/[.,;:!?]+$/, ""));
    } else {
      candidates.push(...extractHttpsUrls(direct));
    }
  }

  candidates.push(...extractHttpsUrls(market.description));
  candidates.push(...extractHttpsUrls(market.resolutionData));

  const seen = new Set();
  const deduped = [];
  for (const url of candidates) {
    if (url && !seen.has(url)) {
      seen.add(url);
      deduped.push(url);
    }
  }

  const canonicalUrl = buildPolymarketEventUrl(market);
  if (canonicalUrl && !seen.has(canonicalUrl)) {
    deduped.unshift(canonicalUrl);
  }

  return deduped.slice(0, maxSources);
}

function computeDurationDays(market) {
  const endDateStr = market?.endDate || market?.endDateIso;
  if (!endDateStr) return DEFAULT_POLYMARKET_DURATION_DAYS;
  const endMs = Date.parse(endDateStr);
  if (Number.isNaN(endMs)) return DEFAULT_POLYMARKET_DURATION_DAYS;
  const days = Math.ceil((endMs - Date.now()) / 86400000);
  if (days < 1) return 1;
  if (days > MAX_POLYMARKET_DURATION_DAYS) return MAX_POLYMARKET_DURATION_DAYS;
  return days;
}

function parseOutcomePrices(market) {
  try {
    const outcomes =
      typeof market.outcomes === "string"
        ? JSON.parse(market.outcomes)
        : market.outcomes;
    const prices =
      typeof market.outcomePrices === "string"
        ? JSON.parse(market.outcomePrices)
        : market.outcomePrices;
    if (!Array.isArray(outcomes) || !Array.isArray(prices)) return null;

    const yesIndex = outcomes.findIndex((o) => String(o).toUpperCase() === "YES");
    const noIndex = outcomes.findIndex((o) => String(o).toUpperCase() === "NO");
    if (yesIndex === -1 || noIndex === -1) return null;

    const yesPrice = Number(prices[yesIndex]);
    const noPrice = Number(prices[noIndex]);
    if (Number.isNaN(yesPrice) || Number.isNaN(noPrice)) return null;

    return { yesPrice, noPrice };
  } catch {
    return null;
  }
}

function normalizePolymarketMarket(raw) {
  if (!raw || typeof raw !== "object") return null;

  const question = (raw.question || raw.groupItemTitle || raw.title || "").trim();
  if (question.length < 10) return null;

  const sources = extractResolutionSources(raw);
  if (sources.length === 0) return null;

  return {
    id: String(raw.id ?? raw.conditionId ?? raw.slug ?? question),
    question,
    image: raw.image || raw.icon || null,
    volume24hr: Number(raw.volume24hr) || 0,
    durationDays: computeDurationDays(raw),
    sources,
    prices: parseOutcomePrices(raw),
    eventUrl: buildPolymarketEventUrl(raw),
  };
}

function StatusBanner({ status }) {
  if (status.type === "idle") return null;

  const styles = {
    loading: "border-[#c9d3e0] bg-[#eef1f6] text-[#33465c]",
    success: "border-[#c3d4b3] bg-[#eef2e7] text-[#2f5233]",
    error: "border-[#e3bcae] bg-[#f7ece7] text-[#7a2e2e]",
  };

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-sm transition-colors ${styles[status.type]}`}
    >
      {status.type === "loading" && (
        <span className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {status.type === "success" && <span className="flex-shrink-0">{"\u2705"}</span>}
      {status.type === "error" && <span className="flex-shrink-0">{"\u26A0\uFE0F"}</span>}
      <span className="break-words font-data tracking-tight">{status.message}</span>
    </div>
  );
}

export default function Home() {
  const [account, setAccount] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState({ type: "idle", message: "Ready." });

  const [creating, setCreating] = useState(false);
  const [marketCount, setMarketCount] = useState(null);

  const [marketIdInput, setMarketIdInput] = useState("");
  const [marketRaw, setMarketRaw] = useState(null);
  const [marketData, setMarketData] = useState(null);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [bettingYes, setBettingYes] = useState(false);
  const [bettingNo, setBettingNo] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [checkingBet, setCheckingBet] = useState(false);
  const [myBets, setMyBets] = useState(null);

  const [polymarketMarkets, setPolymarketMarkets] = useState([]);
  const [loadingPolymarket, setLoadingPolymarket] = useState(false);
  const [polymarketError, setPolymarketError] = useState(null);
  const [deployingPolymarketId, setDeployingPolymarketId] = useState(null);
  const [pmPage, setPmPage] = useState(1);

  const [historyItems, setHistoryItems] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  const fetchMarketCount = useCallback(async () => {
    try {
      const client = getReadClient();
      const count = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_market_count",
        args: [],
      });
      setMarketCount(Number(count));
    } catch (err) {
      console.error("Failed to fetch market count:", err);
    }
  }, []);

  const loadMarketData = useCallback(async (idToLoad) => {
    setLoadingMarket(true);
    setMyBets(null);
    try {
      const id = BigInt(idToLoad);
      setStatus({ type: "loading", message: `Loading market #${id}...` });
      const client = getReadClient();
      const raw = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_market",
        args: [id],
      });
      setMarketRaw(raw);
      
      try {
        let parsed = null;
        if (typeof raw === "string") {
          parsed = JSON.parse(raw);
        } else if (typeof raw === "object" && raw !== null) {
          parsed = raw;
        }

        if (parsed) {
          parsed.pool_yes = formatGEN(parsed.pool_yes);
          parsed.pool_no = formatGEN(parsed.pool_no);
          setMarketData(parsed);
        } else {
          setMarketData(null);
        }
      } catch {
        setMarketData(null); 
      }
      
      setStatus({ type: "success", message: `Market #${id} loaded automatically.` });
    } catch (err) {
      setMarketRaw(null);
      setMarketData(null);
      setStatus({ type: "error", message: err?.message || "get_market failed." });
    } finally {
      setLoadingMarket(false);
    }
  }, []);

  const scanMyPredictions = useCallback(async (forAccount) => {
    if (!forAccount) {
      setHistoryItems([]);
      setHistoryError(null);
      return;
    }

    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const client = getReadClient();
      const countRaw = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_market_count",
        args: [],
      });
      const total = Number(countRaw);

      if (!total || total <= 0) {
        setHistoryItems([]);
        return;
      }

      const ids = Array.from({ length: total }, (_, i) => i + 1);

      const perMarket = await Promise.all(
        ids.map(async (id) => {
          try {
            const [marketRawResult, yesBetRaw, noBetRaw] = await Promise.all([
              client.readContract({
                address: CONTRACT_ADDRESS,
                functionName: "get_market",
                args: [BigInt(id)],
              }),
              client.readContract({
                address: CONTRACT_ADDRESS,
                functionName: "get_bet",
                args: [BigInt(id), forAccount, true],
              }),
              client.readContract({
                address: CONTRACT_ADDRESS,
                functionName: "get_bet",
                args: [BigInt(id), forAccount, false],
              }),
            ]);

            const yesAmountWei = (yesBetRaw ?? "0").toString();
            const noAmountWei = (noBetRaw ?? "0").toString();

            if (yesAmountWei === "0" && noAmountWei === "0") {
              return null;
            }

            let market = null;
            try {
              market =
                typeof marketRawResult === "string"
                  ? JSON.parse(marketRawResult)
                  : marketRawResult;
            } catch {
              market = null;
            }

            return {
              marketId: id,
              question: market?.question || `Market #${id}`,
              state: market?.state || "UNKNOWN",
              outcome: market?.outcome || "NONE",
              yesAmountWei,
              noAmountWei,
            };
          } catch (err) {
            console.error(`Failed to load bet history for market #${id}:`, err);
            return null;
          }
        })
      );

      const items = perMarket.filter(Boolean).sort((a, b) => b.marketId - a.marketId);
      setHistoryItems(items);
    } catch (err) {
      console.error("Failed to scan prediction history:", err);
      setHistoryItems([]);
      setHistoryError(err?.message || "Could not load your prediction history.");
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const fetchPolymarketMarkets = useCallback(async () => {
    setLoadingPolymarket(true);
    setPolymarketError(null);
    try {
      const res = await fetch(`${POLYMARKET_API_URL}&_t=${Date.now()}`);
      if (!res.ok) {
        throw new Error(`Polymarket API returned ${res.status}`);
      }
      const raw = await res.json();
      const list = Array.isArray(raw) ? raw : raw?.markets || raw?.data || [];
      const normalized = list
        .map(normalizePolymarketMarket)
        .filter((m) => m !== null);
      setPolymarketMarkets(normalized);
      setPmPage(1); // Reset to page 1 on refresh
    } catch (err) {
      console.error("Failed to fetch Polymarket markets:", err);
      setPolymarketMarkets([]);
      setPolymarketError(
        err?.message || "Could not load live Polymarket markets."
      );
    } finally {
      setLoadingPolymarket(false);
    }
  }, []);

  useEffect(() => {
    fetchMarketCount();
  }, [fetchMarketCount]);

  useEffect(() => {
    fetchPolymarketMarkets();
  }, [fetchPolymarketMarkets]);

  useEffect(() => {
    if (marketCount !== null && marketCount > 0) {
      setMarketIdInput(marketCount.toString());
      loadMarketData(marketCount);
    }
  }, [marketCount, loadMarketData]);

  useEffect(() => {
    if (account) {
      scanMyPredictions(account);
    } else {
      setHistoryItems([]);
      setHistoryError(null);
    }
  }, [account, marketCount, scanMyPredictions]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;

    const eth = window.ethereum?.providers 
      ? window.ethereum.providers.find(p => p.isMetaMask) || window.ethereum.providers[0] 
      : window.ethereum;

    eth
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        if (accounts && accounts.length > 0) setAccount(accounts[0]);
      })
      .catch(() => {});

    const handleAccountsChanged = (accounts) => {
      setAccount(accounts && accounts.length > 0 ? accounts[0] : null);
    };
    eth.on("accountsChanged", handleAccountsChanged);
    return () => {
      if (eth.removeListener) {
        eth.removeListener("accountsChanged", handleAccountsChanged);
      }
    };
  }, []);

  const connectWallet = useCallback(async () => {
    const eth = window.ethereum?.providers 
      ? window.ethereum.providers.find(p => p.isMetaMask) || window.ethereum.providers[0] 
      : window.ethereum;

    if (!eth) {
      setStatus({
        type: "error",
        message: "No wallet detected. Please install a Web3 wallet.",
      });
      return;
    }
    setConnecting(true);
    setStatus({ type: "loading", message: "Connecting wallet..." });
    try {
      const accounts = await eth.request({
        method: "eth_requestAccounts",
      });
      const address = accounts[0];
      
      const client = getWriteClient(address);
      try {
        await client.connect(GENLAYER_NETWORK_NAME);
      } catch (snapErr) {
        console.warn("Snap connection note:", snapErr);
      }

      setAccount(address);
      setStatus({
        type: "success",
        message: `Wallet connected: ${shorten(address)}`,
      });
    } catch (err) {
      setStatus({
        type: "error",
        message: err?.message || "Failed to connect wallet.",
      });
    } finally {
      setConnecting(false);
    }
  }, []);

  const deployMarketToChain = useCallback(
    async ({ question, sourcesJson, durationDays, feeBps, onSuccessLabel }) => {
      try {
        setStatus({ type: "loading", message: "Submitting create_market..." });
        const client = getWriteClient(account);
        const txHash = await client.writeContract({
          address: CONTRACT_ADDRESS,
          functionName: "create_market",
          args: [question, sourcesJson, durationDays, feeBps],
          value: 0n,
        });
        setStatus({
          type: "loading",
          message: `Tx sent (${shorten(txHash)}). Waiting for consensus...`,
        });
        await client.waitForTransactionReceipt({
          hash: txHash,
          status: TransactionStatus.ACCEPTED,
        });
        setStatus({
          type: "success",
          message: onSuccessLabel || "Market deployed successfully!",
        });
        fetchMarketCount();
        return true;
      } catch (err) {
        setStatus({ type: "error", message: err?.message || "create_market failed." });
        return false;
      }
    },
    [account, fetchMarketCount]
  );

  const handleCreateMarket = useCallback(async () => {
    if (!account) {
      setStatus({ type: "error", message: "Connect your wallet first." });
      return;
    }
    setCreating(true);
    await deployMarketToChain({
      question: DUMMY_QUESTION,
      sourcesJson: DUMMY_SOURCES_JSON,
      durationDays: DUMMY_DURATION_DAYS,
      feeBps: DUMMY_FEE_BPS,
      onSuccessLabel: "Market deployed successfully! Auto-loading the new market...",
    });
    setCreating(false);
  }, [account, deployMarketToChain]);

  const handleDeployPolymarketMarket = useCallback(
    async (pm) => {
      if (!account) {
        setStatus({ type: "error", message: "Connect your wallet first." });
        return;
      }
      if (!pm.sources || pm.sources.length === 0) {
        setStatus({
          type: "error",
          message: "No HTTPS resolution source could be extracted for this market.",
        });
        return;
      }
      setDeployingPolymarketId(pm.id);
      await deployMarketToChain({
        question: pm.question,
        sourcesJson: JSON.stringify(pm.sources),
        durationDays: pm.durationDays,
        feeBps: POLYMARKET_DEPLOY_FEE_BPS,
        onSuccessLabel: `Deployed "${pm.question}" to GenLayer from Polymarket.`,
      });
      setDeployingPolymarketId(null);
    },
    [account, deployMarketToChain]
  );

  const handleManualLoadMarket = useCallback(() => {
    try {
      const id = toMarketIdBigInt(marketIdInput);
      loadMarketData(id);
    } catch (err) {
      setStatus({ type: "error", message: err.message });
    }
  }, [marketIdInput, loadMarketData]);

  const goToMarket = useCallback(
    (id) => {
      setMarketIdInput(String(id));
      loadMarketData(id);
      if (typeof document !== "undefined") {
        document
          .getElementById("user-panel-section")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [loadMarketData]
  );

  const handleBet = useCallback(
    async (isYes) => {
      if (!account) {
        setStatus({ type: "error", message: "Connect your wallet first." });
        return;
      }
      const setLoadingFlag = isYes ? setBettingYes : setBettingNo;
      setLoadingFlag(true);
      try {
        const id = toMarketIdBigInt(marketIdInput);
        setStatus({
          type: "loading",
          message: `Placing ${isYes ? "YES" : "NO"} bet on market #${id}...`,
        });
        const client = getWriteClient(account);
        const txHash = await client.writeContract({
          address: CONTRACT_ADDRESS,
          functionName: "bet",
          args: [id, isYes],
          value: BET_AMOUNT_WEI,
        });
        setStatus({
          type: "loading",
          message: `Bet tx sent (${shorten(txHash)}). Waiting for consensus...`,
        });
        await client.waitForTransactionReceipt({
          hash: txHash,
          status: TransactionStatus.ACCEPTED,
        });
        setStatus({
          type: "success",
          message: `${isYes ? "YES" : "NO"} bet placed on market #${id}.`,
        });
        loadMarketData(id);
        scanMyPredictions(account);
      } catch (err) {
        setStatus({ type: "error", message: err?.message || "bet failed." });
      } finally {
        setLoadingFlag(false);
      }
    },
    [account, marketIdInput, loadMarketData, scanMyPredictions]
  );

  const handleResolveMarket = useCallback(async (idOverride) => {
    if (!account) {
      setStatus({ type: "error", message: "Connect your wallet first." });
      return;
    }
    setResolving(true);
    try {
      const id = idOverride !== undefined ? BigInt(idOverride) : toMarketIdBigInt(marketIdInput);
      setStatus({ type: "loading", message: `Resolving market #${id}...` });
      const client = getWriteClient(account);
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "resolve_market",
        args: [id],
        value: 0n,
      });
      await client.waitForTransactionReceipt({
        hash: txHash,
        status: TransactionStatus.ACCEPTED,
      });
      setStatus({ type: "success", message: `Market #${id} resolved.` });
      loadMarketData(id);
      scanMyPredictions(account);
    } catch (err) {
      setStatus({ type: "error", message: err?.message || "resolve_market failed." });
    } finally {
      setResolving(false);
    }
  }, [account, marketIdInput, loadMarketData, scanMyPredictions]);

  const handleClaim = useCallback(async (idOverride) => {
    if (!account) {
      setStatus({ type: "error", message: "Connect your wallet first." });
      return;
    }
    setClaiming(true);
    try {
      const id = idOverride !== undefined ? BigInt(idOverride) : toMarketIdBigInt(marketIdInput);
      setStatus({ type: "loading", message: `Claiming winnings for market #${id}...` });
      const client = getWriteClient(account);
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "claim",
        args: [id],
        value: 0n,
      });
      await client.waitForTransactionReceipt({
        hash: txHash,
        status: TransactionStatus.ACCEPTED,
      });
      setStatus({ type: "success", message: `Claim submitted for market #${id}.` });
      scanMyPredictions(account);
    } catch (err) {
      setStatus({ type: "error", message: err?.message || "claim failed." });
    } finally {
      setClaiming(false);
    }
  }, [account, marketIdInput, scanMyPredictions]);

  const handleCheckMyBet = useCallback(async () => {
    if (!account) {
      setStatus({ type: "error", message: "Connect your wallet first." });
      return;
    }
    setCheckingBet(true);
    try {
      const id = toMarketIdBigInt(marketIdInput);
      setStatus({ type: "loading", message: `Checking your bets on market #${id}...` });
      const client = getReadClient();
      const [yesRaw, noRaw] = await Promise.all([
        client.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_bet",
          args: [id, account, true],
        }),
        client.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_bet",
          args: [id, account, false],
        }),
      ]);
      
      setMyBets({ 
        yes: formatGEN(yesRaw), 
        no: formatGEN(noRaw) 
      });
      
      setStatus({ type: "success", message: `Loaded your bets for market #${id}.` });
    } catch (err) {
      setStatus({ type: "error", message: err?.message || "get_bet failed." });
    } finally {
      setCheckingBet(false);
    }
  }, [account, marketIdInput]);

  const walletConnected = Boolean(account);

  // Pagination calculations for Polymarket items (6 per page across 4 pages)
  const totalPmPages = Math.ceil(polymarketMarkets.length / POLYMARKET_ITEMS_PER_PAGE) || 1;
  const currentPmMarkets = polymarketMarkets.slice(
    (pmPage - 1) * POLYMARKET_ITEMS_PER_PAGE,
    pmPage * POLYMARKET_ITEMS_PER_PAGE
  );

  return (
    <main className="relative min-h-screen bg-[#f4efe2] font-sans text-[#2b2620]">
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,450;9..144,550;9..144,650&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        .font-display { font-family: 'Fraunces', ui-serif, Georgia, serif; }
        .font-data { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace; }
      `}} />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(#2b2620 0.7px, transparent 0.7px)",
          backgroundSize: "16px 16px",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-64 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(156,107,46,0.10), transparent)",
        }}
      />

      <div className="relative mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        <header className="flex flex-col items-start justify-between gap-4 border-b border-dashed border-[#cfc3a3] pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="font-data mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9c6b2e]">
              Prediction Markets &middot; GenLayer Bradbury Testnet
            </p>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-[#2b2620] sm:text-4xl">
              PredictLayer
            </h1>
          </div>
          <button
            type="button"
            onClick={connectWallet}
            disabled={connecting || walletConnected}
            className="font-data rounded-md bg-[#2b2620] px-5 py-2.5 text-sm font-semibold tracking-tight text-[#f4efe2] shadow-sm transition hover:bg-[#40382d] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {walletConnected
              ? `Connected: ${shorten(account)}`
              : connecting
              ? "Connecting..."
              : "Connect Wallet"}
          </button>
        </header>

        <StatusBanner status={status} />

        {/* Two-Column Dashboard Layout */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          
          {/* Left Sidebar (About & Roadmap) */}
          <aside className="lg:col-span-4 flex flex-col gap-6">
            <div className="rounded-xl border border-[#ddd2ba] bg-[#fffcf5] p-5 shadow-sm">
              <h2 className="font-display mb-2 text-lg font-semibold text-[#2b2620]">About PredictLayer</h2>
              <p className="text-xs leading-relaxed text-[#7a715f]">
                PredictLayer is a decentralized, AI-adjudicated prediction market protocol built on GenLayer. By bridging live global market data from Polymarket with autonomous AI consensus validators, it ensures trustless, verifiable resolutions without human bias.
              </p>
            </div>

            <div className="rounded-xl border border-[#ddd2ba] bg-[#fffcf5] p-5 shadow-sm">
              <h2 className="font-display mb-3 text-lg font-semibold text-[#2b2620]">Project Roadmap</h2>
              <div className="flex flex-col gap-3 text-xs">
                <div className="border-l-2 border-[#9c6b2e] pl-3">
                  <span className="font-data font-bold text-[#9c6b2e]">Phase 1 · Testnet Live</span>
                  <p className="mt-1 text-[#7a715f]">Smart contracts on GenLayer Bradbury, Gamma API integration, & wallet-scoped tracking.</p>
                </div>
                <div className="border-l-2 border-[#d8cbaa] pl-3">
                  <span className="font-data font-bold text-[#5c5544]">Phase 2 · Advanced AI</span>
                  <p className="mt-1 text-[#7a715f]">Multi-source oracle verification and custom user-submitted market resolution sources.</p>
                </div>
                <div className="border-l-2 border-[#d8cbaa] pl-3">
                  <span className="font-data font-bold text-[#5c5544]">Phase 3 · Mainnet & DAO</span>
                  <p className="mt-1 text-[#7a715f]">Mainnet launch, creator fee sharing model, and decentralized community governance.</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[#ddd2ba] bg-[#fffcf5] p-5 shadow-sm">
              <h2 className="font-display mb-2 text-lg font-semibold text-[#2b2620]">Network Stats</h2>
              <div className="flex flex-col gap-2 text-xs text-[#5c5544]">
                <div className="flex justify-between border-b border-dashed border-[#e3d8bc] pb-2">
                  <span className="text-[#7a715f]">Network</span>
                  <span className="font-data font-semibold">GenLayer Testnet</span>
                </div>
                <div className="flex justify-between border-b border-dashed border-[#e3d8bc] pb-2">
                  <span className="text-[#7a715f]">Total Markets</span>
                  <span className="font-data font-semibold">{marketCount !== null ? marketCount : "0"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#7a715f]">Contract</span>
                  <span className="font-data font-semibold">{shorten(CONTRACT_ADDRESS)}</span>
                </div>
              </div>
            </div>
          </aside>

          {/* Right Main Interactive Column */}
          <div className="lg:col-span-8 flex flex-col gap-8">
            
            {/* Admin Panel */}
            <section className="rounded-xl border border-[#ddd2ba] bg-[#fffcf5] p-5 shadow-sm sm:p-6">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-xl font-semibold text-[#2b2620]">Admin Panel</h2>
                {marketCount !== null && (
                  <span className="font-data -rotate-1 rounded border border-[#c9d3e0] bg-[#e9edf3] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#33465c]">
                    Total Markets Created: {marketCount}
                  </span>
                )}
              </div>
              <p className="mb-4 text-sm text-[#7a715f]">
                Deploys a demo market using dummy data, for quick testing.
              </p>

              <div className="mb-4 rounded-lg border border-[#ecdfc0] bg-[#f8f2e2] p-4 text-sm text-[#5c5544]">
                <p className="mb-1">
                  <span className="font-medium text-[#2b2620]">Question:</span> {DUMMY_QUESTION}
                </p>
                <p className="mb-1">
                  <span className="font-medium text-[#2b2620]">Duration:</span>{" "}
                  <span className="font-data">{DUMMY_DURATION_DAYS} days</span>
                </p>
                <p>
                  <span className="font-medium text-[#2b2620]">Fee:</span>{" "}
                  <span className="font-data">{DUMMY_FEE_BPS / 100}%</span>
                </p>
              </div>

              <button
                type="button"
                onClick={handleCreateMarket}
                disabled={!walletConnected || creating}
                className="rounded-md bg-[#9c6b2e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#8a5d26] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? "Deploying..." : "Deploy Default Market"}
              </button>
              {!walletConnected && (
                <p className="mt-2 text-xs text-[#a89d86]">Connect your wallet to deploy a market.</p>
              )}
            </section>

            {/* Live from Polymarket with Pagination */}
            <section className="rounded-xl border border-[#ddd2ba] bg-[#fffcf5] p-5 shadow-sm sm:p-6">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-xl font-semibold text-[#2b2620]">Live from Polymarket</h2>
                  <span className="font-data flex items-center gap-1.5 rounded-full border border-[#c3d4b3] bg-[#e9efe1] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#2f5233]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#2f5233] animate-pulse" />
                    Live (24 Markets)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={fetchPolymarketMarkets}
                  disabled={loadingPolymarket}
                  className="rounded-md border border-[#d8cbaa] px-3 py-1.5 text-xs font-semibold text-[#5c5544] transition hover:bg-[#f8f2e2] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingPolymarket ? "Refreshing..." : "Refresh"}
                </button>
              </div>
              <p className="mb-4 text-sm text-[#7a715f]">
                Top markets by 24h volume, pulled live from Polymarket&apos;s public Gamma API.
              </p>

              {polymarketError && (
                <div className="mb-4 rounded-lg border border-[#e3bcae] bg-[#f7ece7] px-4 py-3 text-sm text-[#7a2e2e]">
                  {polymarketError}
                </div>
              )}

              {loadingPolymarket && polymarketMarkets.length === 0 && !polymarketError && (
                <p className="text-sm text-[#a89d86]">Loading live markets...</p>
              )}

              {!loadingPolymarket && polymarketMarkets.length === 0 && !polymarketError && (
                <p className="text-sm text-[#a89d86]">
                  No live Polymarket markets with an extractable HTTPS source right now.
                </p>
              )}

              {currentPmMarkets.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {currentPmMarkets.map((pm) => (
                    <div
                      key={pm.id}
                      className="flex flex-col overflow-hidden rounded-xl border border-[#ddd2ba] bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div className="flex items-start gap-3 p-4">
                        {pm.image ? (
                          <img
                            src={pm.image}
                            alt=""
                            className="h-12 w-12 flex-shrink-0 rounded-lg border border-[#e8ddc4] object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="font-display flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border border-[#e8ddc4] bg-[#f8f2e2] text-sm font-bold text-[#9c6b2e]">
                            {pm.question.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p
                            className="line-clamp-2 text-sm font-semibold text-[#2b2620]"
                            title={pm.question}
                          >
                            {pm.question}
                          </p>
                          <p className="font-data mt-1 text-xs text-[#a89d86]">
                            24h volume: {formatVolume(pm.volume24hr)}
                          </p>
                        </div>
                      </div>

                      {pm.prices && (
                        <div className="font-data flex gap-2 px-4">
                          <span className="rounded-full border border-[#c3d4b3] bg-[#e9efe1] px-2.5 py-1 text-xs font-semibold text-[#2f5233]">
                            YES {(pm.prices.yesPrice * 100).toFixed(0)}%
                          </span>
                          <span className="rounded-full border border-[#e3c3ba] bg-[#f5e9e5] px-2.5 py-1 text-xs font-semibold text-[#7a2e2e]">
                            NO {(pm.prices.noPrice * 100).toFixed(0)}%
                          </span>
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-1.5 px-4 text-xs text-[#7a715f]">
                        <span className="font-medium text-[#5c5544]">Source:</span>
                        {pm.sources.map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-[#9c6b2e] hover:text-[#7a5623] hover:underline"
                            title={url}
                          >
                            {safeHostname(url)}
                          </a>
                        ))}
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-dashed border-[#e3d8bc] p-4">
                        <span className="font-data text-xs text-[#a89d86]">{pm.durationDays}d window</span>
                        <button
                          type="button"
                          onClick={() => handleDeployPolymarketMarket(pm)}
                          disabled={!walletConnected || deployingPolymarketId !== null}
                          className="rounded-md bg-[#9c6b2e] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#8a5d26] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deployingPolymarketId === pm.id ? "Deploying..." : "Deploy to GenLayer"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination Controls (4 Pages) */}
              {polymarketMarkets.length > 0 && (
                <div className="mt-6 flex items-center justify-between border-t border-dashed border-[#e3d8bc] pt-4">
                  <span className="font-data text-xs text-[#7a715f]">
                    Page {pmPage} of {totalPmPages}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: totalPmPages }, (_, i) => i + 1).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPmPage(p)}
                        className={`font-data h-8 w-8 rounded-md text-xs font-semibold transition ${
                          pmPage === p
                            ? "bg-[#2b2620] text-[#f4efe2]"
                            : "border border-[#d8cbaa] bg-white text-[#5c5544] hover:bg-[#f8f2e2]"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* User Panel */}
            <section id="user-panel-section" className="rounded-xl border border-[#ddd2ba] bg-[#fffcf5] p-5 shadow-sm sm:p-6">
              <h2 className="font-display mb-1 text-xl font-semibold text-[#2b2620]">User Panel</h2>
              <p className="mb-4 text-sm text-[#7a715f]">
                Market loads automatically. You can also manually load a specific ID to place a bet.
              </p>

              <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Market ID, e.g. 1"
                  value={marketIdInput}
                  onChange={(e) => setMarketIdInput(e.target.value)}
                  className="font-data flex-1 rounded-md border border-[#d8cbaa] bg-white px-3 py-2 text-sm text-[#2b2620] outline-none focus:border-[#9c6b2e] focus:ring-1 focus:ring-[#9c6b2e]"
                />
                <button
                  type="button"
                  onClick={handleManualLoadMarket}
                  disabled={loadingMarket}
                  className="rounded-md bg-[#2b2620] px-4 py-2 text-sm font-semibold text-[#f4efe2] shadow-sm transition hover:bg-[#40382d] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMarket ? "Loading..." : "Load Market"}
                </button>
              </div>

              {marketRaw !== null && (
                <div className="font-data mb-4 rounded-lg border border-[#ecdfc0] bg-[#f8f2e2] p-4 text-xs text-[#5c5544]">
                  <p className="mb-2 font-sans font-medium text-[#2b2620]">get_market result</p>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words">
                    {marketData ? JSON.stringify(marketData, null, 2) : marketRaw}
                  </pre>
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => handleBet(true)}
                  disabled={!walletConnected || bettingYes || bettingNo}
                  className="flex-1 rounded-md bg-[#2f5233] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#264429] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bettingYes ? "Betting YES..." : "Bet YES (0.01 GEN)"}
                </button>
                <button
                  type="button"
                  onClick={() => handleBet(false)}
                  disabled={!walletConnected || bettingYes || bettingNo}
                  className="flex-1 rounded-md bg-[#7a2e2e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#672626] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bettingNo ? "Betting NO..." : "Bet NO (0.01 GEN)"}
                </button>
              </div>
            </section>

            {/* My Predictions */}
            <section className="rounded-xl border border-[#ddd2ba] bg-[#fffcf5] p-5 shadow-sm sm:p-6">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-xl font-semibold text-[#2b2620]">My Predictions</h2>
                <button
                  type="button"
                  onClick={() => scanMyPredictions(account)}
                  disabled={!walletConnected || loadingHistory}
                  className="rounded-md border border-[#d8cbaa] px-3 py-1.5 text-xs font-semibold text-[#5c5544] transition hover:bg-[#f8f2e2] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingHistory ? "Scanning..." : "Refresh"}
                </button>
              </div>
              <p className="mb-4 text-sm text-[#7a715f]">
                Your own bets only, scanned live from the contract for your connected wallet.
              </p>

              {!walletConnected && (
                <p className="text-sm text-[#a89d86]">
                  Connect your wallet to view your prediction history.
                </p>
              )}

              {walletConnected && historyError && (
                <div className="mb-4 rounded-lg border border-[#e3bcae] bg-[#f7ece7] px-4 py-3 text-sm text-[#7a2e2e]">
                  {historyError}
                </div>
              )}

              {walletConnected && loadingHistory && historyItems.length === 0 && !historyError && (
                <p className="text-sm text-[#a89d86]">Scanning your markets...</p>
              )}

              {walletConnected && !loadingHistory && historyItems.length === 0 && !historyError && (
                <p className="text-sm text-[#a89d86]">
                  No active bets found for this wallet yet.
                </p>
              )}

              {walletConnected && historyItems.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {historyItems.map((item) => {
                    const isWinningYes =
                      item.state === "RESOLVED" && item.outcome === "YES" && item.yesAmountWei !== "0";
                    const isWinningNo =
                      item.state === "RESOLVED" && item.outcome === "NO" && item.noAmountWei !== "0";
                    const canClaimWinnings = isWinningYes || isWinningNo;
                    const canClaimRefund = item.state === "CANCELLED";

                    return (
                      <div
                        key={item.marketId}
                        className="flex flex-col overflow-hidden rounded-xl border border-[#ddd2ba] bg-white shadow-sm"
                      >
                        <div className="p-4">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="font-data text-xs font-semibold text-[#a89d86]">
                              Market #{item.marketId}
                            </span>
                            <span
                              className={`font-data -rotate-1 rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${stateBadgeClasses(item.state)}`}
                            >
                              {item.state}
                            </span>
                          </div>
                          <p className="line-clamp-2 text-sm font-semibold text-[#2b2620]">
                            {item.question}
                          </p>
                          <div className="font-data mt-3 flex flex-wrap gap-2">
                            {item.yesAmountWei !== "0" && (
                              <span className="rounded-full border border-[#c3d4b3] bg-[#e9efe1] px-2.5 py-1 text-xs font-semibold text-[#2f5233]">
                                YES: {formatGEN(item.yesAmountWei)} GEN
                              </span>
                            )}
                            {item.noAmountWei !== "0" && (
                              <span className="rounded-full border border-[#e3c3ba] bg-[#f5e9e5] px-2.5 py-1 text-xs font-semibold text-[#7a2e2e]">
                                NO: {formatGEN(item.noAmountWei)} GEN
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-dashed border-[#e3d8bc] p-4">
                          <button
                            type="button"
                            onClick={() => goToMarket(item.marketId)}
                            className="rounded-md border border-[#d8cbaa] px-3 py-1.5 text-xs font-semibold text-[#5c5544] transition hover:bg-[#f8f2e2]"
                          >
                            View Market
                          </button>
                          {item.state === "OPEN" && (
                            <button
                              type="button"
                              onClick={() => handleResolveMarket(item.marketId)}
                              disabled={resolving}
                              className="rounded-md border border-[#d8cbaa] px-3 py-1.5 text-xs font-semibold text-[#5c5544] transition hover:bg-[#f8f2e2] disabled:opacity-60"
                            >
                              {resolving ? "Resolving..." : "Resolve"}
                            </button>
                          )}
                          {canClaimWinnings && (
                            <button
                              type="button"
                              onClick={() => handleClaim(item.marketId)}
                              disabled={claiming}
                              className="rounded-md bg-[#9c6b2e] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#8a5d26] disabled:opacity-60"
                            >
                              {claiming ? "Claiming..." : "Claim Winnings"}
                            </button>
                          )}
                          {canClaimRefund && (
                            <button
                              type="button"
                              onClick={() => handleClaim(item.marketId)}
                              disabled={claiming}
                              className="rounded-md bg-[#9c6b2e] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#8a5d26] disabled:opacity-60"
                            >
                              {claiming ? "Claiming..." : "Claim Refund"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Market Actions (Manual Tools) */}
            <section className="rounded-xl border border-dashed border-[#c9bb95] bg-[#fffcf5] p-5 shadow-sm sm:p-6">
              <h2 className="font-display mb-1 text-xl font-semibold text-[#2b2620]">Market Actions</h2>
              <p className="mb-4 text-sm text-[#7a715f]">
                Optional manual tools covering resolve_market, claim, and get_bet for any market ID.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleResolveMarket()}
                  disabled={!walletConnected || resolving}
                  className="rounded-md border border-[#d8cbaa] px-4 py-2 text-sm font-semibold text-[#5c5544] transition hover:bg-[#f8f2e2] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resolving ? "Resolving..." : "Resolve Market"}
                </button>
                <button
                  type="button"
                  onClick={() => handleClaim()}
                  disabled={!walletConnected || claiming}
                  className="rounded-md border border-[#d8cbaa] px-4 py-2 text-sm font-semibold text-[#5c5544] transition hover:bg-[#f8f2e2] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {claiming ? "Claiming..." : "Claim Winnings"}
                </button>
                <button
                  type="button"
                  onClick={handleCheckMyBet}
                  disabled={!walletConnected || checkingBet}
                  className="rounded-md border border-[#d8cbaa] px-4 py-2 text-sm font-semibold text-[#5c5544] transition hover:bg-[#f8f2e2] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {checkingBet ? "Checking..." : "Check My Bet"}
                </button>
              </div>

              {myBets && (
                <div className="font-data mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-[#ecdfc0] bg-[#f8f2e2] p-3 text-xs text-[#5c5544]">
                    <p className="mb-1 font-sans font-medium text-[#2b2620]">Your YES bet</p>
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words">{myBets.yes}</pre>
                  </div>
                  <div className="rounded-lg border border-[#ecdfc0] bg-[#f8f2e2] p-3 text-xs text-[#5c5544]">
                    <p className="mb-1 font-sans font-medium text-[#2b2620]">Your NO bet</p>
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words">{myBets.no}</pre>
                  </div>
                </div>
              )}
            </section>

            {/* How It Works */}
            <section className="rounded-xl border border-[#ddd2ba] bg-[#fffcf5] p-5 shadow-sm sm:p-6">
              <h2 className="font-display mb-3 text-xl font-semibold text-[#2b2620]">How It Works</h2>
              <div className="grid grid-cols-1 gap-4 text-xs text-[#5c5544] md:grid-cols-3">
                <div className="rounded-lg border border-[#ecdfc0] bg-[#f8f2e2] p-3">
                  <span className="font-data mb-1 block font-bold text-[#9c6b2e]">01 · Deploy Market</span>
                  Admins deploy a prediction question and verifiable HTTPS web sources onto GenLayer.
                </div>
                <div className="rounded-lg border border-[#ecdfc0] bg-[#f8f2e2] p-3">
                  <span className="font-data mb-1 block font-bold text-[#9c6b2e]">02 · Place Bets</span>
                  Users fund and place decentralized bets (YES or NO) before the market deadline.
                </div>
                <div className="rounded-lg border border-[#ecdfc0] bg-[#f8f2e2] p-3">
                  <span className="font-data mb-1 block font-bold text-[#9c6b2e]">03 · AI Adjudication</span>
                  GenLayer consensus validators automatically evaluate sources to resolve outcomes and payout winners.
                </div>
              </div>
            </section>

          </div>
        </div>

        {/* Footer */}
        <footer className="flex flex-col items-center justify-between gap-4 border-t border-dashed border-[#cfc3a3] pt-6 text-xs text-[#7a715f] sm:flex-row">
          <div className="font-data">
            Contract <span className="text-[#5c5544]">{shorten(CONTRACT_ADDRESS)}</span> on GenLayer Bradbury Testnet
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <span className="text-[#a89d86]">
              Built by{" "}
              <a
                href="https://x.com/amirhp771"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-[#9c6b2e] transition hover:text-[#7a5623] hover:underline"
              >
                amirhp77
              </a>
            </span>
            <a
              href="https://github.com/reza9133/predict_layer"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-[#9c6b2e] transition hover:text-[#7a5623] hover:underline"
            >
              GitHub Repository ↗
            </a>
            <span className="font-data flex items-center gap-1.5 text-[#2f5233]">
              <span className="h-2 w-2 rounded-full bg-[#2f5233] animate-pulse"></span>
              <span>Live on Testnet</span>
            </span>
          </div>
        </footer>
      </div>
    </main>
  );
}