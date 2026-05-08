import React from 'react';
import { usePrivy } from '@privy-io/react-auth';
import type { DelegationState } from '../hooks/useDelegatedKey';
import { usePortfolio, useUserProfile, type PortfolioToken } from '../hooks/useAppData';
import { useNotifications, type NotificationItem } from '../hooks/useNotifications';
import { ShieldIcon } from './atomics/icons';
import { Spinner } from './atomics/spinner';
import { YieldPositions } from './YieldPositions';
import { buildExplorerUrl, chainName } from '../utils/chainConfig';
import { createLogger } from '../utils/logger';

const log = createLogger('homeTab');

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

export function HomeTab({ delegationState }: { delegationState: DelegationState }) {
  const { authenticated, user } = usePrivy();
  const { data: tokens, loading, error } = usePortfolio();
  const { data: profileData } = useUserProfile();
  const notifications = useNotifications();

  const totalUsd = tokens?.reduce((sum, t) => sum + (parseFloat(String(t.usdValue ?? 0)) || 0), 0) ?? 0;

  const pendingFlushed = profileData?.pendingFlushed ?? 0;
  const [bannerDismissed, setBannerDismissed] = React.useState(false);
  const showBanner = pendingFlushed > 0 && !bannerDismissed;

  React.useEffect(() => {
    if (showBanner) {
      log.info('welcome-flush-shown', { pendingFlushed });
    }
  }, [showBanner, pendingFlushed]);

  return (
    <div className="flex flex-col items-center gap-6 px-4 pt-10 pb-28">
      <div className="relative mt-2">
        <div className="absolute inset-0 rounded-3xl bg-violet-500/25 blur-3xl scale-[2.2]" />
        <div className="relative flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-600/20 to-indigo-600/20 border border-violet-500/20">
          <ShieldIcon size={36} />
        </div>
      </div>

      <div className="text-center -mt-1">
        <h1 className="text-2xl font-bold text-white tracking-tight">Aegis</h1>
        <p className="text-xs text-white/25 mt-0.5 tracking-wide">Your AI trading bot</p>
      </div>

      <AuthBadge authenticated={authenticated} email={user?.google?.email} />

      {showBanner && (
        <div className="w-full flex items-start gap-3 bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-3">
          <span className="text-base leading-none mt-0.5">👋</span>
          <p className="flex-1 text-xs text-violet-300">
            You've received {pendingFlushed} transfer{pendingFlushed !== 1 ? 's' : ''} while you were away.
          </p>
          <button
            onClick={() => setBannerDismissed(true)}
            className="text-[10px] text-violet-400/50 hover:text-violet-400 flex-shrink-0 mt-0.5"
          >
            ✕
          </button>
        </div>
      )}

      <PortfolioSection
        tokens={tokens}
        loading={loading}
        error={error}
        totalUsd={totalUsd}
      />

      <YieldPositions />

      <RecentTransfers
        items={notifications.items}
        loading={notifications.loading}
        error={notifications.error}
      />

      {delegationState.status === 'processing' && (
        <div className="w-full flex items-center gap-3 bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-3">
          <Spinner size="sm" className="border-violet-400/30 border-t-violet-400" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-violet-300">Setting up your bot</p>
            <p className="text-[11px] text-violet-400/60 truncate mt-0.5">{delegationState.step}</p>
          </div>
        </div>
      )}

      {delegationState.status === 'error' && (
        <div className="w-full flex items-center gap-3 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3">
          <div className="w-4 h-4 flex-shrink-0 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center">
            <span className="text-red-400 text-[9px] font-bold leading-none">!</span>
          </div>
          <p className="text-xs text-red-400/80 flex-1 min-w-0 truncate">{delegationState.message}</p>
        </div>
      )}
    </div>
  );
}

function AuthBadge({ authenticated, email }: { authenticated: boolean; email?: string }) {
  return (
    <div className={`flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-semibold ${
      authenticated
        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
        : 'bg-red-500/10 border-red-500/20 text-red-400'
    }`}>
      <div className={`w-1.5 h-1.5 rounded-full ${authenticated ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-red-400'}`} />
      {authenticated ? 'Signed in' : 'Not signed in'}
      {authenticated && email && <span className="text-white/30 font-normal">· {email}</span>}
    </div>
  );
}

