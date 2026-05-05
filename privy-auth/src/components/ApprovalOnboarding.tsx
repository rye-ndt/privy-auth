import React from 'react';
import type { DelegationState } from '../hooks/useDelegatedKey';
import { cloudStorageRemoveItem } from '../utils/telegramStorage';
import { loggedFetch } from '../utils/loggedFetch';
import { toErrorMessage } from '../utils/toErrorMessage';
import { ShieldIcon } from './atomics/icons';
import { Spinner } from './atomics/spinner';
import { chainName, getOnboardingChainIds } from '../utils/chainConfig';
import { createLogger } from '../utils/logger';

const log = createLogger('ApprovalOnboarding');

interface ApprovalParam {
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  suggestedLimitRaw: string; // raw integer (e.g. "500000000" for 500 USDC)
  validUntil: number;        // unix epoch seconds
}

interface ApprovalOnboardingProps {
  backendJwt: string;
  delegatedKey: {
    state: DelegationState;
    start: () => void;
  };
  reapproval?: boolean;
  tokenAddress?: string;
  amountRaw?: string;
  /** Chains to fetch approval params for and post grants on. Defaults to onboarding chain ids. */
  chainIds?: number[];
}

type PerChainParams = Record<number, ApprovalParam[]>;

const backendUrl = (import.meta.env.VITE_BACKEND_URL as string) ?? '';
const CLOSE_DELAY_MS = 1500;

