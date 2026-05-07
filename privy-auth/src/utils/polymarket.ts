// EIP-712 shape MUST match on-chain CTFExchange Signatures.sol — verify before
// any non-test stake.

import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, parseUnits, toHex } from 'viem';
import type { Hex } from 'viem';
import { getPolymarketAddresses } from './chainConfig';
import type { PolymarketOrderArtifact } from '../types/predictionMarket.types';

export const POLYMARKET_CHAIN_ID = 137;

function buildDomain(verifyingContract: `0x${string}`) {
  return {
    name: 'Polymarket CTF Exchange',
    version: '1',
    chainId: POLYMARKET_CHAIN_ID,
    verifyingContract,
  } as const;
}

const ORDER_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'taker', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'makerAmount', type: 'uint256' },
    { name: 'takerAmount', type: 'uint256' },
    { name: 'expiration', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'feeRateBps', type: 'uint256' },
    { name: 'side', type: 'uint8' },
    { name: 'signatureType', type: 'uint8' },
  ],
} as const;

export type OrderSide = 'BUY' | 'SELL';

export interface BuildOrderInput {
  maker: `0x${string}`;
  tokenId: string;
  priceBps: number;
  shares: string;
  side: OrderSide;
  expiration?: number;
  salt: string;
  nonce?: string;
  feeRateBps?: number;
  negRisk?: boolean;
}

export function buildUnsignedOrder(input: BuildOrderInput): Omit<PolymarketOrderArtifact, 'signature'> {
  const sideEnum: 0 | 1 = input.side === 'BUY' ? 0 : 1;

  // BUY: makerAmount = USDC paid, takerAmount = shares received. SELL flips.
  const sharesNum = parseUnits(input.shares, 6);
  const usdcNum = (sharesNum * BigInt(input.priceBps)) / 10_000n;

  const makerAmount = sideEnum === 0 ? usdcNum : sharesNum;
  const takerAmount = sideEnum === 0 ? sharesNum : usdcNum;

  return {
    salt: input.salt,
    maker: input.maker,
    signer: input.maker,
    taker: '0x0000000000000000000000000000000000000000',
    tokenId: input.tokenId,
    makerAmount: makerAmount.toString(),
    takerAmount: takerAmount.toString(),
    expiration: String(input.expiration ?? 0),
    nonce: input.nonce ?? '0',
    feeRateBps: String(input.feeRateBps ?? 0),
    side: sideEnum,
    signatureType: 0,
  };
}

export function randomSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return BigInt(toHex(bytes)).toString();
}

export function clientOrderIdFromSalt(salt: string, maker: `0x${string}`): string {
  return keccak256(toHex(`${maker}-${salt}`));
}

export async function signOrder(
  sessionPrivateKey: Hex,
  unsigned: Omit<PolymarketOrderArtifact, 'signature'>,
  opts: { negRisk?: boolean } = {},
): Promise<PolymarketOrderArtifact> {
  const account = privateKeyToAccount(sessionPrivateKey);
  const addrs = getPolymarketAddresses(POLYMARKET_CHAIN_ID);
  const verifyingContract = opts.negRisk ? addrs.negRiskExchange : addrs.ctfExchange;
  const signature = await account.signTypedData({
    domain: buildDomain(verifyingContract),
    types: ORDER_TYPES,
    primaryType: 'Order',
    message: {
      salt: BigInt(unsigned.salt),
      maker: unsigned.maker,
      signer: unsigned.signer,
      taker: unsigned.taker,
      tokenId: BigInt(unsigned.tokenId),
      makerAmount: BigInt(unsigned.makerAmount),
      takerAmount: BigInt(unsigned.takerAmount),
      expiration: BigInt(unsigned.expiration),
      nonce: BigInt(unsigned.nonce),
      feeRateBps: BigInt(unsigned.feeRateBps),
      side: unsigned.side,
      signatureType: unsigned.signatureType,
    },
  });
  return { ...unsigned, signature };
}

export function applySlippage(priceBps: number, slippageBps: number, side: OrderSide): number {
  if (side === 'SELL') return Math.max(1, priceBps - slippageBps);
  return Math.min(9999, priceBps + slippageBps);
}

export function sharesForStake(stakeUsdc: string, priceBps: number): string {
  const stake = parseUnits(stakeUsdc, 6);
  if (priceBps <= 0) throw new Error('priceBps must be positive');
  const shares = (stake * 10_000n) / BigInt(priceBps);
  // Format as 6-decimal string.
  const whole = shares / 1_000_000n;
  const frac = shares % 1_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

const CLOB_AUTH_TYPES = {
  ClobAuth: [
    { name: 'address', type: 'address' },
    { name: 'timestamp', type: 'string' },
    { name: 'nonce', type: 'uint256' },
    { name: 'message', type: 'string' },
  ],
} as const;

const CLOB_AUTH_DOMAIN = {
  name: 'ClobAuthDomain',
  version: '1',
  chainId: POLYMARKET_CHAIN_ID,
} as const;

const CLOB_AUTH_MESSAGE = 'This message attests that I control the given wallet';

export interface ClobAuthSignature {
  signer: `0x${string}`;
  timestamp: string;
  nonce: string;
  signature: `0x${string}`;
}

export async function signClobAuth(
  sessionPrivateKey: Hex,
  nonce = '0',
): Promise<ClobAuthSignature> {
  const account = privateKeyToAccount(sessionPrivateKey);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await account.signTypedData({
    domain: CLOB_AUTH_DOMAIN,
    types: CLOB_AUTH_TYPES,
    primaryType: 'ClobAuth',
    message: {
      address: account.address,
      timestamp,
      nonce: BigInt(nonce),
      message: CLOB_AUTH_MESSAGE,
    },
  });
  return { signer: account.address, timestamp, nonce, signature };
}

export async function deriveClobApiKey(
  apiBase: string,
  auth: ClobAuthSignature,
): Promise<{ apiKey: string; secret: string; passphrase: string }> {
  const r = await fetch(`${apiBase}/auth/api-key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      POLY_ADDRESS: auth.signer,
      POLY_SIGNATURE: auth.signature,
      POLY_TIMESTAMP: auth.timestamp,
      POLY_NONCE: auth.nonce,
    },
  });
  if (!r.ok) throw new Error(`clob /auth/api-key → ${r.status}`);
  return r.json() as Promise<{ apiKey: string; secret: string; passphrase: string }>;
}
