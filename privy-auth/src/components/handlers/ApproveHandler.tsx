import type { ApproveRequest } from '../../types/miniAppRequest.types';
import type { DelegationState } from '../../hooks/useDelegatedKey';
import { ApprovalOnboarding } from '../ApprovalOnboarding';

export function ApproveHandler({
  request,
  privyToken,
  delegatedKeyState,
  startDelegatedKey,
}: {
  request: ApproveRequest;
  privyToken: string;
  backendUrl: string;
  delegatedKeyState: DelegationState;
  startDelegatedKey: () => void;
}) {
  return (
    <ApprovalOnboarding
      backendJwt={privyToken}
      delegatedKey={{ state: delegatedKeyState, start: startDelegatedKey }}
      reapproval={request.reapproval === true}
      tokenAddress={request.tokenAddress}
      amountRaw={request.amountRaw}
      request={request}
    />
  );
}
