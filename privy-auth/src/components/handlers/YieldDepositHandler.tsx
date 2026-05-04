import React from 'react';
import { useWallets } from '@privy-io/react-auth';
import type { KernelAccountClient } from '@zerodev/sdk';
import type { SignRequest } from '../../types/miniAppRequest.types';
import { postResponse } from '../../utils/postResponse';
import { createSessionKeyClient } from '../../utils/crypto';
import { createSudoClient } from '../../utils/createSudoClient';
import { fetchNextRequest } from '../../utils/fetchNextRequest';
import { toErrorMessage } from '../../utils/toErrorMessage';
import { FullScreen } from '../atomics/FullScreen';
import { Spinner } from '../atomics/spinner';
import { ShieldIcon } from '../atomics/icons';
import { createLogger } from '../../utils/logger';
import { getChainId } from '../../utils/chainConfig';

const log = createLogger('YieldDepositHandler');

const CLOSE_DELAY_MS = 1500;

type SessionClient = Awaited<ReturnType<typeof createSessionKeyClient>>;
type Phase = 'presign' | 'signing' | 'done';

export function YieldDepositHandler({
  request,
  privyToken,
  backendUrl,
  serializedBlob,
  mode,
}: {
  request: SignRequest;
  privyToken: string;
  backendUrl: string;
  serializedBlob: string | null;
  mode: 'deposit' | 'withdraw';
}) {
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === 'privy');
  const sudoClientByChainRef = React.useRef<Map<number, KernelAccountClient>>(new Map());
  const reqChainId = request.chainId ?? getChainId();

  const getSudoClient = React.useCallback(async (chainId: number): Promise<KernelAccountClient> => {
    const cached = sudoClientByChainRef.current.get(chainId);
    if (cached) return cached;
    if (!embedded) throw new Error('Embedded wallet not available');
    const provider = await embedded.getEthereumProvider();
    const c = await createSudoClient(
      provider,
      embedded.address as `0x${string}`,
      chainId,
    );
    sudoClientByChainRef.current.set(chainId, c);
    return c;
  }, [embedded]);

  const [phase, setPhase] = React.useState<Phase>(request.autoSign ? 'signing' : 'presign');
  const [error, setError] = React.useState<string | null>(null);
  const autoSignAttemptedRef = React.useRef(false);
  const sessionClientRef = React.useRef<SessionClient | null>(null);

  const meta = request.displayMeta;
  const isDeposit = mode === 'deposit';

  const reportTxHash = React.useCallback(
    (txHash: string) =>
      postResponse(backendUrl, {
        requestId: request.requestId,
        requestType: 'sign',
        privyToken,
        txHash,
      }),
    [request.requestId, privyToken, backendUrl],
  );

  const sendReject = React.useCallback(() => {
    postResponse(backendUrl, {
      requestId: request.requestId,
      requestType: 'sign',
      privyToken,
      rejected: true,
    }).catch(() => {});
  }, [request.requestId, privyToken, backendUrl]);

  const executeSign = React.useCallback(
    async (sc: SessionClient) => {
      const hash = await sc.sendTransaction({
        to: request.to as `0x${string}`,
        value: BigInt(request.value),
        data: request.data as `0x${string}`,
        account: sc.account!,
        chain: null,
      });
      log.info('step', { step: 'submitted', requestId: request.requestId, chainId: reqChainId, mode, hash });
      await reportTxHash(hash);

      // Check for queued follow-up step (defensive — yield doesn't chain today but safe to handle).
      try {
        await fetchNextRequest(backendUrl, request.requestId, privyToken);
      } catch (err) {
        log.warn('fetchNextRequest failed', { requestId: request.requestId, err: String(err) });
      }

      log.info('step', { step: 'succeeded', requestId: request.requestId, chainId: reqChainId, mode });
      setPhase('done');
      setTimeout(() => window.Telegram?.WebApp?.close(), CLOSE_DELAY_MS);
    },
    [request, reportTxHash, backendUrl, privyToken, mode],
  );

  // Auto-sign: fires when autoSign=true and serializedBlob becomes available.
  React.useEffect(() => {
    if (!request.autoSign) return;
    if (autoSignAttemptedRef.current) return;
    if (!serializedBlob) return;

    autoSignAttemptedRef.current = true;
    log.info('step', { step: 'started', requestId: request.requestId, chainId: reqChainId, mode });
    log.debug('autoSign start', { requestId: request.requestId, chainId: reqChainId, mode });

    (async () => {
      try {
        let sc = sessionClientRef.current;
        if (!sc) {
          sc = await createSessionKeyClient(serializedBlob, reqChainId);
          sessionClientRef.current = sc;
        }
        await executeSign(sc);
      } catch (err) {
        const msg = toErrorMessage(err);
        log.error('autoSign failed', { requestId: request.requestId, chainId: reqChainId, mode, err: msg });
        setError(msg);
        setPhase('presign');
        autoSignAttemptedRef.current = false;
      }
    })();
  }, [request.autoSign, request.requestId, serializedBlob, mode, executeSign]);

  const handleManualSign = React.useCallback(async () => {
    if (!embedded) return;
    setPhase('signing');
    setError(null);
    log.info('step', { step: 'started', requestId: request.requestId, chainId: reqChainId, mode, path: 'manual' });
    try {
      const sudoClient = await getSudoClient(reqChainId);
      const hash = await sudoClient.sendTransaction({
        to: request.to as `0x${string}`,
        value: BigInt(request.value),
        data: request.data as `0x${string}`,
        account: sudoClient.account!,
        chain: null,
      });
      log.info('step', { step: 'succeeded', requestId: request.requestId, chainId: reqChainId, mode, hash, path: 'manual' });
      await reportTxHash(hash);
      setPhase('done');
      setTimeout(() => window.Telegram?.WebApp?.close(), CLOSE_DELAY_MS);
    } catch (err) {
      const msg = toErrorMessage(err);
      log.error('manual sign failed', { requestId: request.requestId, chainId: reqChainId, mode, err: msg });
      setError(msg);
      setPhase('presign');
    }
  }, [embedded, getSudoClient, request, reportTxHash, mode]);

  if (phase === 'done') {
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-4 text-center">
          <ShieldIcon size={64} variant="success" />
          <p className="text-white font-semibold text-lg">
            {isDeposit ? 'Deposit submitted' : 'Withdrawal submitted'}
          </p>
          <p className="text-sm text-white/50">Closing automatically…</p>
        </div>
      </FullScreen>
    );
  }

  if (phase === 'signing') {
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-5 max-w-sm text-center">
          <ShieldIcon size={64} variant="violet" />
          <div className="flex flex-col gap-1.5">
            <p className="text-white font-semibold text-lg">
              {isDeposit
                ? `Depositing${meta ? ` ${meta.amountHuman} ${meta.tokenSymbol}` : ''}${meta?.protocolName ? ` to ${meta.protocolName}` : ''}…`
                : `Withdrawing${meta?.protocolName ? ` from ${meta.protocolName}` : ''}…`}
            </p>
            <p className="text-sm text-white/60">
              Signing with your delegated key. No action required.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Spinner size="xs" />
            <span>Broadcasting transaction…</span>
          </div>
        </div>
      </FullScreen>
    );
  }

  // presign confirmation screen
  return (
    <FullScreen>
      <div className="flex flex-col items-center gap-6 max-w-sm w-full text-center">
        <ShieldIcon size={64} variant="violet" />
        <div className="flex flex-col gap-1.5">
          <p className="text-white font-semibold text-xl">
            {isDeposit ? 'Confirm Deposit' : 'Confirm Withdrawal'}
          </p>
          {meta && (
            <p className="text-sm text-white/60 leading-relaxed">
              {isDeposit
                ? `Deposit ${meta.amountHuman} ${meta.tokenSymbol} into ${meta.protocolName}${
                    meta.expectedApy != null
                      ? ` at ~${(meta.expectedApy * 100).toFixed(2)}% APY`
                      : ''
                  }`
                : `Withdraw all funds from ${meta.protocolName} → your wallet`}
            </p>
          )}
        </div>

        {meta && (
          <div className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-left flex flex-col gap-3">
            <MetaRow label="Protocol" value={meta.protocolName} />
            <MetaRow label="Token" value={meta.tokenSymbol} />
            {isDeposit && (
              <MetaRow label="Amount" value={`${meta.amountHuman} ${meta.tokenSymbol}`} />
            )}
            {isDeposit && meta.expectedApy != null && (
              <MetaRow
                label="Expected APY"
                value={`~${(meta.expectedApy * 100).toFixed(2)}%`}
                highlight
              />
            )}
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 w-full text-left">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-3 w-full">
          <button
            onClick={handleManualSign}
            disabled={!embedded}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-semibold text-sm disabled:opacity-50"
          >
            {isDeposit ? 'Deposit' : 'Withdraw'}
          </button>
          <button
            onClick={() => {
              sendReject();
              window.Telegram?.WebApp?.close();
            }}
            className="w-full py-3 rounded-xl border border-white/10 text-white/50 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </FullScreen>
  );
}

function MetaRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase">{label}</p>
      <p className={`text-sm font-mono ${highlight ? 'text-emerald-400' : 'text-white/80'}`}>
        {value}
      </p>
    </div>
  );
}