function PortfolioSection({
  tokens, loading, error, totalUsd,
}: {
  tokens: PortfolioToken[] | null;
  loading: boolean;
  error: string | null;
  totalUsd: number;
}) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3 px-0.5">
        <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">Portfolio</p>
        {!loading && !error && tokens != null && (
          <p className="text-[11px] text-white/40">≈ ${totalUsd.toFixed(2)}</p>
        )}
      </div>

      {loading && (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 bg-white/[0.04] border border-white/[0.05] rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && <PortfolioEmpty label={error} />}
      {!loading && !error && tokens?.length === 0 && <PortfolioEmpty label="No tokens found" />}

      {!loading && !error && tokens && tokens.length > 0 && (
        <div className="flex flex-col gap-2">
          {tokens.map((t, i) => <TokenRow key={i} token={t} />)}
        </div>
      )}
    </div>
  );
}

function PortfolioEmpty({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-20 bg-white/[0.03] border border-white/[0.05] rounded-xl">
      <p className="text-xs text-white/25">{label}</p>
    </div>
  );
}

function TokenRow({ token }: { token: PortfolioToken }) {
  const symbol = token.symbol ?? '—';
  const bal = parseFloat(String(token.balance ?? '0'));
  const usd = token.usdValue != null ? parseFloat(String(token.usdValue)) : null;
  const initials = symbol.replace(/[^A-Z0-9]/gi, '').slice(0, 3).toUpperCase();

  return (
    <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.07] rounded-xl px-4 py-3">
      <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/15 flex items-center justify-center flex-shrink-0">
        <span className="text-[9px] font-bold text-violet-400 tracking-tight">{initials}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white/90">{symbol}</p>
        {token.name && <p className="text-[10px] text-white/30 truncate">{token.name}</p>}
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs text-white/70 font-mono">{isNaN(bal) ? '—' : bal.toFixed(4)}</p>
        {usd != null && <p className="text-[10px] text-white/30 mt-0.5">${usd.toFixed(2)}</p>}
      </div>
    </div>
  );
}

function RecentTransfers({
  items, loading, error,
}: {
  items: NotificationItem[];
  loading: boolean;
  error: string | null;
}) {
  if (!loading && !error && items.length === 0) return null;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3 px-0.5">
        <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">Recent Transfers</p>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-14 bg-white/[0.03] border border-white/[0.05] rounded-xl gap-2">
          <Spinner size="xs" />
          <p className="text-xs text-white/30">Loading transfers…</p>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center justify-center h-14 bg-white/[0.03] border border-white/[0.05] rounded-xl">
          <p className="text-xs text-white/25 text-center px-4">{error}</p>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((item) => <NotificationRow key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
}

const notifLog = createLogger('notificationRow');

function NotificationRow({ item }: { item: NotificationItem }) {
  const sender = item.senderHandle
    ? `@${item.senderHandle}`
    : (item.senderDisplayName ?? 'someone');
  const explorer = item.txHash ? buildExplorerUrl(item.chainId, item.txHash) : null;

  const onTap = () => {
    if (!explorer) return;
    notifLog.info('open-explorer', { id: item.id, chainId: item.chainId });
    window.open(explorer, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      onClick={onTap}
      disabled={!explorer}
      className="w-full flex items-center gap-3 bg-white/[0.04] border border-white/[0.07] rounded-xl px-4 py-3 text-left disabled:cursor-default"
    >
      <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center flex-shrink-0">
        <span className="text-base leading-none">💸</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white/90 truncate">
          {sender} → {item.amountFormatted} <span className="font-bold text-white">{item.tokenSymbol}</span>
        </p>
        <p className="text-[10px] text-white/30 mt-0.5">{chainName(item.chainId)}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[10px] text-white/30">{relativeTime(item.createdAtEpoch)}</p>
        {explorer && (
          <p className="text-[9px] text-violet-400/50 mt-0.5">
            {item.txHash?.slice(0, 6)}…{item.txHash?.slice(-4)}
          </p>
        )}
      </div>
    </button>
  );
}
