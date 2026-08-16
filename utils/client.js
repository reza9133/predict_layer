// utils/client.js

import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

export const CONTRACT_ADDRESS = "0x6823Aed36A72fBE98179D0366A562aF8E9a00FaC";
export const GENLAYER_NETWORK_NAME = "testnetBradbury";
export const BET_AMOUNT_WEI = 10000000000000000n;

/**
 * Helper to safely get the correct Ethereum provider, handling multiple
 * injected wallets (MetaMask, OKX, Rabby, etc.) without crashing.
 */
function getTargetProvider() {
  if (typeof window === "undefined" || !window.ethereum) return undefined;
  
  // If multiple providers are injected (EIP-1193 multi-provider standard)
  if (window.ethereum.providers && Array.isArray(window.ethereum.providers)) {
    // Try to find MetaMask or a provider supporting snaps/standard requests first
    const mmProvider = window.ethereum.providers.find((p) => p.isMetaMask);
    if (mmProvider) return mmProvider;
    return window.ethereum.providers[0];
  }
  
  return window.ethereum;
}

export function getReadClient() {
  return createClient({
    chain: testnetBradbury,
  });
}

export function getWriteClient(account) {
  if (!account) {
    throw new Error("getWriteClient() requires a connected wallet address.");
  }
  
  const provider = getTargetProvider();

  return createClient({
    chain: testnetBradbury,
    account, 
    provider,
  });
}
