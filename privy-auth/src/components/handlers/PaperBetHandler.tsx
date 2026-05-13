import React from 'react';
import { FullScreen, FullScreenError, FullScreenSuccess } from '../atomics/FullScreen';
import { Spinner } from '../atomics/spinner';
import { createLogger } from '../../utils/logger';
import { toErrorMessage } from '../../utils/toErrorMessage';
import { newRandomId } from '../../utils/randomId';
import { pmApi } from '../../utils/predictionMarketApi';
import type { PaperBet, PaperBetPreview, PaperBetSideSelector } from '../../types/predictionMarket.types';

const log = createLogger('paperBetHandler');

const AUTO_CLOSE_MS = 3000;

type Phase =
  | { kind: 'loading' }
  | { kind: 'amount'; preview: PaperBetPreview }
  | { kind: 'confirming'; preview: PaperBetPreview; stakeUsdcCents: number }
  | { kind: 'submitting'; preview: PaperBetPreview; stakeUsdcCents: number }
  | { kind: 'done'; bet: PaperBet }
  | { kind: 'error'; message: string };

interface Props {
  findingId: string;
  side: PaperBetSideSelector;
  privyToken: string;
  backendUrl: string;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function priceBpsToFraction(bps: number): string {
  return `${(bps / 100).toFixed(2)}¢`;
}

function calcShares(stakeUsdcCents: number, priceBps: number): bigint {
  if (priceBps <= 0) return 0n;
  return (BigInt(stakeUsdcCents) * 100n * 1_000_000n) / BigInt(priceBps);
}

function sharesE6ToDisplay(sharesE6: bigint): string {
  const whole = sharesE6 / 1_000_000n;
  const frac = (sharesE6 % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${whole.toString()}.${frac}`;
}

export function PaperBetHandler(props: Props) {
  const { findingId, side, privyToken, backendUrl } = props;
  const ctx = React.useMemo(() => ({ backendUrl, privyToken }), [backendUrl, privyToken]);
  const requestIdRef = React.useRef(newRandomId());
  const [phase, setPhase] = React.useState<Phase>({ kind: 'loading' });
  const [stakeInput, setStakeInput] = React.useState('');
  const loadedRef = React.useRef(false);

  React.useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const requestId = requestIdRef.current;
    log.info('step', { step: 'started', requestId, findingId, side });
    (async () => {
      try {
        const preview = await pmApi.paperBetPreview(ctx, { findingId, side });
        log.debug('preview', { findingId, side, priceBps: preview.priceBps });
        setStakeInput((preview.minStakeUsdcCents / 100).toFixed(2));
        setPhase({ kind: 'amount', preview });
      } catch (err) {
        const msg = toErrorMessage(err);
        log.error('preview failed', { requestId, err: msg });
        setPhase({ kind: 'error', message: msg });
      }
    })();
  }, [ctx, findingId, side]);

  React.useEffect(() => {
    if (phase.kind !== 'done') return;
    const t = setTimeout(() => {
      try { window.Telegram?.WebApp?.close(); } catch { /* ignore */ }
    }, AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [phase.kind]);

  const submit = React.useCallback(async (preview: PaperBetPreview, stakeUsdcCents: number) => {
    const requestId = requestIdRef.current;
    setPhase({ kind: 'submitting', preview, stakeUsdcCents });
    try {
      const { paperBet } = await pmApi.placePaperBet(ctx, {
        findingId: preview.findingId,
        side,
        stakeUsdcCents,
      });
      log.info('step', { step: 'succeeded', requestId, paperBetId: paperBet.id });
      setPhase({ kind: 'done', bet: paperBet });
    } catch (err) {
      const msg = toErrorMessage(err);
      log.error('paper-bet failed', { requestId, err: msg });
      setPhase({ kind: 'error', message: msg });
    }
  }, [ctx, side]);

  if (phase.kind === 'loading') {
    return (
      <FullScreen>
        <Spinner size="lg" />
        <p className="text-sm text-white/40">Loading market…</p>
      </FullScreen>
    );
  }
  if (phase.kind === 'error') return <FullScreenError message={phase.message} showClose />;
  if (phase.kind === 'done') {
    const sharesE6 = BigInt(phase.bet.sharesE6);
    return (
      <FullScreenSuccess
        title="Paper bet placed"
        subtitle={`${sharesE6ToDisplay(sharesE6)} shares @ ${priceBpsToFraction(phase.bet.entryPriceBps)} · we'll settle on resolution`}
      />
    );
  }

