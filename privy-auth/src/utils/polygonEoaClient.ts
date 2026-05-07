import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import type { Hex } from 'viem';
import { getPolymarketAddresses, getRpcUrlById } from './chainConfig';
import { POLYMARKET_CHAIN_ID } from './polymarket';

export function getPolygonEoaClient(privateKey: Hex) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: polygon,
    transport: http(getRpcUrlById(POLYMARKET_CHAIN_ID)),
  });
}

const polygonPublicClient = (() => {
  let client: ReturnType<typeof createPublicClient> | null = null;
  return () => {
    if (!client) {
      client = createPublicClient({
        chain: polygon,
        transport: http(getRpcUrlById(POLYMARKET_CHAIN_ID)),
      });
    }
    return client;
  };
})();

export async function sendEoaTx(
  privateKey: Hex,
  to: `0x${string}`,
  data: `0x${string}`,
  value: bigint = 0n,
): Promise<`0x${string}`> {
  return getPolygonEoaClient(privateKey).sendTransaction({ to, data, value });
}

export async function readPolygonUsdcBalance(addr: `0x${string}`): Promise<bigint> {
  const addrs = getPolymarketAddresses(POLYMARKET_CHAIN_ID);
  return polygonPublicClient().readContract({
    address: addrs.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [addr],
  }) as Promise<bigint>;
}

export async function sweepUsdcToSca(
  privateKey: Hex,
  scaAddress: `0x${string}`,
): Promise<`0x${string}` | null> {
  const account = privateKeyToAccount(privateKey);
  const balance = await readPolygonUsdcBalance(account.address);
  if (balance === 0n) return null;
  const addrs = getPolymarketAddresses(POLYMARKET_CHAIN_ID);
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [scaAddress, balance],
  });
  return sendEoaTx(privateKey, addrs.usdc, data);
}
