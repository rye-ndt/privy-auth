import type { Hex } from 'viem';
import { decryptBlob } from './crypto';
import { cloudStorageGetItem } from './telegramStorage';

const STORAGE_KEY = 'delegated_key';

export interface SessionEoa {
  privateKey: Hex;
  address: `0x${string}`;
  blobs: Record<number, string>;
}

interface CacheEntry {
  privyDid: string;
  value: SessionEoa;
}

let cache: CacheEntry | null = null;

export async function loadSessionEoa(privyDid: string): Promise<SessionEoa> {
  if (cache && cache.privyDid === privyDid) return cache.value;
  const encrypted = await cloudStorageGetItem(STORAGE_KEY);
  if (!encrypted) throw new Error('Session key not found in cloud storage');
  const decrypted = await decryptBlob(encrypted, privyDid);
  const wrapper = JSON.parse(decrypted) as {
    privateKey?: string;
    address?: string;
    blobs?: Record<string, string>;
    blob?: string;
  };
  if (!wrapper.privateKey || !wrapper.address) {
    throw new Error('Session key blob missing privateKey/address');
  }
  const blobs: Record<number, string> = {};
  if (wrapper.blobs) {
    for (const [k, v] of Object.entries(wrapper.blobs)) {
      const cid = Number(k);
      if (Number.isFinite(cid) && typeof v === 'string') blobs[cid] = v;
    }
  }
  const value: SessionEoa = {
    privateKey: wrapper.privateKey as Hex,
    address: wrapper.address as `0x${string}`,
    blobs,
  };
  cache = { privyDid, value };
  return value;
}

export function getKernelBlob(eoa: SessionEoa, chainId: number): string {
  const blob = eoa.blobs[chainId];
  if (!blob) throw new Error(`No session blob for chain ${chainId}`);
  return blob;
}

export function clearSessionEoaCache(): void {
  cache = null;
}