  const preview = phase.preview;

  if (phase.kind === 'amount') {
    const stakeCents = Math.round(Math.max(0, parseFloat(stakeInput) || 0) * 100);
    const stakeValid =
      stakeCents >= preview.minStakeUsdcCents && stakeCents <= preview.maxStakeUsdcCents;
    const sharesE6 = calcShares(stakeCents, preview.priceBps);
    const maxPayoffCents = Number(sharesE6 / 10_000n);
    return (
      <FullScreen>
        <div className="w-full max-w-sm flex flex-col gap-4 bg-[#161624] border border-white/10 rounded-2xl p-6">
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider">Side {side}</p>
            <p className="text-white font-semibold text-base mt-1">{preview.sideLabel}</p>
            <p className="text-xs text-white/50 mt-2">{preview.rationale}</p>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/60">Live price</span>
            <span className="text-white font-mono">{priceBpsToFraction(preview.priceBps)}</span>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">Stake (USDC)</span>
            <input
              type="number"
              inputMode="decimal"
              min={preview.minStakeUsdcCents / 100}
              max={preview.maxStakeUsdcCents / 100}
              step="0.01"
              value={stakeInput}
              onChange={(e) => setStakeInput(e.target.value)}
              className="bg-[#0f0f1a] border border-white/10 rounded-lg px-3 py-2 text-white font-mono"
            />
            <span className="text-[11px] text-white/30">
              min {formatCents(preview.minStakeUsdcCents)} · max {formatCents(preview.maxStakeUsdcCents)}
            </span>
          </label>
          <div className="text-xs text-white/50 flex flex-col gap-1">
            <div className="flex justify-between"><span>Implied shares</span><span className="font-mono text-white/70">{sharesE6ToDisplay(sharesE6)}</span></div>
            <div className="flex justify-between"><span>Max payoff</span><span className="font-mono text-emerald-400/80">{formatCents(maxPayoffCents)}</span></div>
            <div className="flex justify-between"><span>Max loss</span><span className="font-mono text-red-400/80">{formatCents(stakeCents)}</span></div>
          </div>
          <button
            disabled={!stakeValid}
            onClick={() => setPhase({ kind: 'confirming', preview, stakeUsdcCents: stakeCents })}
            className="bg-violet-600 disabled:bg-white/10 disabled:text-white/30 text-white font-semibold rounded-lg py-2.5 text-sm"
          >
            Continue
          </button>
        </div>
      </FullScreen>
    );
  }

  const submitting = phase.kind === 'submitting';
  const confirmShares = calcShares(phase.stakeUsdcCents, preview.priceBps);
  return (
    <FullScreen>
      <div className="w-full max-w-sm flex flex-col gap-4 bg-[#161624] border border-white/10 rounded-2xl p-6">
        <p className="text-white font-semibold">Confirm paper bet</p>
        <p className="text-xs text-white/50">{preview.sideLabel}</p>
        <div className="text-sm flex flex-col gap-1.5">
          <div className="flex justify-between"><span className="text-white/60">Stake</span><span className="font-mono text-white">{formatCents(phase.stakeUsdcCents)}</span></div>
          <div className="flex justify-between"><span className="text-white/60">Entry price</span><span className="font-mono text-white">{priceBpsToFraction(preview.priceBps)}</span></div>
          <div className="flex justify-between"><span className="text-white/60">Shares</span><span className="font-mono text-white">{sharesE6ToDisplay(confirmShares)}</span></div>
          <div className="flex justify-between"><span className="text-white/60">Max payoff</span><span className="font-mono text-emerald-400/80">{formatCents(Number(confirmShares / 10_000n))}</span></div>
        </div>
        <div className="flex gap-2">
          <button
            disabled={submitting}
            onClick={() => setPhase({ kind: 'amount', preview })}
            className="flex-1 bg-white/5 text-white/70 rounded-lg py-2.5 text-sm disabled:opacity-40"
          >
            Back
          </button>
          <button
            disabled={submitting}
            onClick={() => submit(preview, phase.stakeUsdcCents)}
            className="flex-1 bg-violet-600 text-white font-semibold rounded-lg py-2.5 text-sm disabled:opacity-60"
          >
            {submitting ? <Spinner size="xs" /> : 'Confirm'}
          </button>
        </div>
      </div>
    </FullScreen>
  );
}
