import type { TransferRecord } from '../../types/transferHistory.types';
import { buildExplorerUrl } from '../../utils/chainConfig';

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

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr || '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const DIRECTION_STYLE: Record<TransferRecord['direction'], { glyph: string; tone: string; sign: string }> = {
  in:   { glyph: '↙', tone: 'text-emerald-400', sign: '+' },
  out:  { glyph: '↗', tone: 'text-rose-400',    sign: '-' },
  self: { glyph: '↺', tone: 'text-white/40',    sign: ''  },
};

export function TransferRow({ t }: { t: TransferRecord }) {
  const style = DIRECTION_STYLE[t.direction];
  const counterparty = t.direction === 'in' ? t.from : t.to;
  const explorerUrl = buildExplorerUrl(t.chainId, t.txHash);

  return (
    <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.07] rounded-xl px-4 py-3">
      <div className={`flex-shrink-0 w-8 h-8 rounded-full bg-white/[0.05] flex items-center justify-center text-base ${style.tone}`}>
        {style.glyph}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-xs font-semibold text-white/85 truncate">
            {t.direction === 'in' ? 'Received' : t.direction === 'out' ? 'Sent' : 'Self-transfer'} {t.tokenSymbol}
          </p>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-violet-400/60 hover:text-violet-400 transition-colors"
          >
            tx ↗
          </a>
        </div>
        <p className="text-[10px] text-white/30 mt-0.5 truncate">
          {t.direction === 'in' ? 'from' : 'to'} {truncateAddress(counterparty)} · {relativeTime(t.timestampEpoch)}
        </p>
      </div>

      <div className="flex flex-col items-end flex-shrink-0">
        <p className={`text-xs font-bold tabular-nums ${style.tone}`}>
          {style.sign}{t.amountFormatted} {t.tokenSymbol}
        </p>
        {t.usdValue != null && (
          <p className="text-[10px] text-white/30 tabular-nums mt-0.5">
            ${t.usdValue.toFixed(2)}
          </p>
        )}
      </div>
    </div>
  );
}
