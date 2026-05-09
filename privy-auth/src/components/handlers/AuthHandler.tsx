import React from 'react';
import type { AuthRequest, ApproveRequest } from '../../types/miniAppRequest.types';
import type { DelegationState } from '../../hooks/useDelegatedKey';
import { postResponse } from '../../utils/postResponse';
import { toErrorMessage } from '../../utils/toErrorMessage';
import { FullScreenError, FullScreenLoading, FullScreenSuccess } from '../atomics/FullScreen';
import { ApprovalOnboarding } from '../ApprovalOnboarding';
import { createLogger } from '../../utils/logger';

const log = createLogger('AuthHandler');
const CLOSE_DELAY_MS = 1500;
const APPROVE_REQUEST_TTL_SECONDS = 600;

function closeTma() {
  setTimeout(() => window.Telegram?.WebApp?.close(), CLOSE_DELAY_MS);
}

type Phase =
  | { kind: 'posting_auth' }
  | { kind: 'approving'; approveRequestId: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export function AuthHandler({
  request,
  privyToken,
  backendUrl,
  delegatedKeyState,
  startDelegatedKey,
}: {
  request: AuthRequest;
  privyToken: string;
  backendUrl: string;
  delegatedKeyState: DelegationState;
  startDelegatedKey: () => void;
}) {
  const [phase, setPhase] = React.useState<Phase>({ kind: 'posting_auth' });
  const authPostedRef = React.useRef(false);

  // BE returns approveRequestId on first login (no sessionKeyAddress on
  // profile); we hand off to ApprovalOnboarding so the user grants caps
  // before the key installs. Ref-guarded against StrictMode double-fires.
  React.useEffect(() => {
    if (authPostedRef.current) return;
    authPostedRef.current = true;

    log.info('step', { step: 'started', requestId: request.requestId });

    const telegramChatId =
      window.Telegram?.WebApp?.initDataUnsafe?.user?.id?.toString() ??
      request.telegramChatId;

    postResponse(backendUrl, {
      requestId: request.requestId,
      requestType: 'auth',
      privyToken,
      telegramChatId,
    })
      .then((body) => {
        log.info('step', { step: 'submitted', requestId: request.requestId });
        const approveRequestId = (body as { approveRequestId?: string } | null)?.approveRequestId;
        if (approveRequestId) {
          setPhase({ kind: 'approving', approveRequestId });
        } else {
          log.info('step', { step: 'succeeded', requestId: request.requestId });
          setPhase({ kind: 'done' });
          closeTma();
        }
      })
      .catch((err: unknown) => {
        log.error('postResponse failed', { requestId: request.requestId, err: toErrorMessage(err) });
        setPhase({ kind: 'error', message: toErrorMessage(err) });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // BE returns only the requestId; the cached request body lives in
  // miniAppRequestCache. ApprovalOnboarding only reads requestId + subtype,
  // so a synthesized stub is enough. Memoized so its effects don't remount.
  const syntheticApproveRequest = React.useMemo<ApproveRequest | null>(() => {
    if (phase.kind !== 'approving') return null;
    const now = Math.floor(Date.now() / 1000);
    return {
      requestId: phase.approveRequestId,
      requestType: 'approve',
      userId: '',
      subtype: 'session_key',
      createdAt: now,
      expiresAt: now + APPROVE_REQUEST_TTL_SECONDS,
    };
  }, [phase]);

  if (phase.kind === 'error') return <FullScreenError message={phase.message} />;
  if (phase.kind === 'done') return <FullScreenSuccess title="Connected to Aegis" />;

  if (phase.kind === 'approving' && syntheticApproveRequest) {
    return (
      <ApprovalOnboarding
        backendJwt={privyToken}
        delegatedKey={{ state: delegatedKeyState, start: startDelegatedKey }}
        request={syntheticApproveRequest}
      />
    );
  }

  return <FullScreenLoading step={null} />;
}
