import React from 'react';
import { encodeFunctionData, erc20Abi, maxUint256, parseAbi, parseUnits } from 'viem';
import { FullScreen, FullScreenError } from '../atomics/FullScreen';
import { Spinner } from '../atomics/spinner';
import { ShieldIcon } from '../atomics/icons';
import { createLogger } from '../../utils/logger';
import { toErrorMessage } from '../../utils/toErrorMessage';
import { createSessionKeyClient } from '../../utils/crypto';
import { getPolymarketAddresses } from '../../utils/chainConfig';
import { pmApi, IllegalTransitionError, BetInFlightError } from '../../utils/predictionMarketApi';
import { getKernelBlob, loadSessionEoa, type SessionEoa } from '../../utils/sessionEoa';
import { sendEoaTx, sweepUsdcToSca } from '../../utils/polygonEoaClient';
import { pollUntil, waitForRef } from '../../utils/sleep';
import {
  POLYMARKET_CHAIN_ID,
  applySlippage,
  buildUnsignedOrder,
  deriveClobApiKey,
  randomSalt,
  sharesForStake,
  signClobAuth,
  signOrder,
} from '../../utils/polymarket';
import {
  TERMINAL_BET_STATUSES,
  type BetRow,
  type BetStatus,
  type IntentDetail,
  type PredictionMarketState,
  type SetupStep,
} from '../../types/predictionMarket.types';
import {
  BRIDGE_TIMEOUT_MS,
  CHAIN_INSTALL_TIMEOUT_MS,
  CLOB_API_BASE,
  CLOSE_DELAY_MS,
  DRIFT_BPS,
  FILL_TIMEOUT_MS,
  GAS_FUNDED_TIMEOUT_MS,
  ORDER_SLIPPAGE_BPS,
  POLL_INTERVAL_MS,
} from './predictionMarketConstants';

const log = createLogger('placeBetHandler');

const POST_GAS_SETUP_STEPS: ReadonlySet<SetupStep> = new Set(['gas_funded', 'approved', 'authed', 'complete']);

/** Sentinel posted to /bet/:id/refund when the EOA had no USDC to sweep —
 *  clears `refundRequired` BE-side without leaving the flag pending forever. */
const NO_RESIDUAL_TX_HASH = `0x${'0'.repeat(64)}`;

const CTF_ABI = parseAbi([
  'function setApprovalForAll(address operator, bool approved) external',
]);

