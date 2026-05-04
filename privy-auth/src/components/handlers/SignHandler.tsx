import React from 'react';
import { useWallets } from '@privy-io/react-auth';
import type { KernelAccountClient } from '@zerodev/sdk';
import type { SignRequest } from '../../types/miniAppRequest.types';
import { postResponse } from '../../utils/postResponse';
import { createSessionKeyClient } from '../../utils/crypto';
import { createSudoClient } from '../../utils/createSudoClient';
import { fetchNextRequest } from '../../utils/fetchNextRequest';
import { SigningRequestModal } from '../SigningRequestModal';
import { FullScreen } from '../atomics/FullScreen';
import { Spinner } from '../atomics/spinner';
import { ShieldIcon } from '../atomics/icons';
import type { DelegationState } from '../../hooks/useDelegatedKey';
import { BscDelegationModal } from '../BscDelegationModal';
import { createLogger } from '../../utils/logger';
import { interpretSignError, type InterpretedError } from '../../utils/interpretSignError';
import { findRecentBroadcast, trackInFlightBroadcast } from '../../utils/recentBroadcasts';
import { getChainId, getPaymasterUrl } from '../../utils/chainConfig';

const log = createLogger('SignHandler');

// Fallback timeout only starts once the delegated key is no longer being restored.
// While unlock() is in-flight we wait indefinitely — the timer is for the case
// where the blob is genuinely unavailable (no stored key, decrypt failed, etc.).
const AUTO_SIGN_TIMEOUT_MS = 10_000;
const CLOSE_DELAY_MS = 1500;

type SessionClient = Awaited<ReturnType<typeof createSessionKeyClient>>;

