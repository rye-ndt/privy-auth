import React from 'react';
import { Toaster } from 'sonner';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useDelegatedKey } from './hooks/useDelegatedKey';
import { deriveScaAddress } from './utils/deriveScaAddress';
import { toErrorMessage } from './utils/toErrorMessage';
import { useRequest } from './hooks/useRequest';
import { AuthHandler } from './components/handlers/AuthHandler';
import { SignHandler } from './components/handlers/SignHandler';
import { YieldDepositHandler } from './components/handlers/YieldDepositHandler';
import { ApproveHandler } from './components/handlers/ApproveHandler';
import { OnrampHandler } from './components/handlers/OnrampHandler';
import { PlaceBetHandler } from './components/handlers/PlaceBetHandler';
import { ClosePositionHandler } from './components/handlers/ClosePositionHandler';
import { StatusView } from './components/StatusView';
import { usePrivyToken } from './hooks/privy';
import { LoadingSpinner } from './components/atomics/spinner';
import { FullScreenError } from './components/atomics/FullScreen';
import { LoginView } from './components/views/login';
import { createLogger } from './utils/logger';
import { getOnboardingChainIds } from './utils/chainConfig';
import { parseDeepLink } from './utils/deepLink';

const log = createLogger('App');
const TMA_AUTO_LOGIN_TIMEOUT_MS = 4000;

function isInsideTelegram() {
  return !!window.Telegram?.WebApp?.initData;
}