interface Props {
  intentId: string;
  privyToken: string;
  privyDid: string;
  backendUrl: string;
  installedChainIds: number[];
  installOnChain: (chainId: number) => void;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'refunding' }
  | { kind: 'setup'; step: SetupStep; detail?: string }
  | { kind: 'executing'; status: BetStatus; detail?: string }
  | { kind: 'drift'; previousRefPriceBps: number; newRefPriceBps: number; driftBps: number }
  | { kind: 'in_flight' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export function PlaceBetHandler(props: Props) {
  const { intentId, privyToken, privyDid, backendUrl, installedChainIds, installOnChain } = props;
  const ctx = React.useMemo(() => ({ backendUrl, privyToken }), [backendUrl, privyToken]);
  const [phase, setPhase] = React.useState<Phase>({ kind: 'loading' });
  const startedRef = React.useRef(false);

  // Mirror the latest installedChainIds into a ref so the long-running async
  // state machine can observe post-install updates without re-running the
  // effect (which is gated by startedRef).
  const installedChainIdsRef = React.useRef(installedChainIds);
  React.useEffect(() => { installedChainIdsRef.current = installedChainIds; }, [installedChainIds]);

  const setPhaseUnique = React.useCallback((next: Phase) => {
    setPhase((prev) => (samePhase(prev, next) ? prev : next));
  }, []);

  React.useEffect(() => {
    if (startedRef.current) return;
    if (!installedChainIds.length) return;
    startedRef.current = true;

    (async () => {
      try {
        log.info('step', { step: 'started', intentId });
        const eoa = await loadSessionEoa(privyDid);
        const [intent, state] = await Promise.all([
          pmApi.intent(ctx, intentId),
          pmApi.state(ctx),
        ]);

        // Sweep any residual USDC stranded on the EOA from prior bets that
        // ended PARTIAL/UNFILLED/FAILED before this one — see BE finalizeBet.
        // Runs BEFORE setup/bet so we don't mix this bet's stake with
        // unaccounted USDC.
        await runRefunds(state, eoa);

        if (state.setup.setupStep !== 'complete') {
          await runSetup(state, intent, eoa);
        }
        await runBet(intent, eoa);
      } catch (err) {
        if (err instanceof BetInFlightError) {
          log.info('bet-in-flight', { intentId });
          setPhaseUnique({ kind: 'in_flight' });
          scheduleClose();
          return;
        }
        const msg = toErrorMessage(err);
        log.error('place-bet-failed', { intentId, err: msg });
        setPhaseUnique({ kind: 'error', message: msg });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installedChainIds.length > 0, intentId]);

  const runRefunds = async (state: PredictionMarketState, eoa: SessionEoa) => {
    const pending = state.inFlightBets.filter((b) => b.refundRequired && !b.refundTxHash);
    if (pending.length === 0) return;
    setPhaseUnique({ kind: 'refunding' });
    log.info('step', { step: 'refund-start', count: pending.length });
    for (const bet of pending) {
      const scaAddress = state.setup.polygonScaAddress;
      if (!scaAddress) {
        // Setup didn't reach sca_deployed yet — nothing to sweep into. The
        // BE flag survives until the next open after setup completes.
        log.warn('refund-no-sca', { betId: bet.id });
        continue;
      }
      const txHash = await sweepUsdcToSca(eoa.privateKey, scaAddress as `0x${string}`);
      if (!txHash) {
        log.info('step', { step: 'refund-skipped', betId: bet.id });
        await pmApi.recordRefund(ctx, bet.id, NO_RESIDUAL_TX_HASH);
        continue;
      }
      await pmApi.recordRefund(ctx, bet.id, txHash);
      log.info('step', { step: 'refund-recorded', betId: bet.id, txHash });
    }
  };

  const runSetup = async (state: PredictionMarketState, _intent: IntentDetail, eoa: SessionEoa) => {
    let step = state.setup.setupStep;
    while (step !== 'complete') {
      log.info('step', { step: `setup-${step}`, requestId: intentId });
      setPhaseUnique({ kind: 'setup', step });

      switch (step) {
        case 'pending': {
          if (!installedChainIdsRef.current.includes(POLYMARKET_CHAIN_ID)) {
            installOnChain(POLYMARKET_CHAIN_ID);
            const ok = await waitForRef(
              () => installedChainIdsRef.current.includes(POLYMARKET_CHAIN_ID),
              { intervalMs: 200, timeoutMs: CHAIN_INSTALL_TIMEOUT_MS },
            );
            if (!ok) throw new Error('Polygon session-key install timed out');
          }
          await pmApi.setupStep(ctx, 'sca_deployed', { eoaAddress: eoa.address });
          step = 'sca_deployed';
          break;
        }
        case 'sca_deployed': {
          setPhaseUnique({ kind: 'setup', step, detail: 'Funding gas on Polygon…' });
          await pmApi.setupStep(ctx, 'gas_funded', { eoaAddress: eoa.address });
          await waitForGas();
          step = 'gas_funded';
          break;
        }
        case 'gas_funded': {
          setPhaseUnique({ kind: 'setup', step, detail: 'Approving Polymarket contracts…' });
          const addrs = getPolymarketAddresses(POLYMARKET_CHAIN_ID);
          const approvalTxs: string[] = [];
          for (const target of [addrs.ctfExchange, addrs.negRiskExchange]) {
            const data = encodeFunctionData({
              abi: erc20Abi,
              functionName: 'approve',
              args: [target, maxUint256],
            });
            approvalTxs.push(await sendEoaTx(eoa.privateKey, addrs.usdc, data));
          }
          {
            const data = encodeFunctionData({
              abi: CTF_ABI,
              functionName: 'setApprovalForAll',
              args: [addrs.ctfExchange, true],
            });
            approvalTxs.push(await sendEoaTx(eoa.privateKey, addrs.ctf, data));
          }
          await pmApi.setupStep(ctx, 'approved', { approvalsTxHashes: approvalTxs });
          log.info('step', { step: 'setup-approved', requestId: intentId, approvalCount: approvalTxs.length });
          step = 'approved';
          break;
        }
        case 'approved': {
          setPhaseUnique({ kind: 'setup', step, detail: 'Authenticating with Polymarket…' });
          const auth = await signClobAuth(eoa.privateKey);
          const creds = await deriveClobApiKey(CLOB_API_BASE, auth);
          await pmApi.setupStep(ctx, 'authed', { clobAuth: auth, creds });
          step = 'authed';
          break;
        }
        case 'authed': {
          await pmApi.setupStep(ctx, 'complete', {});
          step = 'complete';
          break;
        }
      }
    }
    log.info('step', { step: 'setup-complete', requestId: intentId });
  };

  const runBet = async (intent: IntentDetail, eoa: SessionEoa) => {
    if (!intent.bet) throw new Error('Bet row not initialized by BE for this intent');
    let bet = intent.bet;
    const startMs = Date.now();
    log.info('step', { step: 'bet-started', requestId: intentId, betId: bet.id, status: bet.status });

    while (!isTerminal(bet.status)) {
      setPhaseUnique({ kind: 'executing', status: bet.status });

      try {
        switch (bet.status) {
          case 'INITIATED': {
            // Bridge initiation is BE-orchestrated; FE waits for
            // `bridgeIntentId` to appear on the bet row before transitioning
            // to BRIDGING. Throws (rather than silent-timeouts) if it never
            // shows up — the BE bridge endpoint is missing in that case.
            setPhaseUnique({ kind: 'executing', status: bet.status, detail: 'Waiting for bridge…' });
            const polled = await pollUntil(
              () => pmApi.bet(ctx, bet.id),
              (b) => b.bridgeIntentId != null,
              { intervalMs: POLL_INTERVAL_MS, timeoutMs: 2 * POLL_INTERVAL_MS },
            );
            if (!polled) {
              throw new Error('Bridge has not been initiated for this bet (BE pending).');
            }
            bet = polled;
            break;
          }
          case 'BRIDGING': {
            setPhaseUnique({ kind: 'executing', status: bet.status, detail: 'Bridging to Polygon…' });
            const status = await pollBridgeStatus(bet.id);
            if (status === 'success') {
              bet = await pmApi.transitionBet(ctx, bet.id, { status: 'BRIDGED' });
            } else {
              bet = await pmApi.transitionBet(ctx, bet.id, {
                status: 'FAILED',
                artifact: { failureReason: status === 'refund' ? 'bridge_refunded' : 'bridge_timeout' },
              });
            }
            break;
          }
          case 'BRIDGED': {
            setPhaseUnique({ kind: 'executing', status: bet.status, detail: 'Routing stake to executor…' });
            const addrs = getPolymarketAddresses(POLYMARKET_CHAIN_ID);
            const stake = parseUnits(bet.stakeUsdc, 6);
            const data = encodeFunctionData({
              abi: erc20Abi,
              functionName: 'transfer',
              args: [eoa.address, stake],
            });
            const hash = await sendUserOp(eoa, POLYMARKET_CHAIN_ID, addrs.usdc, 0n, data);
            log.info('step', { step: 'sca-to-eoa', requestId: intentId, betId: bet.id, txHash: hash });
            bet = await pmApi.transitionBet(ctx, bet.id, {
              status: 'SCA_TO_EOA',
              artifact: { scaToEoaTxHash: hash },
            });
            break;
          }
          case 'SCA_TO_EOA':
          case 'ORDER_SIGNED': {
            const result = await signAndPlaceOrder(eoa, bet);
            if (result.kind === 'reconfirm') return;
            bet = result.bet;
            break;
          }
          case 'ORDER_SUBMITTED': {
            setPhaseUnique({ kind: 'executing', status: bet.status, detail: 'Waiting for fill…' });
            bet = await pollUntilTerminal(bet.id);
            break;
          }
        }
      } catch (err) {
        // The BE's repo-level guard now rejects illegal transitions with
        // 409. This commonly fires when the BE poller has already moved the
        // bet to a terminal state (e.g. it observed the fill before us).
        // Refresh canonical state and let the loop converge — never blindly
        // retry, which would just 409 again.
        if (err instanceof IllegalTransitionError) {
          log.warn('illegal-transition', {
            requestId: intentId,
            betId: bet.id,
            from: err.from,
            to: err.to,
          });
          bet = await pmApi.bet(ctx, bet.id);
          continue;
        }
        throw err;
      }
    }

    log.info('step', {
      step: bet.status === 'FILLED' ? 'filled' : 'terminal',
      requestId: intentId, betId: bet.id, status: bet.status, durationMs: Date.now() - startMs,
    });
    if (bet.status === 'PARTIAL') {
      log.warn('partial-fill', { requestId: intentId, betId: bet.id, filledShares: bet.filledShares });
    }
    if (bet.status === 'FAILED') {
      log.error('place-bet-failed', { requestId: intentId, betId: bet.id, failureReason: bet.failureReason });
    }
    await pmApi.finalizeBet(ctx, bet.id, { status: bet.status });

    // BE flips refundRequired during finalize for non-fill terminals where
    // SCA→EOA already happened. Sweep now so the user doesn't need a
    // second mini-app open.
    if (bet.status === 'PARTIAL' || bet.status === 'UNFILLED' || bet.status === 'FAILED') {
      const fresh = await pmApi.bet(ctx, bet.id);
      if (fresh.refundRequired && !fresh.refundTxHash) {
        await sweepResidual(fresh, eoa);
      }
    }

    setPhaseUnique({ kind: 'done' });
    scheduleClose();
  };

  const signAndPlaceOrder = async (
    eoa: SessionEoa,
    bet: BetRow,
  ): Promise<
    | { kind: 'submitted'; bet: BetRow }
    | { kind: 'reconfirm' }
  > => {
    const ob = await pmApi.orderbook(ctx, bet.outcomeTokenId);
    const drift = await pmApi.driftDetected(ctx, bet.id, { livePriceBps: ob.midBps });
    if (drift.decision === 'reconfirm') {
      log.warn('drift-detected', {
        requestId: intentId,
        betId: bet.id,
        previousRefPriceBps: drift.previousRefPriceBps,
        newRefPriceBps: drift.newRefPriceBps,
        driftBps: drift.driftBps,
      });
      setPhaseUnique({
        kind: 'drift',
        previousRefPriceBps: drift.previousRefPriceBps,
        newRefPriceBps: drift.newRefPriceBps,
        driftBps: drift.driftBps,
      });
      scheduleClose();
      return { kind: 'reconfirm' };
    }
    setPhaseUnique({ kind: 'executing', status: bet.status, detail: 'Signing order…' });
    // Price off the live mid (not the stale `bet.refPriceBps`) — closes
    // the slippage hole the drift gate is meant to plug.
    const limitPriceBps = applySlippage(ob.midBps, ORDER_SLIPPAGE_BPS, 'BUY');
    const shares = sharesForStake(bet.stakeUsdc, limitPriceBps);
    const order = await signOrder(
      eoa.privateKey,
      buildUnsignedOrder({
        maker: eoa.address,
        tokenId: bet.outcomeTokenId,
        priceBps: limitPriceBps,
        shares,
        side: 'BUY',
        salt: randomSalt(),
      }),
    );
    log.info('step', { step: 'order-signed', requestId: intentId, betId: bet.id, clientOrderId: bet.clientOrderId });
    let next = bet.status === 'SCA_TO_EOA'
      ? await pmApi.transitionBet(ctx, bet.id, { status: 'ORDER_SIGNED' })
      : bet;
    const placeRes = await pmApi.placeOrder(ctx, {
      betId: next.id,
      clientOrderId: next.clientOrderId,
      order,
      livePriceBps: ob.midBps,
    });
    log.info('step', { step: 'submitted', requestId: intentId, betId: next.id, polymarketOrderId: placeRes.polymarketOrderId });
    next = await pmApi.transitionBet(ctx, next.id, {
      status: 'ORDER_SUBMITTED',
      artifact: { polymarketOrderId: placeRes.polymarketOrderId },
    });
    return { kind: 'submitted', bet: next };
  };

  const sweepResidual = async (bet: BetRow, eoa: SessionEoa): Promise<void> => {
    setPhaseUnique({ kind: 'refunding' });
    log.info('step', { step: 'refund-start', count: 1, betId: bet.id });
    const state = await pmApi.state(ctx);
    const scaAddress = state.setup.polygonScaAddress;
    if (!scaAddress) {
      log.warn('refund-no-sca', { betId: bet.id });
      return;
    }
    const txHash = await sweepUsdcToSca(eoa.privateKey, scaAddress as `0x${string}`);
    if (!txHash) {
      log.info('step', { step: 'refund-skipped', betId: bet.id });
      await pmApi.recordRefund(ctx, bet.id, NO_RESIDUAL_TX_HASH);
      return;
    }
    await pmApi.recordRefund(ctx, bet.id, txHash);
    log.info('step', { step: 'refund-recorded', betId: bet.id, txHash });
  };

  const pollBridgeStatus = async (betId: string): Promise<'success' | 'refund' | 'timeout'> => {
    const result = await pollUntil(
      () => pmApi.bridgeStatus(ctx, betId),
      (st) => st.status !== 'pending',
      { intervalMs: POLL_INTERVAL_MS, timeoutMs: BRIDGE_TIMEOUT_MS },
    );
    if (!result) return 'timeout';
    if (result.status === 'success') return 'success';
    if (result.status === 'no-intent') {
      throw new Error('Bridge intent missing — bet was transitioned to BRIDGING without an id.');
    }
    return 'refund';
  };

  const pollUntilTerminal = async (betId: string): Promise<BetRow> => {
    const result = await pollUntil(
      () => pmApi.bet(ctx, betId),
      (b) => isTerminal(b.status),
      { intervalMs: POLL_INTERVAL_MS, timeoutMs: FILL_TIMEOUT_MS },
    );
    if (result) return result;
    // FE timed out before BE finalized. BE's own poller is authoritative —
    // forcing FAILED here would 409 against the new repo guard.
    log.warn('fill-poll-timeout', { betId });
    return pmApi.bet(ctx, betId);
  };

  const waitForGas = async (): Promise<void> => {
    const result = await pollUntil(
      () => pmApi.state(ctx),
      (s) => POST_GAS_SETUP_STEPS.has(s.setup.setupStep),
      { intervalMs: POLL_INTERVAL_MS, timeoutMs: GAS_FUNDED_TIMEOUT_MS },
    );
    if (!result) throw new Error('Gas funding timed out');
  };

  const sendUserOp = async (
    eoa: SessionEoa,
    chainId: number,
    to: `0x${string}`,
    value: bigint,
    data: `0x${string}`,
  ): Promise<string> => {
    const sessionClient = await createSessionKeyClient(getKernelBlob(eoa, chainId), chainId);
    return sessionClient.sendTransaction({ to, value, data, account: sessionClient.account!, chain: null });
  };

  const scheduleClose = () => {
    setTimeout(() => window.Telegram?.WebApp?.close(), CLOSE_DELAY_MS);
  };

  if (phase.kind === 'error') return <FullScreenError message={phase.message} showClose />;
  if (phase.kind === 'in_flight') {
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <div className="text-4xl">⏳</div>
          <p className="text-white font-semibold">Another bet is being placed</p>
          <p className="text-sm text-white/70">
            Wait for it to settle, then try again from chat.
          </p>
        </div>
      </FullScreen>
    );
  }
  if (phase.kind === 'drift') {
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <div className="text-4xl">⚠️</div>
          <p className="text-white font-semibold">Price moved</p>
          <p className="text-sm text-white/70">
            {(phase.previousRefPriceBps / 100).toFixed(1)}% → {(phase.newRefPriceBps / 100).toFixed(1)}%
            ({(phase.driftBps / 100).toFixed(1)}% drift). Re-confirm in chat to continue.
          </p>
        </div>
      </FullScreen>
    );
  }
  if (phase.kind === 'refunding') {
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-5 max-w-sm text-center">
          <ShieldIcon size={64} variant="violet" />
          <p className="text-white font-semibold text-lg">Returning unused funds</p>
          <div className="flex items-center gap-2 text-xs text-white/60">
            <Spinner size="xs" />
            <span>Sweeping residual USDC to your wallet…</span>
          </div>
        </div>
      </FullScreen>
    );
  }
  if (phase.kind === 'done') {
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-4">
          <ShieldIcon size={48} variant="success" />
          <p className="text-white font-semibold">Bet placed</p>
        </div>
      </FullScreen>
    );
  }

  return (
    <FullScreen>
      <div className="flex flex-col items-center gap-5 max-w-sm text-center">
        <ShieldIcon size={64} variant="violet" />
        <p className="text-white font-semibold text-lg">Placing bet</p>
        <div className="flex items-center gap-2 text-xs text-white/60">
          <Spinner size="xs" />
          <span>{labelForPhase(phase)}</span>
        </div>
      </div>
    </FullScreen>
  );
}

function labelForPhase(phase: Phase): string {
  if (phase.kind === 'loading') return 'Loading…';
  if (phase.kind === 'setup') return phase.detail ?? `Setup: ${phase.step}`;
  if (phase.kind === 'executing') return phase.detail ?? phase.status;
  return '';
}

function isTerminal(s: BetStatus): boolean {
  return TERMINAL_BET_STATUSES.includes(s);
}

function samePhase(a: Phase, b: Phase): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'setup' && b.kind === 'setup') return a.step === b.step && a.detail === b.detail;
  if (a.kind === 'executing' && b.kind === 'executing') return a.status === b.status && a.detail === b.detail;
  if (a.kind === 'error' && b.kind === 'error') return a.message === b.message;
  if (a.kind === 'drift' && b.kind === 'drift') {
    return a.newRefPriceBps === b.newRefPriceBps
      && a.previousRefPriceBps === b.previousRefPriceBps;
  }
  return true; // 'loading' | 'done' | 'refunding' | 'in_flight' have no payload
}
