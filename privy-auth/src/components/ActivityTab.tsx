import React from 'react';
import { useTransferHistory } from '../hooks/useTransferHistory';
import { DirectionFilter } from './activity/DirectionFilter';
import { TransferRow } from './activity/TransferRow';
import type { TransferDirection } from '../types/transferHistory.types';

const PAGE_SIZE = 25;

export function ActivityTab() {
  const [direction, setDirection] = React.useState<TransferDirection | undefined>(undefined);
  const { entries, loading, error, rateLimited, unauthorized, hasMore, loadMore, refresh } =
    useTransferHistory({ direction, limit: PAGE_SIZE });

  return (
    <div className="flex flex-col gap-6 px-4 pt-10 pb-28">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">
          Activity
        </p>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-[11px] text-violet-400/70 hover:text-violet-400 transition-colors disabled:opacity-40"
        >
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      <DirectionFilter value={direction} onChange={setDirection} />

      {rateLimited && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3">
          <p className="text-xs text-amber-300/90">Too many requests — try again in a minute.</p>
        </div>
      )}

      {error && !rateLimited && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.07] px-4 py-3">
          <p className="text-xs text-rose-300/90">{error}</p>
          <button
            onClick={refresh}
            className="text-[11px] font-bold text-rose-300 hover:text-rose-200 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {unauthorized && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <p className="text-xs text-white/40">Session expired. Please reauthenticate.</p>
        </div>
      )}

      {loading && entries == null && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-14 bg-white/[0.04] border border-white/[0.05] rounded-xl animate-pulse"
            />
          ))}
        </div>
      )}

      {entries != null && entries.length === 0 && !loading && !error && !rateLimited && (
        <div className="flex items-center justify-center h-24 bg-white/[0.03] border border-white/[0.05] rounded-xl">
          <p className="text-xs text-white/30 text-center px-4">
            No activity yet — your sends and receives will appear here.
          </p>
        </div>
      )}

      {entries != null && entries.length > 0 && (
        <div className="flex flex-col gap-2">
          {entries.map((t) => (
            <TransferRow key={`${t.txHash}-${t.logIndex ?? 'native'}`} t={t} />
          ))}
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loading}
              className="mt-1 text-[11px] text-violet-400/70 hover:text-violet-400 transition-colors py-2 text-center disabled:opacity-40"
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