export default function App() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const privyToken = usePrivyToken();
  const backendUrl = (import.meta.env.VITE_BACKEND_URL as string) ?? '';
  const [tmaLoginTimedOut, setTmaLoginTimedOut] = React.useState(false);

  // Telegram detection + TMA timeout logging.
  React.useEffect(() => {
    if (isInsideTelegram()) {
      log.info('telegram-detected');
      const t = setTimeout(() => {
        log.info('tma-auto-login-timeout');
        setTmaLoginTimedOut(true);
      }, TMA_AUTO_LOGIN_TIMEOUT_MS);
      return () => clearTimeout(t);
    }
    log.info('telegram-not-detected');
  }, []);

  const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');
  const eoaAddress = (embeddedWallet ?? wallets[0])?.address ?? '';

  const [smartAddress, setSmartAddress] = React.useState('');
  React.useEffect(() => {
    if (!eoaAddress) { setSmartAddress(''); return; }
    let cancelled = false;
    deriveScaAddress(eoaAddress as `0x${string}`)
      .then((sca) => { if (!cancelled) setSmartAddress(sca); })
      .catch((err) => log.error('derive-sca-failed', { err: toErrorMessage(err) }));
    return () => { cancelled = true; };
  }, [eoaAddress]);

  const delegatedKey = useDelegatedKey({
    smartAccountAddress: smartAddress,
    signerAddress: eoaAddress,
    signerWallet: embeddedWallet,
    privyDid: user?.id ?? '',
    chainIds: getOnboardingChainIds(),
    backendUrl,
    privyToken: privyToken ?? undefined,
  });

  const { requestId, request, loading: requestLoading, error: requestError } = useRequest(backendUrl);
  const deepLink = parseDeepLink();

  // Log request load errors.
  React.useEffect(() => {
    if (requestError) log.error('request-load-failed', { error: requestError });
  }, [requestError]);

  // Auto-unlock or auto-create the session keypair once logged in.
  // - Inside Telegram with no requestId → start() (create if missing).
  // - Anywhere else → unlock() (restore-only, no popup).
  // Skipped for auth requests: AuthHandler calls start() itself.
  const autoKeyStartedRef = React.useRef(false);
  const isAuthRequest = request?.requestType === 'auth';
  React.useEffect(() => {
    if (autoKeyStartedRef.current) return;
    if (!authenticated || !smartAddress || !eoaAddress) return;
    if (delegatedKey.state.status !== 'idle') return;
    if (isAuthRequest) return;
    autoKeyStartedRef.current = true;

    if (isInsideTelegram() && !requestId) {
      delegatedKey.start();
    } else {
      delegatedKey.unlock();
    }
  }, [authenticated, smartAddress, eoaAddress, delegatedKey.state.status, isAuthRequest, requestId]); // eslint-disable-line react-hooks/exhaustive-deps

  let content: React.ReactNode;

  if (!ready) {
    content = <LoadingSpinner />;
  } else if (!authenticated || !privyToken) {
    if (isInsideTelegram() && !tmaLoginTimedOut) {
      content = <LoadingSpinner />;
    } else {
      content = <LoginView />;
    }
  } else if (deepLink && delegatedKey.state.status === 'done') {
    if (deepLink.kind === 'place_bet') {
      content = (
        <PlaceBetHandler
          intentId={deepLink.intentId}
          privyToken={privyToken}
          privyDid={user?.id ?? ''}
          backendUrl={backendUrl}
          installedChainIds={delegatedKey.installedChainIds}
          installOnChain={delegatedKey.installOnChain}
        />
      );
    } else {
      content = (
        <ClosePositionHandler
          positionId={deepLink.positionId}
          privyToken={privyToken}
          privyDid={user?.id ?? ''}
          backendUrl={backendUrl}
          scaAddress={smartAddress as `0x${string}`}
        />
      );
    }
  } else if (deepLink) {
    content = <LoadingSpinner />;
  } else if (!requestId) {
    const delegatedAddress =
      delegatedKey.state.status === 'done' ? delegatedKey.state.record.address : null;
    content = (
      <StatusView
        eoaAddress={eoaAddress}
        smartAddress={smartAddress}
        privyToken={privyToken}
        backendUrl={backendUrl}
        delegatedAddress={delegatedAddress}
        delegationState={delegatedKey.state}
        removeKey={delegatedKey.removeKey}
      />
    );
  } else if (requestLoading) {
    content = <LoadingSpinner />;
  } else if (requestError) {
    content = <FullScreenError message={requestError} showClose />;
  } else if (!request) {
    content = <FullScreenError message="Unknown request type" showClose />;
  } else {
    switch (request.requestType) {
      case 'auth':
        content = (
          <AuthHandler
            request={request}
            privyToken={privyToken}
            backendUrl={backendUrl}
            delegatedKeyState={delegatedKey.state}
            startDelegatedKey={delegatedKey.start}
          />
        );
        break;
      case 'sign': {
        if (request.kind === 'yield_deposit' || request.kind === 'yield_withdraw') {
          content = (
            <YieldDepositHandler
              request={request}
              privyToken={privyToken}
              backendUrl={backendUrl}
              serializedBlob={delegatedKey.serializedBlob}
              mode={request.kind === 'yield_deposit' ? 'deposit' : 'withdraw'}
            />
          );
        } else {
          content = (
            <SignHandler
              request={request}
              privyToken={privyToken}
              backendUrl={backendUrl}
              serializedBlob={delegatedKey.serializedBlob}
              serializedBlobs={delegatedKey.serializedBlobs}
              installedChainIds={delegatedKey.installedChainIds}
              installOnChain={delegatedKey.installOnChain}
              delegationState={delegatedKey.state}
              keyStatus={delegatedKey.state.status}
            />
          );
        }
        break;
      }
      case 'approve':
        content = (
          <ApproveHandler
            request={request}
            privyToken={privyToken}
            backendUrl={backendUrl}
            delegatedKeyState={delegatedKey.state}
            startDelegatedKey={delegatedKey.start}
          />
        );
        break;
      case 'onramp':
        content = <OnrampHandler request={request} />;
        break;
    }
  }

  return (
    <>
      <Toaster position="top-center" richColors closeButton theme="dark" duration={30000} />
      {content}
    </>
  );
}
