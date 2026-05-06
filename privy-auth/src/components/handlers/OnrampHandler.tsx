import React from 'react';
import { useFundWallet, usePrivy } from '@privy-io/react-auth';
import type { OnrampRequest } from '../../types/miniAppRequest.types';
import { FullScreen } from '../atomics/FullScreen';
import { Spinner } from '../atomics/spinner';
import { ShieldIcon } from '../atomics/icons';
import { createLogger } from '../../utils/logger';
import { toErrorMessage } from '../../utils/toErrorMessage';

const log = createLogger('OnrampHandler');

export function OnrampHandler({ request }: { request: OnrampRequest }) {
  const { ready, authenticated } = usePrivy();
  const attemptedRef = React.useRef(false);
  const [status, setStatus] = React.useState<
    'idle' | 'opening' | 'done' | 'cancelled' | 'error'
  >('idle');
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  // Privy's `fundWallet` promise resolves with `{ status: 'submitted' | 'confirmed' }`
  // when the user actually pays, but historically also resolves on plain modal
  // exit — which is why we previously saw "Payment submitted" after a cancel.
  // `onUserExited` is the authoritative cancel/exit signal: capture it in a ref
  // so the post-await branch knows whether to treat the resolution as success.
  const exitedWithoutPayingRef = React.useRef(false);
  const { fundWallet } = useFundWallet({
    onUserExited: ({ fundingMethod, balance }) => {
      // No funding method picked, or no balance change observed → user
      // bailed before / during the provider flow. Treat as cancelled.
      const looksCancelled = !fundingMethod || balance === undefined || balance === 0n;
      log.info('onUserExited', {
        requestId: request.requestId,
        fundingMethod: fundingMethod ?? null,
        balance: balance?.toString() ?? null,
        looksCancelled,
      });
      if (looksCancelled) exitedWithoutPayingRef.current = true;
    },
  });

  const open = React.useCallback(async () => {
    setStatus('opening');
    setErrorMsg(null);
    exitedWithoutPayingRef.current = false;
    log.info('step', { step: 'started', requestId: request.requestId });
    try {
      const result = await fundWallet({
        address: request.walletAddress,
        options: {
          chain: { id: request.chainId },
          amount: String(request.amount),
          asset: request.asset === 'USDC' ? 'USDC' : 'native-currency',
        },
      });
      const fundStatus = (result as { status?: string } | undefined)?.status;
      // Trust the SDK's own status field first. Only fall back to the
      // exit-ref heuristic if the SDK gave us no status (older shape).
      const confirmedByStatus =
        fundStatus === 'submitted' || fundStatus === 'confirmed';
      if (exitedWithoutPayingRef.current && !confirmedByStatus) {
        log.warn('step', { step: 'failed', requestId: request.requestId, reason: 'user-cancelled' });
        setStatus('cancelled');
        return;
      }
      if (!confirmedByStatus && fundStatus !== undefined) {
        // Unknown status string — be conservative and don't claim success.
        log.warn('unknown-fundResult-status', { requestId: request.requestId, fundStatus });
        setStatus('cancelled');
        return;
      }
      log.info('step', { step: 'succeeded', requestId: request.requestId, fundStatus: fundStatus ?? 'unknown' });
      setStatus('done');
    } catch (err) {
      const msg = toErrorMessage(err);
      log.error('fundWallet failed', { requestId: request.requestId, err: msg });
      setErrorMsg(msg);
      setStatus('error');
    }
  }, [fundWallet, request]);

  // Auto-open once Privy is ready and the user is authenticated.
  React.useEffect(() => {
    if (attemptedRef.current) return;
    if (!ready || !authenticated) return;
    attemptedRef.current = true;
    void open();
  }, [ready, authenticated, open]);

  if (status === 'opening' || status === 'idle') {
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-4">
          <Spinner size="lg" />
          <p className="text-white">Opening card payment…</p>
        </div>
      </FullScreen>
    );
  }

  if (status === 'done') {
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-4 text-center">
          <ShieldIcon size={48} variant="success" />
          <p className="text-white font-semibold">Payment submitted</p>
          <p className="text-white/70 text-sm max-w-xs">
            Funds typically arrive within a few minutes. You can close this window and return to Telegram.
          </p>
        </div>
      </FullScreen>
    );
  }

  if (status === 'cancelled') {
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="text-5xl">✕</div>
          <p className="text-white font-semibold">Payment cancelled</p>
          <p className="text-white/70 text-sm max-w-xs">
            No charge was made. You can try again or deposit manually instead.
          </p>
          <button
            onClick={() => {
              attemptedRef.current = false;
              void open();
            }}
            className="rounded-lg bg-white px-4 py-2 text-black font-medium"
          >
            Try again
          </button>
          <div className="mt-4 rounded-lg bg-white/5 p-3 text-left">
            <p className="text-white/60 text-xs mb-1">Or deposit manually to:</p>
            <p className="text-white font-mono text-xs break-all">{request.walletAddress}</p>
          </div>
        </div>
      </FullScreen>
    );
  }

  // error
  return (
    <FullScreen>
      <div className="flex flex-col items-center gap-4 text-center max-w-sm">
        <div className="text-5xl">⚠️</div>
        <p className="text-white font-semibold">Couldn't open card payment</p>
        {errorMsg ? <p className="text-white/60 text-xs break-words">{errorMsg}</p> : null}
        <button
          onClick={() => {
            attemptedRef.current = false;
            void open();
          }}
          className="rounded-lg bg-white px-4 py-2 text-black font-medium"
        >
          Try again
        </button>
        <div className="mt-4 rounded-lg bg-white/5 p-3 text-left">
          <p className="text-white/60 text-xs mb-1">Or deposit manually to:</p>
          <p className="text-white font-mono text-xs break-all">{request.walletAddress}</p>
        </div>
      </div>
    </FullScreen>
  );
}
