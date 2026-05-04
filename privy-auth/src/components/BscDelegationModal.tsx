import React from 'react';
import type { DelegationState } from '../hooks/useDelegatedKey';
import { FullScreen, FullScreenLoading, FullScreenSuccess } from './atomics/FullScreen';
import { ShieldIcon } from './atomics/icons';
import { chainName } from '../utils/chainConfig';
import { createLogger } from '../utils/logger';

const log = createLogger('BscDelegationModal');

interface Props {
  chainId: number;
  installOnChain: (chainId: number) => void;
  delegationState?: DelegationState;
  installedChainIds: number[];
  onCancel: () => void;
}

/**
 * Existing-user top-up flow: a SignRequest arrived for a chain (typically BSC
 * for /stock) where the session key isn't yet installed. We render this modal
 * before SignHandler's auto-sign effect runs so the user signs one Privy popup
 * to enable the new chain, then the trade proceeds.
 */
export function BscDelegationModal({
  chainId,
  installOnChain,
  delegationState,
  installedChainIds,
  onCancel,
}: Props) {
  const triggeredRef = React.useRef(false);
  const [stage, setStage] = React.useState<'intro' | 'installing'>('intro');

  // If install completes, the parent re-renders without us — but show a brief
  // success splash before that happens.
  const installed = installedChainIds.includes(chainId);

  React.useEffect(() => {
    if (installed) {
      log.info('step', { step: 'succeeded', chainId });
    }
  }, [installed, chainId]);

  if (installed) {
    return <FullScreenSuccess title={`${chainName(chainId)} approved`} />;
  }

  if (delegationState?.status === 'error' && stage === 'installing') {
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <p className="text-sm text-red-400 break-all">{delegationState.message}</p>
          <div className="flex gap-2">
            <button
              className="px-4 py-2 rounded border border-white/20 text-white/80 active:bg-white/10 text-sm"
              onClick={() => {
                triggeredRef.current = false;
                setStage('intro');
              }}
            >
              Try again
            </button>
            <button
              className="px-4 py-2 rounded border border-white/20 text-white/60 active:bg-white/10 text-sm"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      </FullScreen>
    );
  }

  if (stage === 'installing') {
    const step =
      delegationState?.status === 'processing' ? delegationState.step : `Approving on ${chainName(chainId)}…`;
    return <FullScreenLoading step={step} />;
  }

  return (
    <FullScreen>
      <div className="flex flex-col items-center gap-5 max-w-sm text-center">
        <ShieldIcon size={64} variant="violet" />
        <div className="flex flex-col gap-1.5">
          <p className="text-white font-semibold text-lg">
            Enable {chainName(chainId)}
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            Approving once for {chainName(chainId)} so the agent can sign trades on this chain on your behalf.
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full">
          <button
            onClick={() => {
              if (triggeredRef.current) return;
              triggeredRef.current = true;
              log.info('step', { step: 'started', chainId });
              setStage('installing');
              installOnChain(chainId);
            }}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-semibold text-sm"
          >
            Approve
          </button>
          <button
            onClick={onCancel}
            className="w-full py-3 rounded-xl border border-white/10 text-white/50 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </FullScreen>
  );
}