export function SignHandler({
  request: initialRequest,
  privyToken,
  backendUrl,
  serializedBlob,
  serializedBlobs,
  installedChainIds,
  installOnChain,
  delegationState,
  keyStatus,
}: {
  request: SignRequest;
  privyToken: string;
  backendUrl: string;
  serializedBlob: string | null;
  serializedBlobs?: Record<number, string>;
  installedChainIds?: number[];
  installOnChain?: (chainId: number) => void;
  delegationState?: DelegationState;
  keyStatus: DelegationState['status'];
}) {
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === 'privy');
  const sudoClientByChainRef = React.useRef<Map<number, KernelAccountClient>>(new Map());

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

  const [currentRequest, setCurrentRequest] = React.useState<SignRequest>(initialRequest);
  const [showManual, setShowManual] = React.useState(!initialRequest.autoSign);
  const [done, setDone] = React.useState(false);
  const [autoSignError, setAutoSignError] = React.useState<InterpretedError | null>(null);
  const autoSignAttemptedRef = React.useRef(false);
  // Cache session clients per chain so cross-chain step lists (e.g. /stock buy
  // bridges Avax → BSC) don't re-pay the deserialize cost on every chain switch.
  const sessionClientByChainRef = React.useRef<Map<number, SessionClient>>(new Map());

  const getSessionClient = React.useCallback(async (chainId: number): Promise<SessionClient> => {
    const cached = sessionClientByChainRef.current.get(chainId);
    if (cached) return cached;
    const blob = serializedBlobs?.[chainId] ?? serializedBlob;
    if (!blob) throw new Error(`no session-key blob for chain ${chainId}`);
    const c = await createSessionKeyClient(blob, chainId);
    if (c.chain?.id !== chainId) {
      throw new Error(`session client chain mismatch: built ${c.chain?.id}, requested ${chainId}`);
    }
    sessionClientByChainRef.current.set(chainId, c);
    return c;
  }, [serializedBlob, serializedBlobs]);

  // Resync when the parent swaps in a different request (distinct requestId).
  // useState initializer only fires once, so without this the first request
  // would persist even if the dispatcher routed a new one to us.
  React.useEffect(() => {
    if (initialRequest.requestId !== currentRequest.requestId) {
      setCurrentRequest(initialRequest);
      setShowManual(!initialRequest.autoSign);
      setAutoSignError(null);
      autoSignAttemptedRef.current = false;
    }
  }, [initialRequest, currentRequest.requestId]);

  const sendReject = React.useCallback(() => {
    postResponse(backendUrl, {
      requestId: currentRequest.requestId,
      requestType: 'sign',
      privyToken,
      rejected: true,
    }).catch(() => {});
  }, [currentRequest, privyToken, backendUrl]);

  const reportTxHash = React.useCallback(
    (txHash: string) =>
      postResponse(backendUrl, {
        requestId: currentRequest.requestId,
        requestType: 'sign',
        privyToken,
        txHash,
      }),
    [currentRequest, privyToken, backendUrl],
  );

  const reqChainIdForGate = currentRequest.chainId ?? getChainId();
  const needsCrossChainApproval =
    !!installedChainIds &&
    installedChainIds.length > 0 &&
    !installedChainIds.includes(reqChainIdForGate);

  // Auto-sign: fire once per currentRequest; re-runs when currentRequest changes
  // (i.e. when next swap step arrives). Falls back to manual after timeout.
  React.useEffect(() => {
    if (done) return;
    if (needsCrossChainApproval) return; // wait for the user to approve on the new chain
    if (!currentRequest.autoSign || autoSignAttemptedRef.current) return;

    if (!serializedBlob) {
      // Don't race the unlock: while the key is still being restored, just wait.
      // Only arm the fallback once the key machine has settled without a blob
      // (idle = no stored key / error = decrypt failed / done-without-blob = unexpected).
      if (keyStatus === 'processing') return;
      const timer = setTimeout(() => {
        if (autoSignAttemptedRef.current) return;
        log.warn('serializedBlob timed out — falling back to manual', { keyStatus });
        setShowManual(true);
      }, AUTO_SIGN_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }

    autoSignAttemptedRef.current = true;
    const reqChainId = currentRequest.chainId ?? getChainId();
    log.info('step', { step: 'started', requestId: currentRequest.requestId, chainId: reqChainId });
    log.debug('autoSign start', {
      requestId: currentRequest.requestId,
      chainId: reqChainId,
      blobLen: serializedBlob.length,
      hasPaymaster: !!getPaymasterUrl(reqChainId),
      to: currentRequest.to,
      value: currentRequest.value,
      dataLen: currentRequest.data.length,
    });

    (async () => {
      let sessionClient: SessionClient;
      try {
        sessionClient = await getSessionClient(reqChainId);
        log.debug('session client built', { account: sessionClient.account?.address, chainId: reqChainId });
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        const interpreted = interpretSignError(err);
        log.error('createSessionKeyClient failed', { requestId: currentRequest.requestId, chainId: reqChainId, err: msg }, { toast: false });
        log.warn(interpreted.friendly, { requestId: currentRequest.requestId, chainId: reqChainId });
        if (err instanceof Error && err.stack) log.debug('stack', { stack: err.stack });
        setAutoSignError(interpreted);
        return;
      }

      // Payload-level dedupe: if this exact (to, value, data) was already
      // broadcast from this device within the TTL, do NOT re-broadcast.
      // Reason: when the BE fails to ack a successful tx and re-issues the
      // request under a fresh requestId, we'd otherwise drain the user's
      // balance by signing the same operation again. The chain is the source
      // of truth; reuse the cached hash and proceed to ack/close.
      const dedupeHit = findRecentBroadcast(
        currentRequest.to,
        currentRequest.value,
        currentRequest.data,
      );
      let hash: `0x${string}`;
      if (dedupeHit) {
        log.warn(
          'duplicate-payload — reusing prior broadcast instead of re-sending',
          { requestId: currentRequest.requestId, hash: dedupeHit.hash, ageMs: Date.now() - dedupeHit.ts },
          { toast: false },
        );
        hash = dedupeHit.hash as `0x${string}`;
      } else {
      try {
        // trackInFlightBroadcast coalesces concurrent sends of the same
        // (to, value, data) within this tab. Prevents a second userOp from
        // being submitted when StrictMode/effect-rerun/BE-re-emit fires while
        // the first send is still in flight — without this, both attempts
        // race past findRecentBroadcast (which only sees *completed* sends).
        hash = await trackInFlightBroadcast(
          currentRequest.to,
          currentRequest.value,
          currentRequest.data,
          () => sessionClient!.sendTransaction({
            to: currentRequest.to as `0x${string}`,
            value: BigInt(currentRequest.value),
            data: currentRequest.data as `0x${string}`,
            account: sessionClient!.account!,
            chain: null,
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        const interpreted = interpretSignError(err);
        log.error('sendTransaction failed', { requestId: currentRequest.requestId, err: msg }, { toast: false });
        log.warn(interpreted.friendly, { requestId: currentRequest.requestId });
        if (err instanceof Error && err.stack) log.debug('stack', { stack: err.stack });
        // Tell the BE the request failed AND why. The BE keys off `errorCode`
        // to drive recovery flows (e.g. /buy nudge on insufficient_token_balance);
        // without this it would just timeout the signing request and the user
        // would see no contextual help in chat.
        postResponse(backendUrl, {
          requestId: currentRequest.requestId,
          requestType: 'sign',
          privyToken,
          rejected: true,
          errorCode: interpreted.code,
          errorMessage: interpreted.friendly,
        }).catch((e) => log.debug('postResponse(error) failed', { err: String(e) }));
        setAutoSignError(interpreted);
        return;
      }
      }

      log.info('step', { step: 'submitted', requestId: currentRequest.requestId, hash });

      // Best-effort: ack the txHash to the backend. The chain is already source
      // of truth — if this fails (e.g. 404 because the request cache expired),
      // log it but still treat the operation as successful.
      try {
        await reportTxHash(hash);
      } catch (err) {
        log.warn(
          'reportTxHash failed (tx already on-chain)',
          { requestId: currentRequest.requestId, hash, err: String(err) },
          { toast: false },
        );
      }

      // Before closing, check if the backend has queued a next step.
      let nextRequest: Awaited<ReturnType<typeof fetchNextRequest>> = null;
      try {
        nextRequest = await fetchNextRequest(backendUrl, currentRequest.requestId, privyToken);
      } catch (err) {
        log.warn(
          'fetchNextRequest failed',
          { requestId: currentRequest.requestId, err: String(err) },
          { toast: false },
        );
      }

      if (
        nextRequest &&
        nextRequest.requestType === 'sign' &&
        nextRequest.requestId !== currentRequest.requestId
      ) {
        // Same-id "next" means the BE didn't clean up after our /response
        // (e.g. signingRequestCache miss). Treat as no-next and close —
        // otherwise we re-fire auto-sign on the same payload and POST
        // /response in a hot loop, hammering the BE.
        log.info('next swap step found', { requestId: nextRequest.requestId });
        // Drop the cached KernelAccountClient before signing the next step.
        // The deserialized permission account carries internal state (nonce
        // key, validator/permission resolution) that becomes stale after a
        // userOp lands; reusing it for a second sendTransaction reverts during
        // simulation with `0xe52970aa`. Re-running createSessionKeyClient is
        // cheap (one decrypt + a few RPCs) and matches the old per-step
        // open/close behaviour. Scope: this branch only — single-step flows
        // (/send, /yield single-tx) never reach here, so they are unaffected.
        sessionClientByChainRef.current.delete(reqChainId);
        autoSignAttemptedRef.current = false;
        setCurrentRequest(nextRequest as SignRequest);
      } else {
        log.info('step', { step: 'succeeded', requestId: currentRequest.requestId });
        setDone(true);
        setTimeout(() => window.Telegram?.WebApp?.close(), CLOSE_DELAY_MS);
      }
    })();
  }, [currentRequest, serializedBlob, keyStatus, reportTxHash, backendUrl, privyToken, done, needsCrossChainApproval]);

  if (needsCrossChainApproval && installOnChain) {
    return (
      <BscDelegationModal
        chainId={reqChainIdForGate}
        installOnChain={installOnChain}
        delegationState={delegationState}
        installedChainIds={installedChainIds!}
        onCancel={() => {
          sendReject();
          window.Telegram?.WebApp?.close();
        }}
      />
    );
  }

  if (done) {
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-4">
          <ShieldIcon size={48} variant="success" />
          <p className="text-white font-semibold">Transaction sent</p>
        </div>
      </FullScreen>
    );
  }

  // Auto-sign failures are shown as a persistent, readable screen instead of
  // the manual modal. Manual sign for an autoSign request is not a valid
  // recovery (same account, usually the same class of failure like AA21), and
  // swapping the view to a modal hides the error text behind TG UI chrome.
  if (autoSignError && currentRequest.autoSign) {
    const copy = () => {
      navigator.clipboard?.writeText(autoSignError.raw).catch(() => {});
    };
    return (
      <FullScreen>
        <div className="flex flex-col gap-4 max-w-md w-full">
          <div className="flex flex-col items-center gap-2">
            <div className="text-4xl">⚠️</div>
            <p className="text-white font-semibold text-lg">Auto-sign failed</p>
            <p className="text-sm text-white/80 text-center">
              {autoSignError.friendly}
            </p>
          </div>
          <details className="bg-white/5 border border-white/10 rounded-lg p-3 text-left">
            <summary className="text-[10px] font-semibold tracking-widest text-white/30 uppercase cursor-pointer select-none">
              Technical details
            </summary>
            <p className="mt-2 text-xs text-red-200 break-all whitespace-pre-wrap select-text max-h-64 overflow-auto">
              {autoSignError.raw}
            </p>
          </details>
          <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-left text-xs text-white/60 space-y-1">
            <div>chainId: {currentRequest.chainId ?? getChainId()}</div>
            <div>to: <span className="break-all">{currentRequest.to}</span></div>
            <div>value: {currentRequest.value}</div>
            <div>dataLen: {currentRequest.data.length}</div>
          </div>
          <div className="flex gap-2">
            <button
              className="flex-1 text-xs py-2 rounded border border-white/20 text-white/80 active:bg-white/10"
              onClick={copy}
            >
              Copy error
            </button>
            <button
              className="flex-1 text-xs py-2 rounded border border-white/20 text-white/80 active:bg-white/10"
              onClick={() => {
                sendReject();
                window.Telegram?.WebApp?.close();
              }}
            >
              Close
            </button>
          </div>
        </div>
      </FullScreen>
    );
  }

  if (!showManual) {
    const waiting = !serializedBlob;
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-5 max-w-sm text-center">
          <ShieldIcon size={64} variant="violet" />
          <div className="flex flex-col gap-1.5">
            <p className="text-white font-semibold text-lg">
              {waiting ? 'Preparing your session key' : 'Signing with your delegated key'}
            </p>
            <p className="text-sm text-white/60 leading-relaxed">
              {waiting
                ? 'Unlocking your on-device session key. No popup — this happens silently.'
                : 'Your delegated key is signing this transaction automatically. You will not need to approve anything.'}
            </p>
          </div>
          <div className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-left">
            <p className="text-[10px] font-semibold tracking-widest text-white/30 uppercase mb-1">
              Action
            </p>
            <p className="text-sm text-white/80 break-words">{currentRequest.description}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Spinner size="xs" />
            <span>{waiting ? 'Loading key…' : 'Broadcasting transaction…'}</span>
          </div>
        </div>
      </FullScreen>
    );
  }

  return (
    <>
      {autoSignError && (
        <div className="fixed top-2 left-2 right-2 z-50 bg-red-500/10 border border-red-500/30 text-red-200 text-xs p-2 rounded">
          Auto-sign failed — please approve manually. ({autoSignError.friendly})
        </div>
      )}
    <SigningRequestModal
      event={{
        type: 'sign_request',
        requestId: currentRequest.requestId,
        to: currentRequest.to,
        value: currentRequest.value,
        data: currentRequest.data,
        description: currentRequest.description,
        expiresAt: currentRequest.expiresAt,
        autoSign: currentRequest.autoSign,
      }}
      approve={async () => {
        if (!embedded) throw new Error('Smart wallet not ready');
        const reqChainId = currentRequest.chainId ?? getChainId();
        log.info('step', { step: 'started', requestId: currentRequest.requestId, chainId: reqChainId, path: 'manual' });
        const sudoClient = await getSudoClient(reqChainId);
        const hash = await sudoClient.sendTransaction({
          to: currentRequest.to as `0x${string}`,
          value: BigInt(currentRequest.value),
          data: currentRequest.data as `0x${string}`,
          account: sudoClient.account!,
          chain: null,
        });
        log.info('step', { step: 'succeeded', requestId: currentRequest.requestId, chainId: reqChainId, hash, path: 'manual' });
        await reportTxHash(hash);
        setTimeout(() => window.Telegram?.WebApp?.close(), CLOSE_DELAY_MS);
      }}
      reject={() => {
        sendReject();
        setTimeout(() => window.Telegram?.WebApp?.close(), CLOSE_DELAY_MS);
      }}
    />
    </>
  );
}