function toHumanAmount(rawStr: string, decimals: number): string {
  try {
    const raw = BigInt(rawStr);
    const divisor = BigInt(10 ** decimals);
    const whole = raw / divisor;
    const fraction = raw % divisor;
    if (fraction === 0n) return whole.toString();
    const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${whole}.${fractionStr}`;
  } catch {
    return rawStr;
  }
}

export function ApprovalOnboarding({
  backendJwt,
  delegatedKey,
  reapproval = false,
  tokenAddress,
  amountRaw,
  chainIds,
}: ApprovalOnboardingProps) {
  const targetChainIds = React.useMemo(
    () => chainIds ?? getOnboardingChainIds(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(chainIds ?? getOnboardingChainIds())],
  );
  const [paramsByChain, setParamsByChain] = React.useState<PerChainParams | null>(null);
  // Flat view used by the rendered list — concatenates all chains' rows.
  // Filter out malformed rows (no symbol/address) so the UI never shows a blank
  // token chip with a nonsensical amount; same filter is enforced at POST time.
  const approvalParams = paramsByChain
    ? targetChainIds.flatMap((cid) =>
        (paramsByChain[cid] ?? []).filter(
          (t) => !!t.tokenAddress && !!t.tokenSymbol && t.tokenSymbol.length > 0,
        ),
      )
    : null;
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [approveClicked, setApproveClicked] = React.useState(false);
  const [posting, setPosting] = React.useState(false);
  const [postError, setPostError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  // Fetch suggested limits from server on mount (forwards optional token/amount filters).
  React.useEffect(() => {
    const qs = tokenAddress && amountRaw
      ? `?tokenAddress=${encodeURIComponent(tokenAddress)}&amountRaw=${encodeURIComponent(amountRaw)}`
      : '';

    let cancelled = false;
    Promise.all(
      targetChainIds.map((cid) =>
        loggedFetch(`${backendUrl}/delegation/approval-params${qs}${qs ? '&' : '?'}chainId=${cid}`, {
          headers: { Authorization: `Bearer ${backendJwt}` },
        })
          .then((r) => {
            if (!r.ok) throw new Error(`Server returned ${r.status}`);
            return r.json() as Promise<{ tokens: ApprovalParam[] }>;
          })
          .then((data) => [cid, data.tokens ?? []] as const),
      ),
    )
      .then((entries) => {
        if (cancelled) return;
        const map: PerChainParams = {};
        for (const [cid, tokens] of entries) map[cid] = tokens;
        setParamsByChain(map);
      })
      .catch((err) => { if (!cancelled) setLoadError(toErrorMessage(err)); });
    return () => { cancelled = true; };
  }, [backendJwt, tokenAddress, amountRaw, targetChainIds]);

  // After the user clicks Approve and the session key is installed, post the limits.
  React.useEffect(() => {
    if (!approveClicked || posting || success) return;
    if (delegatedKey.state.status !== 'done') return;
    if (!paramsByChain) return;

    setPosting(true);
    setPostError(null);

    (async () => {
      try {
        for (const cid of targetChainIds) {
          const tokens = paramsByChain[cid] ?? [];
          // Drop malformed rows (no symbol or no address) — the BE zod schema at
          // POST /delegation/grant requires tokenSymbol.min(1) and would 400 the
          // whole batch. Filtering here keeps a single bad row from killing the
          // chain's entire grant.
          const validTokens = tokens.filter(
            (t) => !!t.tokenAddress && !!t.tokenSymbol && t.tokenSymbol.length > 0,
          );
          if (validTokens.length !== tokens.length) {
            log.warn('grant-dropped-malformed-rows', {
              chainId: cid,
              dropped: tokens.length - validTokens.length,
              kept: validTokens.length,
            });
          }
          if (validTokens.length === 0) {
            log.debug('skip-empty', { chainId: cid });
            continue;
          }
          const delegations = validTokens.map((p) => ({
            tokenAddress: p.tokenAddress,
            tokenSymbol: p.tokenSymbol,
            tokenDecimals: p.tokenDecimals,
            limitRaw: p.suggestedLimitRaw,
            validUntil: p.validUntil,
          }));
          const r = await loggedFetch(`${backendUrl}/delegation/grant`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${backendJwt}`,
            },
            body: JSON.stringify({ delegations, chainId: cid }),
          });
          if (!r.ok) throw new Error(`Backend returned ${r.status} for chain ${cid}`);
          log.info('grant-posted', { chainId: cid, count: delegations.length });
        }
        setSuccess(true);
        setTimeout(() => window.Telegram?.WebApp?.close(), CLOSE_DELAY_MS);
      } catch (err) {
        const msg = toErrorMessage(err);
        log.error('grant-post-failed', { err: msg });
        setPostError(msg);
      } finally {
        setPosting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delegatedKey.state.status, approveClicked, paramsByChain]);

  const handleApprove = () => {
    setApproveClicked(true);
    delegatedKey.start();
  };

  const installing =
    approveClicked &&
    (delegatedKey.state.status === 'processing' || delegatedKey.state.status === 'idle');
  const installError =
    approveClicked && delegatedKey.state.status === 'error'
      ? delegatedKey.state.message
      : null;
  const working = installing || posting;
  const stepperLabel =
    installing && delegatedKey.state.status === 'processing'
      ? (() => {
          const cid = delegatedKey.state.chainId;
          if (cid && targetChainIds.length > 1) {
            const idx = targetChainIds.indexOf(cid) + 1;
            return `${delegatedKey.state.step} (${idx}/${targetChainIds.length})`;
          }
          return delegatedKey.state.step;
        })()
      : null;
  const progressStep =
    stepperLabel ??
    (posting ? 'Saving limits…' : null);

  return (
    <div className="flex flex-col items-center justify-center w-full min-h-dvh bg-[#0f0f1a] px-6 gap-6">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-violet-500/20 blur-2xl scale-150" />
        <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-violet-500/10 border border-violet-500/30">
          <ShieldIcon size={32} />
        </div>
      </div>

      <div className="text-center max-w-xs">
        <h1 className="text-xl font-bold text-white mb-2">
          {reapproval ? 'Renew Spending Limit' : 'Enable Autonomous Trading'}
        </h1>
        <p className="text-sm text-white/40 leading-relaxed">
          {reapproval
            ? 'Your spending limit has been reached. Approve a new limit to let the bot continue trading on your behalf.'
            : targetChainIds.length > 1
              ? `We'll enable the agent on ${targetChainIds.map(chainName).join(' and ')} so you can trade everywhere with one approval. ${targetChainIds.length} quick signatures.`
              : 'To let the bot trade on your behalf, approve the following spending limits (one-time, revocable):'}
        </p>
      </div>

      {!loadError && !success && (
        <div className="w-full max-w-sm flex flex-col gap-3">
          {!approvalParams ? (
            <div className="flex justify-center py-6"><Spinner size="md" /></div>
          ) : approvalParams.length === 0 ? (
            <p className="text-xs text-white/30 text-center">No token limits required.</p>
          ) : (
            approvalParams.map((p) => <TokenLimitRow key={p.tokenAddress} param={p} />)
          )}
        </div>
      )}

      {loadError && !success && (
        <div className="w-full max-w-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-center">
          <p className="text-xs text-red-400 mb-3">{loadError}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-xs text-violet-400 hover:text-violet-300 transition-colors underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {progressStep && (
        <p className="text-xs text-white/40 text-center max-w-xs animate-pulse">{progressStep}</p>
      )}

      {(installError || postError) && (
        <p className="text-xs text-red-400 text-center max-w-xs break-all">
          {installError ?? postError}
        </p>
      )}

      {success && (
        <div className="flex flex-col items-center gap-4 text-center">
          <ShieldIcon size={48} variant="success" />
          <p className="text-white font-semibold">All set!</p>
          <p className="text-sm text-white/40 max-w-xs leading-relaxed">
            The bot is ready to trade on your behalf. Return to Telegram to get started.
          </p>
        </div>
      )}

      {!success && (
        <button
          id="approve-delegation-btn"
          onClick={handleApprove}
          disabled={working || !approvalParams || !!loadError}
          className="w-full max-w-sm py-4 rounded-2xl font-semibold text-[15px] text-white bg-violet-600 hover:bg-violet-500 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_8px_32px_rgba(124,58,237,0.3)] hover:shadow-[0_8px_40px_rgba(124,58,237,0.45)] transition-all duration-150"
        >
          {working ? (
            <span className="flex items-center justify-center gap-2">
              <Spinner size="sm" className="border-white/20 border-t-white" />
              {posting ? 'Saving…' : 'Approving…'}
            </span>
          ) : (
            'Approve'
          )}
        </button>
      )}

      {!success && approvalParams && approvalParams.length > 0 && (
        <p className="text-[11px] text-white/20 text-center max-w-xs leading-relaxed px-2">
          These limits are enforced by the Aegis server. You can revoke access at any time.
        </p>
      )}

      {import.meta.env.DEV && (
        <button
          onClick={async () => {
            await cloudStorageRemoveItem('delegated_key').catch(() => {});
            window.location.reload();
          }}
          className="text-xs text-red-500/50 hover:text-red-400 transition-colors duration-200 underline underline-offset-2 mt-2"
        >
          [dev] Wipe CloudStorage + reload
        </button>
      )}
    </div>
  );
}

function TokenLimitRow({ param }: { param: ApprovalParam }) {
  return (
    <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
          <span className="text-[10px] font-bold text-violet-300">
            {param.tokenSymbol.slice(0, 2)}
          </span>
        </div>
        <span className="text-sm font-bold text-white">{param.tokenSymbol}</span>
      </div>
      <span className="text-sm text-violet-300 font-semibold">
        {toHumanAmount(param.suggestedLimitRaw, param.tokenDecimals)} <span className="font-bold">{param.tokenSymbol}</span>
      </span>
    </div>
  );
}
