import { useLoyaltyBalance, useLoyaltyHistory, useLoyaltyLeaderboard } from '../hooks/useLoyalty';
import type { LedgerEntry } from '../hooks/useLoyalty';

const HISTORY_PAGE_SIZE = 10;

const ACTION_LABELS: Record<string, string> = {
  swap_same_chain: 'Swap',
  swap_cross_chain: 'Cross-network swap',
  send_erc20: 'Send',
  yield_deposit: 'Yield deposit',
  yield_hold_day: 'Yield holding',
  referral: 'Referral',
  manual_adjust: 'Adjustment',
};

function humaniseAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function relativeTime(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return '';
  const diff = Math.floor(Date.now() / 1000 - epochSeconds);
  if (diff < 0) return 'just now';
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return 'yesterday';
  return `${Math.floor(diff / 86400)}d ago`;
}

export function PointsTab() {
  const balance = useLoyaltyBalance();
  const history = useLoyaltyHistory(HISTORY_PAGE_SIZE);
  const leaderboard = useLoyaltyLeaderboard(10);

  const userScopedUnauthorized = balance.unauthorized || history.unauthorized;

  const isEmpty =
    !balance.loading &&
    !balance.error &&
    balance.data?.pointsTotal === '0' &&
    (history.data == null || history.data.length === 0);

  return (
    <div className="flex flex-col gap-6 px-4 pt-10 pb-28">
      {!userScopedUnauthorized && (
        <>
          <BalanceCard
            data={balance.data}
            loading={balance.loading}
            error={balance.error}
          />
          {isEmpty ? (
            <EmptyState />
          ) : (
            <ActivitySection
              data={history.data}
              loading={history.loading}
              error={history.error}
              hasMore={history.hasMore}
              loadMore={history.loadMore}
            />
          )}
        </>
      )}

      <LeaderboardSection
        data={leaderboard.data}
        loading={leaderboard.loading}
        error={leaderboard.error}
      />
    </div>
  );
}

function BalanceCard({
  data,
  loading,
  error,
}: {
  data: { seasonId: string; pointsTotal: string; rank: number | null } | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="w-full bg-[#161624] border border-white/[0.08] rounded-2xl px-5 py-5">
      <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase mb-3">
        Points
      </p>

      {loading && (
        <div className="flex flex-col gap-2">
          <div className="h-9 w-36 bg-white/[0.06] rounded-lg animate-pulse" />
          <div className="h-4 w-24 bg-white/[0.04] rounded animate-pulse" />
        </div>
      )}

      {!loading && error && (
        <p className="text-xs text-white/30">{error}</p>
      )}

      {!loading && !error && data && (
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-3xl font-bold text-white tabular-nums tracking-tight">
              {data.pointsTotal}
            </p>
            <p className="text-[11px] text-white/35 mt-1">Season {data.seasonId}</p>
          </div>
          <div
            className={`flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-bold ${
              data.rank != null
                ? 'bg-violet-500/15 border border-violet-500/25 text-violet-300'
                : 'bg-white/[0.05] border border-white/10 text-white/30'
            }`}
          >
            {data.rank != null ? `#${data.rank}` : 'Unranked'}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-20 bg-white/[0.03] border border-white/[0.05] rounded-xl">
      <p className="text-xs text-white/30 text-center px-4">
        No points yet. Swap, send, or deposit to earn.
      </p>
    </div>
  );
}

function ActivitySection({
  data,
  loading,
  error,
  hasMore,
  loadMore,
}: {
  data: LedgerEntry[] | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
}) {
  return (
    <div className="w-full">
      <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase mb-3">
        Recent Activity
      </p>

      {loading && data == null && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 bg-white/[0.04] border border-white/[0.05] rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && data == null && (
        <p className="text-xs text-white/30 px-1">{error}</p>
      )}

      {data != null && data.length > 0 && (
        <div className="flex flex-col gap-2">
          {data.map((entry, i) => (
            <LedgerRow key={`${entry.createdAtEpoch}-${i}`} entry={entry} />
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

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  return (
    <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.07] rounded-xl px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white/80 truncate">
          {humaniseAction(entry.actionType)}
        </p>
        <p className="text-[10px] text-white/30 mt-0.5">{relativeTime(entry.createdAtEpoch)}</p>
      </div>
      <p className="text-xs font-bold text-violet-400 tabular-nums flex-shrink-0">
        +{entry.points}
      </p>
    </div>
  );
}

function LeaderboardSection({
  data,
  loading,
  error,
}: {
  data: { entries: { rank: number; pointsTotal: string }[]; seasonId: string } | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="w-full">
      <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase mb-3">
        Leaderboard
      </p>

      {loading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 bg-white/[0.04] border border-white/[0.05] rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && (
        <p className="text-xs text-white/30 px-1">{error}</p>
      )}

      {!loading && !error && data && data.entries.length === 0 && (
        <div className="flex items-center justify-center h-16 bg-white/[0.03] border border-white/[0.05] rounded-xl">
          <p className="text-xs text-white/25">No entries yet</p>
        </div>
      )}

      {!loading && !error && data && data.entries.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3 px-4 pb-1">
            <p className="text-[9px] font-semibold tracking-widest text-white/20 uppercase w-8">Rank</p>
            <p className="text-[9px] font-semibold tracking-widest text-white/20 uppercase flex-1">Points</p>
          </div>
          {data.entries.map((entry) => (
            <LeaderboardRow key={entry.rank} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function LeaderboardRow({ entry }: { entry: { rank: number; pointsTotal: string } }) {
  const isTop3 = entry.rank <= 3;
  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-4 py-2.5 border ${
        isTop3
          ? 'bg-violet-500/[0.07] border-violet-500/20'
          : 'bg-white/[0.03] border-white/[0.06]'
      }`}
    >
      <p
        className={`text-xs font-bold w-8 tabular-nums flex-shrink-0 ${
          isTop3 ? 'text-violet-300' : 'text-white/40'
        }`}
      >
        #{entry.rank}
      </p>
      <p className="text-xs text-white/70 tabular-nums flex-1">{entry.pointsTotal}</p>
    </div>
  );
}
