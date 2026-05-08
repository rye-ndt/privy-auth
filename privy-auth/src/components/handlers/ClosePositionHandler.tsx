import React from 'react';
import { FullScreen, FullScreenError } from '../atomics/FullScreen';
import { Spinner } from '../atomics/spinner';
import { ShieldIcon } from '../atomics/icons';
import { createLogger } from '../../utils/logger';
import { toErrorMessage } from '../../utils/toErrorMessage';
import { pmApi } from '../../utils/predictionMarketApi';
import { newRandomId } from '../../utils/randomId';
import { loadSessionEoa } from '../../utils/sessionEoa';
import { sweepUsdcToSca } from '../../utils/polygonEoaClient';
import { pollUntil } from '../../utils/sleep';
import {
  applySlippage,
  buildUnsignedOrder,
  randomSalt,
  signOrder,
} from '../../utils/polymarket';
import type { PositionRow } from '../../types/predictionMarket.types';
import {
  CLOSE_DELAY_MS,
  FILL_TIMEOUT_MS,
  ORDER_SLIPPAGE_BPS,
  POLL_INTERVAL_MS,
} from './predictionMarketConstants';

const log = createLogger('closePositionHandler');

interface Props {
  positionId: string;
  privyToken: string;
  privyDid: string;
  backendUrl: string;
  scaAddress: `0x${string}`;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'executing'; detail: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export function ClosePositionHandler(props: Props) {
  const { positionId, privyToken, privyDid, backendUrl, scaAddress } = props;
  const ctx = React.useMemo(() => ({ backendUrl, privyToken }), [backendUrl, privyToken]);
  const [phase, setPhase] = React.useState<Phase>({ kind: 'loading' });
  const startedRef = React.useRef(false);

  const setPhaseUnique = React.useCallback((next: Phase) => {
    setPhase((prev) => (samePhase(prev, next) ? prev : next));
  }, []);

  React.useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        log.info('step', { step: 'started', positionId });
        const positions = await pmApi.positions(ctx);
        const pos = positions.find((p) => p.id === positionId);
        if (!pos) throw new Error("Couldn't find this position.");
        if (pos.status !== 'open' && pos.status !== 'closing') {
          throw new Error(`This position is ${pos.status} and can't be closed.`);
        }
        await runClose(pos);
      } catch (err) {
        const msg = toErrorMessage(err);
        log.error('close-position-failed', { positionId, err: msg });
        setPhaseUnique({ kind: 'error', message: msg });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionId]);

  const runClose = async (pos: PositionRow) => {
    setPhaseUnique({ kind: 'executing', detail: 'Getting price…' });
    const ob = await pmApi.orderbook(ctx, pos.outcomeTokenId);
    const limitPriceBps = applySlippage(ob.bestBidBps, ORDER_SLIPPAGE_BPS, 'SELL');

    setPhaseUnique({ kind: 'executing', detail: 'Placing your sell…' });
    const eoa = await loadSessionEoa(privyDid);
    const order = await signOrder(
      eoa.privateKey,
      buildUnsignedOrder({
        maker: eoa.address,
        tokenId: pos.outcomeTokenId,
        priceBps: limitPriceBps,
        shares: pos.sizeShares,
        side: 'SELL',
        salt: randomSalt(),
      }),
    );
    log.info('step', { step: 'order-signed', positionId, side: 'SELL' });

    // BE issues the canonical close `betId` via initiateClose during the
    // chat-side confirm step; the FE doesn't synthesize it. `clientOrderId`
    // is the FE-generated idempotency key for the Polymarket POST.
    const clientOrderId = newRandomId();
    const placed = await pmApi.sellOrder(ctx, {
      positionId: pos.id,
      closingBetId: '',
      clientOrderId,
      order,
      livePriceBps: ob.bestBidBps,
    });
    log.info('step', { step: 'submitted', positionId, clientOrderId, polymarketOrderId: placed.polymarketOrderId });

    setPhaseUnique({ kind: 'executing', detail: 'Waiting for confirmation…' });
    if (!await pollUntilClosed(pos.id)) {
      log.warn('close-not-filled', { positionId });
      await pmApi.finalizePosition(ctx, pos.id, { status: 'failed' });
      throw new Error("Your sell didn't go through in time. Please try again.");
    }

    setPhaseUnique({ kind: 'executing', detail: 'Returning money to your wallet…' });
    await sweepUsdcToSca(eoa.privateKey, scaAddress);

    await pmApi.finalizePosition(ctx, pos.id, { status: 'closed' });
    log.info('step', { step: 'closed', positionId });
    setPhaseUnique({ kind: 'done' });
    setTimeout(() => window.Telegram?.WebApp?.close(), CLOSE_DELAY_MS);
  };

  const pollUntilClosed = async (posId: string): Promise<boolean> => {
    // `resolved` is settlement mid-close; absent means the reconciler already
    // marked it closed — both count as success.
    const result = await pollUntil(
      () => pmApi.positions(ctx),
      (list) => {
        const found = list.find((p) => p.id === posId);
        return !found || found.status === 'closed' || found.status === 'resolved';
      },
      { intervalMs: POLL_INTERVAL_MS, timeoutMs: FILL_TIMEOUT_MS },
    );
    return result !== null;
  };

  if (phase.kind === 'error') return <FullScreenError message={phase.message} showClose />;
  if (phase.kind === 'done') {
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-4">
          <ShieldIcon size={48} variant="success" />
          <p className="text-white font-semibold">Position closed</p>
        </div>
      </FullScreen>
    );
  }
  const label = phase.kind === 'loading' ? 'Loading…' : phase.detail;
  return (
    <FullScreen>
      <div className="flex flex-col items-center gap-5 max-w-sm text-center">
        <ShieldIcon size={64} variant="violet" />
        <p className="text-white font-semibold text-lg">Closing position</p>
        <div className="flex items-center gap-2 text-xs text-white/60">
          <Spinner size="xs" />
          <span>{label}</span>
        </div>
      </div>
    </FullScreen>
  );
}

function samePhase(a: Phase, b: Phase): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'executing' && b.kind === 'executing') return a.detail === b.detail;
  if (a.kind === 'error' && b.kind === 'error') return a.message === b.message;
  return true;
}
