import { avalanche, avalancheFuji, bsc, polygon } from 'viem/chains';
import type { Chain } from 'viem';

interface ChainEntry {
  chain: Chain;
  defaultRpcUrl: string;
  paymasterUrl?: string;
  sponsorshipPolicyId?: string;
}

export interface PolymarketAddresses {
  usdc: `0x${string}`;
  ctf: `0x${string}`;
  ctfExchange: `0x${string}`;
  negRiskExchange: `0x${string}`;
  negRiskAdapter: `0x${string}`;
}

const POLYMARKET_ADDRESSES_BY_CHAIN: Record<number, PolymarketAddresses> = {
  137: {
    usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    ctf: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
    ctfExchange: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
    negRiskExchange: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
    negRiskAdapter: '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296',
  },
};

export function getPolymarketAddresses(chainId: number): PolymarketAddresses {
  const a = POLYMARKET_ADDRESSES_BY_CHAIN[chainId];
  if (!a) throw new Error(`No Polymarket addresses configured for chain ${chainId}`);
  return a;
}

const CHAIN_REGISTRY: Record<number, ChainEntry> = {
  43114: {
    chain: avalanche,
    defaultRpcUrl: import.meta.env.VITE_CHAIN_RPC_URL as string,
    paymasterUrl: import.meta.env.VITE_PIMLICO_PAYMASTER_URL as string | undefined,
    sponsorshipPolicyId: import.meta.env.VITE_PIMLICO_SPONSORSHIP_POLICY_ID as string | undefined,
  },
  43113: {
    chain: avalancheFuji,
    defaultRpcUrl: import.meta.env.VITE_CHAIN_RPC_URL as string,
    paymasterUrl: import.meta.env.VITE_PIMLICO_PAYMASTER_URL as string | undefined,
    sponsorshipPolicyId: import.meta.env.VITE_PIMLICO_SPONSORSHIP_POLICY_ID as string | undefined,
  },
  56: {
    chain: bsc,
    defaultRpcUrl: import.meta.env.VITE_BSC_RPC_URL as string,
    paymasterUrl: import.meta.env.VITE_BSC_PIMLICO_PAYMASTER_URL as string | undefined,
    sponsorshipPolicyId: import.meta.env.VITE_BSC_PIMLICO_SPONSORSHIP_POLICY_ID as string | undefined,
  },
  137: {
    chain: polygon,
    defaultRpcUrl: import.meta.env.VITE_POLYGON_RPC_URL as string,
    paymasterUrl: import.meta.env.VITE_POLYGON_PIMLICO_PAYMASTER_URL as string | undefined,
    sponsorshipPolicyId: import.meta.env.VITE_POLYGON_PIMLICO_SPONSORSHIP_POLICY_ID as string | undefined,
  },
};

const DEFAULT_CHAIN_ID = 43114;

function homeChainId(): number {
  return Number(import.meta.env.VITE_CHAIN_ID ?? String(DEFAULT_CHAIN_ID));
}

// ── Backward-compatible helpers (existing callers untouched) ───────────────
export function getChain(): Chain { return getChainById(homeChainId()); }
export function getChainId(): number { return homeChainId(); }
export function getRpcUrl(): string { return getRpcUrlById(homeChainId()); }

// ── New chain-aware helpers ────────────────────────────────────────────────
export function getChainById(chainId: number): Chain {
  const e = CHAIN_REGISTRY[chainId];
  if (!e) throw new Error(`Unsupported chain ID: ${chainId}`);
  return e.chain;
}
export function getRpcUrlById(chainId: number): string {
  const e = CHAIN_REGISTRY[chainId];
  if (!e?.defaultRpcUrl) throw new Error(`No RPC configured for chain ${chainId}`);
  return e.defaultRpcUrl;
}
function backendBase(): string {
  const raw = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (!raw) throw new Error('VITE_BACKEND_URL is required');
  return raw.replace(/\/$/, '');
}

// Bundler RPCs are proxied through the BE (see
// be/constructions/2026-05-15-bundler-proxy-be.md). We no longer hold a pimlico
// API key on the FE. The "is this chain reachable" check is "is the chain in
// the registry?" — if the BE has no PIMLICO_BUNDLER_URL_<chainId> set, it
// returns 503 at request time, surfaced as a normal RPC error.
export function getBundlerUrl(chainId: number): string {
  if (!CHAIN_REGISTRY[chainId]) throw new Error(`Unsupported chain ID: ${chainId}`);
  return `${backendBase()}/aa/bundler/${chainId}`;
}
export function getPaymasterUrl(chainId: number): string | undefined {
  return CHAIN_REGISTRY[chainId]?.paymasterUrl;
}
export function getSponsorshipPolicyId(chainId: number): string | undefined {
  return CHAIN_REGISTRY[chainId]?.sponsorshipPolicyId;
}
export function isSupportedChain(chainId: number): boolean {
  return chainId in CHAIN_REGISTRY;
}

// Chain IDs that the eager-onboarding flow should install the session key on.
// Home chain first; secondary chains follow. Comma-separated env override.
export function getOnboardingChainIds(): number[] {
  const raw = (import.meta.env.VITE_ONBOARDING_CHAIN_IDS as string | undefined)?.trim();
  if (raw) {
    const ids = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    if (ids.length > 0) return ids;
  }
  return [getChainId()];
}

export function buildExplorerUrl(chainId: number, txHash: string): string {
  const chain = CHAIN_REGISTRY[chainId]?.chain;
  const baseUrl = chain?.blockExplorers?.default?.url ?? 'https://snowtrace.io';
  return `${baseUrl}/tx/${txHash}`;
}
export function chainName(chainId: number): string {
  return CHAIN_REGISTRY[chainId]?.chain?.name ?? `Chain ${chainId}`;
}
