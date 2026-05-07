import React from 'react';
import { resilientFetch } from '../utils/resilientFetch';
import { createLogger } from '../utils/logger';
import { newRandomId as newRequestId } from '../utils/randomId';
import { useAppConfig } from './useAppData';
import type {
  TransferDirection,
  TransferRecord,
  TransferHistoryPage,
} from '../types/transferHistory.types';

const log = createLogger('useTransferHistory');

export type UseTransferHistoryArgs = {
  direction?: TransferDirection;
  limit?: number;
};

export type UseTransferHistoryReturn = {
  entries: TransferRecord[] | null;
  loading: boolean;
  error: string | null;
  rateLimited: boolean;
  unauthorized: boolean;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
};

function parsePage(body: unknown): TransferHistoryPage {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = (b.items ?? []) as Array<Record<string, unknown>>;
  const items: TransferRecord[] = raw.map((e) => ({
    chainId: Number(e.chainId ?? 0),
    txHash: String(e.txHash ?? '') as `0x${string}`,
    logIndex: e.logIndex == null ? null : Number(e.logIndex),
    blockNumber: Number(e.blockNumber ?? 0),
    timestampEpoch: Number(e.timestampEpoch ?? 0),
    direction: (e.direction ?? 'out') as TransferDirection,
    from: String(e.from ?? '') as `0x${string}`,
    to: String(e.to ?? '') as `0x${string}`,
    tokenAddress: String(e.tokenAddress ?? '') as `0x${string}`,
    tokenSymbol: String(e.tokenSymbol ?? ''),
    tokenDecimals: Number(e.tokenDecimals ?? 0),
    isNative: Boolean(e.isNative),
    amountRaw: String(e.amountRaw ?? '0'),
    amountFormatted: String(e.amountFormatted ?? '0'),
    usdValue: e.usdValue == null ? null : Number(e.usdValue),
  }));
  const nextCursor = b.nextCursor == null ? null : String(b.nextCursor);
  return { items, nextCursor };
}

export function useTransferHistory(args: UseTransferHistoryArgs = {}): UseTransferHistoryReturn {
  const { direction, limit = 25 } = args;
  const { backendUrl, privyToken } = useAppConfig();

  const [entries, setEntries] = React.useState<TransferRecord[] | null>(null);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [rateLimited, setRateLimited] = React.useState(false);
  const [unauthorized, setUnauthorized] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [resetTick, setResetTick] = React.useState(0);
  const cursorRef = React.useRef<string | null>(null);
  React.useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  // Reset to page 0 when the direction filter changes.
  React.useEffect(() => {
    setEntries(null);
    setCursor(null);
    setPage(0);
    setError(null);
    setRateLimited(false);
    setUnauthorized(false);
  }, [direction]);

  React.useEffect(() => {
    if (!backendUrl || !privyToken) return;
    let cancelled = false;
    const requestId = newRequestId();

    setLoading(true);
    if (page === 0) {
      setError(null);
      setRateLimited(false);
      setUnauthorized(false);
    }

    const url = new URL(`${backendUrl}/transfers`);
    url.searchParams.set('limit', String(limit));
    if (direction) url.searchParams.set('direction', direction);
    if (page > 0 && cursorRef.current != null) {
      url.searchParams.set('cursor', cursorRef.current);
    }

    log.debug(`→ GET /transfers`, { requestId, page, direction, cursor: cursorRef.current });

    resilientFetch(url.toString(), {
      headers: { Authorization: `Bearer ${privyToken}` },
    })
      .then(async (r) => {
        log.debug(`← GET /transfers`, { requestId, status: r.status });
        if (r.status === 401) {
          if (!cancelled) setUnauthorized(true);
          throw new Error('unauthorized');
        }
        if (r.status === 429) {
          if (!cancelled) setRateLimited(true);
          log.warn('rate-limited', { requestId });
          return null;
        }
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as unknown;
      })
      .then((body) => {
        if (cancelled || body == null) return;
        const { items, nextCursor } = parsePage(body);
        setEntries((prev) => (page === 0 ? items : [...(prev ?? []), ...items]));
        setCursor(nextCursor);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof Error && err.message === 'unauthorized') return;
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        log.error('load-failed', { requestId, err: msg });
        setError("Couldn't load activity");
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [backendUrl, privyToken, limit, direction, page, resetTick]);

  const loadMore = React.useCallback(() => {
    if (cursor != null) setPage((n) => n + 1);
  }, [cursor]);

  const refresh = React.useCallback(() => {
    setEntries(null);
    setCursor(null);
    setPage(0);
    setError(null);
    setRateLimited(false);
    setResetTick((n) => n + 1);
  }, []);

  return {
    entries,
    loading,
    error,
    rateLimited,
    unauthorized,
    hasMore: cursor != null,
    loadMore,
    refresh,
  };
}
