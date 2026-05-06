import { avalanche, avalancheFuji, bsc } from 'viem/chains';
import type { Chain } from 'viem';

interface ChainEntry {
  chain: Chain;
  defaultRpcUrl: string;
  bundlerUrl: string;
  paymasterUrl?: string;
  sponsorshipPolicyId?: string;
}

const CHAIN_REGISTRY: Record<number, ChainEntry> = {
  43114: {
    chain: avalanche,
    defaultRpcUrl: import.meta.env.VITE_CHAIN_RPC_URL as string,
    bundlerUrl: import.meta.env.VITE_PIMLICO_BUNDLER_URL as string,
    paymasterUrl: import.meta.env.VITE_PIMLICO_PAYMASTER_URL as string | undefined,
    sponsorshipPolicyId: import.meta.env.VITE_PIMLICO_SPONSORSHIP_POLICY_ID as string | undefined,
  },
  43113: {
    chain: avalancheFuji,
    defaultRpcUrl: import.meta.env.VITE_CHAIN_RPC_URL as string,
    bundlerUrl: import.meta.env.VITE_PIMLICO_BUNDLER_URL as string,
    paymasterUrl: import.meta.env.VITE_PIMLICO_PAYMASTER_URL as string | undefined,
    sponsorshipPolicyId: import.meta.env.VITE_PIMLICO_SPONSORSHIP_POLICY_ID as string | undefined,
  },
  56: {
    chain: bsc,
    defaultRpcUrl: import.meta.env.VITE_BSC_RPC_URL as string,
    bundlerUrl: import.meta.env.VITE_BSC_PIMLICO_BUNDLER_URL as string,
    paymasterUrl: import.meta.env.VITE_BSC_PIMLICO_PAYMASTER_URL as string | undefined,
    sponsorshipPolicyId: import.meta.env.VITE_BSC_PIMLICO_SPONSORSHIP_POLICY_ID as string | undefined,
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
export function getBundlerUrl(chainId: number): string {
  const e = CHAIN_REGISTRY[chainId];
  if (!e?.bundlerUrl) throw new Error(`No bundler configured for chain ${chainId}`);
  return e.bundlerUrl;
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
