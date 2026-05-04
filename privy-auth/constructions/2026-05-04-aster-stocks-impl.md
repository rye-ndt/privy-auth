# Aster tokenized stocks — Frontend implementation plan

**Status:** ready to implement
**Date:** 2026-05-04
**Companion plans:**
- High-level: `fe/privy-auth/constructions/2026-05-04-aster-stocks-plan.md`
- BE companion: `be/constructions/2026-05-04-aster-stocks-impl.md`

This is the step-by-step recipe for the FE side. Each phase ends in a verifiable demo and aligns with the BE plan's phases. **Do not deviate without updating this file and the BE companion.**

---

## Locked invariants (do not change)

- **Avalanche (43114) stays the home chain.** All onboarding messaging, the default `VITE_CHAIN_ID`, and existing handlers continue to assume Avalanche unless an explicit chain is passed.
- **BSC (56) is added as a second supported chain.**
- **Same session-key keypair, two chains.** A user has exactly one session-key private key (already in `telegramStorage`). The same key is registered as a sudo plugin on both Kernel deployments — Avax and BSC. We do **not** generate a second keypair.
- **`aaConfig.ts` (FE) ↔ `aaConfig.ts` (BE) byte-identical.** This continues; nothing changes there.
- **`SignHandler` switches chains per request.** The BE already emits `SignRequest.chainId` per step; the FE must build a chain-correct `sessionKeyClient` on each request transition.
- **`interpretSignError` adds new codes.** New codes are stable contracts shared with the BE — both sides must add the same string in lockstep (per the existing convention in `interpretSignError.ts`).

---

# Phase 1 — Chain registry refactor + read-only support

**Demo:** the mini-app builds with BSC support; existing Avalanche flows behave identically; no new UI yet.

## P1.1 — Refactor `utils/chainConfig.ts` to be multi-chain

**File:** `fe/privy-auth/src/utils/chainConfig.ts`

Today this returns a single chain via env. We need per-chain helpers without breaking existing callers.

Diff plan:

```ts
import { avalanche, avalancheFuji, bsc } from 'viem/chains';
import type { Chain } from 'viem';

interface ChainEntry {
  chain: Chain;
  defaultRpcUrl: string;
  bundlerUrl: string;
  paymasterUrl?: string;
  sponsorshipPolicyId?: string;
}

const CHAIN_REGISTRY: Record<number, ChainEntry> = {
  43114: {
    chain: avalanche,
    defaultRpcUrl: import.meta.env.VITE_CHAIN_RPC_URL as string,
    bundlerUrl: import.meta.env.VITE_PIMLICO_BUNDLER_URL as string,
    paymasterUrl: import.meta.env.VITE_PIMLICO_PAYMASTER_URL as string | undefined,
    sponsorshipPolicyId: import.meta.env.VITE_PIMLICO_SPONSORSHIP_POLICY_ID as string | undefined,
  },
  43113: {
    chain: avalancheFuji,
    defaultRpcUrl: import.meta.env.VITE_CHAIN_RPC_URL as string,
    bundlerUrl: import.meta.env.VITE_PIMLICO_BUNDLER_URL as string,
    paymasterUrl: import.meta.env.VITE_PIMLICO_PAYMASTER_URL as string | undefined,
    sponsorshipPolicyId: import.meta.env.VITE_PIMLICO_SPONSORSHIP_POLICY_ID as string | undefined,
  },
  56: {
    chain: bsc,
    defaultRpcUrl: import.meta.env.VITE_BSC_RPC_URL as string,
    bundlerUrl: import.meta.env.VITE_BSC_PIMLICO_BUNDLER_URL as string,
    paymasterUrl: import.meta.env.VITE_BSC_PIMLICO_PAYMASTER_URL as string | undefined,
    sponsorshipPolicyId: import.meta.env.VITE_BSC_PIMLICO_SPONSORSHIP_POLICY_ID as string | undefined,
  },
};

const DEFAULT_CHAIN_ID = 43114;

function homeChainId(): number {
  return Number(import.meta.env.VITE_CHAIN_ID ?? String(DEFAULT_CHAIN_ID));
}

// ── Backward-compatible helpers (existing callers untouched) ───────────────
export function getChain(): Chain { return getChainById(homeChainId()); }
export function getChainId(): number { return homeChainId(); }
export function getRpcUrl(): string { return getRpcUrlById(homeChainId()); }

// ── New chain-aware helpers ────────────────────────────────────────────────
export function getChainById(chainId: number): Chain {
  const e = CHAIN_REGISTRY[chainId];
  if (!e) throw new Error(`Unsupported chain ID: ${chainId}`);
  return e.chain;
}
export function getRpcUrlById(chainId: number): string {
  const e = CHAIN_REGISTRY[chainId];
  if (!e?.defaultRpcUrl) throw new Error(`No RPC configured for chain ${chainId}`);
  return e.defaultRpcUrl;
}
export function getBundlerUrl(chainId: number): string {
  const e = CHAIN_REGISTRY[chainId];
  if (!e?.bundlerUrl) throw new Error(`No bundler configured for chain ${chainId}`);
  return e.bundlerUrl;
}
export function getPaymasterUrl(chainId: number): string | undefined {
  return CHAIN_REGISTRY[chainId]?.paymasterUrl;
}
export function getSponsorshipPolicyId(chainId: number): string | undefined {
  return CHAIN_REGISTRY[chainId]?.sponsorshipPolicyId;
}
export function isSupportedChain(chainId: number): boolean {
  return chainId in CHAIN_REGISTRY;
}

// ── Existing helpers stay, with optional chainId override ─────────────────
export function buildExplorerUrl(chainId: number, txHash: string): string {
  const chain = CHAIN_REGISTRY[chainId]?.chain;
  const baseUrl = chain?.blockExplorers?.default?.url ?? 'https://snowtrace.io';
  return `${baseUrl}/tx/${txHash}`;
}
export function chainName(chainId: number): string {
  return CHAIN_REGISTRY[chainId]?.chain?.name ?? `Chain ${chainId}`;
}
```

**Critical:** keep `getChain()`, `getChainId()`, `getRpcUrl()` exported with current signatures. Every existing call site reads home-chain config, which is what we want — no diff at call sites in this phase.

## P1.2 — Vite env additions

**File:** `fe/privy-auth/.env.example` (and the deployed env)

Add:
```
VITE_BSC_RPC_URL=https://bsc.publicnode.com
VITE_BSC_PIMLICO_BUNDLER_URL=                # populate from Pimlico dashboard for BSC
VITE_BSC_PIMLICO_PAYMASTER_URL=
VITE_BSC_PIMLICO_SPONSORSHIP_POLICY_ID=
```

**Action item:** create a Pimlico project entry for BSC mainnet, copy URLs. Document in deployment runbook.

If `VITE_BSC_PIMLICO_BUNDLER_URL` is empty, the FE should refuse to send a BSC userOp at runtime (clean error: "BSC chain is not configured in this build"). Add this guard inside `createSessionKeyClient` (P1.4).

## P1.3 — Refactor `createSudoClient` to accept `chainId`

**File:** `fe/privy-auth/src/utils/createSudoClient.ts`

Change signature:

```ts
// Before:
export async function createSudoClient(
  provider: EIP1193Provider,
  signerAddress: `0x${string}`,
  bundlerRpc: string,
  paymasterUrl?: string,
  sponsorshipPolicyId?: string,
): Promise<KernelAccountClient>

// After:
export async function createSudoClient(
  provider: EIP1193Provider,
  signerAddress: `0x${string}`,
  chainId: number,
): Promise<KernelAccountClient>
```

Inside:
- `const chain = getChainById(chainId);`
- `const rpcUrl = getRpcUrlById(chainId);`
- `const bundlerRpc = getBundlerUrl(chainId);`
- `const paymasterUrl = getPaymasterUrl(chainId);`
- `const sponsorshipPolicyId = getSponsorshipPolicyId(chainId);`

**Update all call sites** (search `createSudoClient(` across `src/`):
- `SignHandler.tsx` `getSudoClient` callback — use the current request's `chainId`.
- `YieldDepositHandler.tsx` — same.
- Any test/mock — pass `getChainId()` (home chain default).

The bundler URL constants at the top of `SignHandler.tsx` (`BUNDLER_URL`, `PAYMASTER_URL`, `SPONSORSHIP_ID`) are now unused — delete them.

## P1.4 — Refactor `createSessionKeyClient` to accept `chainId`

**File:** `fe/privy-auth/src/utils/crypto.ts` (where `createSessionKeyClient` lives — verify this)

```ts
// Current signature (verify):
export async function createSessionKeyClient(
  serializedBlob: string,
  bundlerRpc: string,
  paymasterUrl?: string,
  sponsorshipPolicyId?: string,
): Promise<KernelAccountClient>

// New signature:
export async function createSessionKeyClient(
  serializedBlob: string,
  chainId: number,
): Promise<KernelAccountClient>
```

Inside, resolve chain/rpc/bundler from `chainConfig` helpers. Throw a clean error if `getBundlerUrl(chainId)` returns empty (BSC misconfigured build).

**Update all call sites.** The most important is `SignHandler.tsx` — both the fast-path and any retry path. Cache invalidation: `sessionClientRef` must be **per-chainId**. Replace the single ref with a `Map<number, SessionClient>`:

```ts
const sessionClientByChainRef = React.useRef<Map<number, SessionClient>>(new Map());

const getSessionClient = async (chainId: number): Promise<SessionClient> => {
  let c = sessionClientByChainRef.current.get(chainId);
  if (c) return c;
  c = await createSessionKeyClient(serializedBlob!, chainId);
  sessionClientByChainRef.current.set(chainId, c);
  return c;
};
```

Apply the same pattern to `sudoClientByChainRef` in handlers that build a sudo client.

## P1.5 — `SignHandler.tsx`: route per-request chainId

**File:** `fe/privy-auth/src/components/handlers/SignHandler.tsx`

The auto-sign effect already runs per-`currentRequest`. Two changes:

1. Read `currentRequest.chainId` (already on the type — see `types/miniAppRequest.types.ts`); fall back to `getChainId()` (home chain) only if absent.
2. Pass `chainId` into `getSessionClient(chainId)` and `getSudoClient(chainId)` in both auto-sign and manual-sign paths.

Add log metadata `chainId` to every `log.info`/`log.debug` in this file. Also add to `log.warn`/`log.error`.

Verify the existing payload-level dedupe (`recentBroadcasts.ts`) keys on `(to, value, data)` — confirm it doesn't accidentally collide across chains. If it does, append `chainId` to the key. Likely it doesn't collide because each chain's bundler/RPC is distinct, but worth a 2-line check.

## P1.6 — `YieldDepositHandler.tsx` chain plumbing

**File:** `fe/privy-auth/src/components/handlers/YieldDepositHandler.tsx`

Same per-request `chainId` fallback. Yield is currently Avax-only; this is forward-compatibility — pass `request.chainId ?? getChainId()` to `createSudoClient`.

## P1.6.note — BSC visibility on existing flows

The FE's chainConfig adding chain 56 doesn't enable any new user flow on its own — every existing handler reads home chain (43114) by default. But verify before merging phase 1:

- `/swap` UI doesn't expose BSC as a destination until phase 2 (BE gates this via `relayEnabled` — phase 1 ships with `relayEnabled: false` for BSC, phase 2 flips it).
- No existing component iterates the FE chain registry to render a chain selector. (As of 2026-05-04 this is true — verify with `grep -rn "CHAIN_REGISTRY" src/`.)
- `buildExplorerUrl(56, ...)` resolves to BscScan via viem's `bsc.blockExplorers.default.url`. Smoke-test this returns a usable URL.

## P1.7 — Phase 1 acceptance gate

- [ ] `pnpm build` succeeds with no new warnings.
- [ ] Every existing happy-path flow (`/send`, `/swap`, `/yield`, onboarding) works on Avax with no behavioral change.
- [ ] `BUNDLER_URL` / `PAYMASTER_URL` / `SPONSORSHIP_ID` constants no longer appear in any handler file.
- [ ] Manual smoke: run a `/send 0.01 USDC @someone` on test mainnet — completes as before.
- [ ] `interpretSignError`'s existing tests continue to pass.

---

# Phase 2 — Multi-chain delegation + buy/short execution

**Demo:** a fresh user onboards with two delegation signatures (Avax then BSC). Existing user typing `/stock buy $1 AAPL` is shown a one-time BSC delegation modal, accepts, and the buy proceeds — three sign requests in one mini-app session.

## P2.1 — `useDelegatedKey` two-chain install

**File:** `fe/privy-auth/src/hooks/useDelegatedKey.ts`

Today this hook installs the session key on the home chain via `installSessionKey` (in `crypto.ts`). We extend it to support a list of chain IDs.

API change:

```ts
export function useDelegatedKey(options: {
  smartAccountAddress: string;
  signerAddress: string;
  signerWallet: ConnectedWallet | undefined;
  privyDid: string;
  /** Chain IDs to install on. Defaults to [getChainId()]. Passing two installs sequentially. */
  chainIds?: number[];
}): {
  state: DelegationState;
  start: () => void;
  unlock: () => void;
  removeKey: () => Promise<void>;
  serializedBlob: string | null;
  /** Chain IDs the current keypair is verified-installed on. */
  installedChainIds: number[];
  /** Trigger an install on a chain that isn't in installedChainIds yet. */
  installOnChain: (chainId: number) => void;
};
```

`DelegationState` extension:

```ts
type DelegationState =
  | { status: 'idle' }
  | { status: 'processing'; step: string; chainId?: number }
  | { status: 'done'; record: DelegationRecord; installedChainIds: number[] }
  | { status: 'error'; message: string; chainId?: number };
```

Implementation notes:
- The keypair generation step (`generateKeypair`) runs once per user. The encrypted blob in `telegramStorage` includes the private key (already does — see `applyDecryptedBlob`).
- **Do NOT refactor `installSessionKey`'s signature.** It already takes a chain-bound sudo `KernelAccountClient`. The chainId is implicit in the client. The change is at the **call site** inside `useDelegatedKey`: build the sudo client per chain via `createSudoClient(provider, eoa, chainId)` (now chainId-aware after P1.3), then pass it to the existing `installSessionKey(sudoClient, ephemeralPubkey)`. No internal changes to `installSessionKey` itself.
- For the two-chain install during onboarding, run them sequentially — the user signs two Privy popups. Show progress state ("Installing on Avalanche…" → "Installing on BNB Chain…").
- After both succeed, persist `installedChainIds: [43114, 56]` in the encrypted blob's metadata so we can avoid re-installing on next session.

## P2.2 — Onboarding flow update

**File:** `fe/privy-auth/src/components/ApprovalOnboarding.tsx` (or whichever file owns the eager-grant flow — search for callers of `useDelegatedKey`)

Two-step UI:

1. After Privy auth completes, present the "Approve Aegis to act on your behalf" screen. Copy: "We'll install the agent on **Avalanche** and **BNB Chain** so you can trade stocks. Two quick signatures."
2. Trigger `useDelegatedKey({ chainIds: [43114, 56] })`. Render a stepper showing 1/2 → 2/2.
3. On `done`, post both delegation grants to the BE — one per chain. The existing `postResponse` flow with `ApproveResponse.delegationRecord` carries Avax; we need a sibling POST for BSC. Two options:
   - **(A)** Single `ApproveResponse.delegationRecord` carrying an array of (chainId, signerAddress) tuples. Requires BE schema change.
   - **(B)** Two sequential POSTs to `/delegation/grant?chainId=…`. No schema change.
   Pick **(B)** — minimal BE plumbing, clearer in logs.

Add a hook `useMultiChainDelegationPost(record, chainIds)` that sends the per-chain POSTs with the same record but per-chain `tokenDelegations` payload.

## P2.3 — Existing-user BSC top-up modal

**New component:** `fe/privy-auth/src/components/BscDelegationModal.tsx`

Trigger: `SignHandler` detects a `request.chainId === 56` for a user whose `installedChainIds` doesn't include 56. Render this modal **before** the auto-sign effect runs.

Skeleton:

```tsx
export function BscDelegationModal({
  onComplete, onCancel, signerAddress, smartAccountAddress, privyDid,
}: { ... }) {
  const { state, start, installOnChain, installedChainIds } = useDelegatedKey({
    smartAccountAddress, signerAddress, signerWallet, privyDid,
    chainIds: [getChainId()],   // already installed
  });

  React.useEffect(() => {
    if (!installedChainIds.includes(56)) installOnChain(56);
  }, [/* once */]);

  if (state.status === 'done' && installedChainIds.includes(56)) {
    React.useEffect(() => onComplete(), []);
    return <FullScreenSuccess title="Stock trading enabled" />;
  }
  if (state.status === 'error') return <FullScreenError message={state.message} />;
  return <FullScreenLoading message="Approving once for BNB Chain stock trading…" />;
}
```

In `SignHandler.tsx`:

```tsx
const needsBscApproval =
  currentRequest.chainId === 56 &&
  !installedChainIds.includes(56);

if (needsBscApproval) {
  return <BscDelegationModal
    signerAddress={embedded.address as `0x${string}`}
    smartAccountAddress={smartAccountAddress}
    privyDid={privyDid}
    onComplete={() => setNeedsBscApproval(false)}   // re-render proceeds to auto-sign
    onCancel={() => sendReject()}
  />;
}
```

Plumbing: `SignHandler` doesn't currently know `installedChainIds` — thread it through from `App.tsx` where `useDelegatedKey` is called.

## P2.4 — Error classifier additions

**File:** `fe/privy-auth/src/utils/interpretSignError.ts`

Add to `SignErrorCode`:

```ts
| 'aster_pair_inactive'
| 'aster_min_size'
| 'aster_max_position'
| 'aster_oracle_stale'
| 'aster_insufficient_collateral'
| 'stock_recovery_failed'
```

Add to `PATTERNS` (place above `unknown` fallback):

```ts
{
  test: /pair.*inactive|PAIR_INACTIVE/i,
  friendly: 'This stock pair is not currently tradable. Try a different symbol or try again later.',
  code: 'aster_pair_inactive',
},
{
  test: /below.*minimum|MIN_TRADE_SIZE|41535345545f4d494e/i,   // hex of "ASSET_MIN" placeholder; refine after seeing first revert
  friendly: 'Trade size is below the minimum. Try a larger amount.',
  code: 'aster_min_size',
},
{
  test: /max.*position|POSITION_LIMIT/i,
  friendly: 'You\'ve hit the per-user position limit for this asset.',
  code: 'aster_max_position',
},
{
  test: /oracle.*stale|STALE_PRICE/i,
  friendly: 'Stock price oracle is stale. Please try again in a moment.',
  code: 'aster_oracle_stale',
},
{
  test: /insufficient.*collateral|amountIn.*too.*low/i,
  friendly: 'Bridge delivered less USDC than expected. Returning your funds…',
  code: 'aster_insufficient_collateral',
},
```

**Action item at impl time:** after first cohort of test trades, capture the actual revert strings emitted by the Diamond and refine these patterns. Initial regexes are best-guess.

The BE must add the same code strings to `notifyResolved.ts` (see BE plan **P2.5b** for the explicit branch table). Lockstep — failing to mirror is a merge blocker.

## P2.5 — Result screens & recovery flow (per the corrected BE design)

**Files:** wherever the current swap/yield "transaction submitted" UI is rendered (search `txHash` in `components/`). Verify the existing screen handles a `chainId` prop so `buildExplorerUrl(chainId, txHash)` resolves to BscScan for BSC steps.

**Recovery is NOT chained inside the same mini-app session.** The BE plan was corrected (see `be/.../impl.md` P2.5 "Recovery flow CORRECTED design"): on a venue-leg failure, the BE emits an error chat **plus a fresh `mini_app` artifact** for the return swap. The user's mini-app shows the error screen for the failed open (existing behaviour), they close it, see the chat in Telegram, tap the new mini-app button, and the recovery executes in its own short session.

**FE consequence:** zero new code for the recovery flow. The existing failure screen + the existing fresh-mini-app entry point handle it. We only need to make sure the failure screen's `interpretSignError` mapping for `aster_*` codes shows useful copy (covered in P2.4) and that the next mini-app session opens cleanly with the recovery `SignRequest` (already works — it's a standard fresh session).

**Stretch (out of scope):** for a future "zero-tap auto-recovery" UX, extend `fetchNextRequest` to poll on terminal failure too. v0 explicitly does not do this.

## P2.6 — Phase 2 acceptance gate

- [ ] Fresh-user onboarding: two Privy popups in sequence, success screen reads "approved on Avalanche and BNB Chain."
- [ ] Encrypted blob in `telegramStorage` carries `installedChainIds: [43114, 56]`.
- [ ] Existing-user `/stock buy $1 AAPL`: BSC modal renders first, single Privy popup, then auto-sign proceeds.
- [ ] Three auto-sign userOps, each with the right `chainId`, complete in one mini-app session.
- [ ] Final screen shows BscScan link (`https://bscscan.com/tx/...`) for the open tx.
- [ ] Forced revert path: error screen renders friendly Aster copy (`aster_*` codes mapped). User closes mini-app, Telegram chat shows recovery prompt, tap opens a **fresh** mini-app session that single-step autosigns the return swap. **Recovery is not chained in the same session** — by design.
- [ ] No `console.*` calls; all logs include `chainId`, `requestId`.
- [ ] `aaConfig.ts` (FE) ↔ `aaConfig.ts` (BE) re-grep matches.

---

# Phase 3 — Close, SL/TP, no FE work for `/positions`

`/positions` lives on the chat surface — the BE's `get_stock_positions` agent tool produces the table; the LLM produces the paragraph. **No FE component for this in v0.**

## P3.1 — Close path

The close flow is two BSC sign requests (close + return swap), both autosigned. The existing `SignHandler` chain-switch logic from phase 2 covers this verbatim. No new FE work required if phase 2 is correct — but verify with the e2e test below.

## P3.2 — SL/TP path

Same — single BSC sign request per update, autosigned. The disambiguation keyboard (when multiple positions for one symbol) is rendered by Telegram natively; no mini-app surface.

## P3.3 — Phase 3 acceptance gate

- [ ] `/stock close TSLA` (single position) executes two BSC userOps in one mini-app session, ends on BscScan + Snowtrace links.
- [ ] `/stock close AAPL` (multiple positions) shows Telegram inline keyboard; mini-app opens after the user taps a position.
- [ ] `/stock sl AAPL 150` updates SL only — BscScan link visible, no other side effects.

---

# Cross-cutting checklists

## Logging conventions (apply at every step)

Per the FE logging rules in CLAUDE.md:

- New scopes: `useMultiChainDelegationPost`, `BscDelegationModal`. Existing scopes (`SignHandler`, `useDelegatedKey`, `createSudoClient`, `crypto`) gain `chainId` metadata on every relevant log line.
- Per CLAUDE.md: `warn` and `error` toast via Sonner. Aster errors that are user-actionable (try larger / try again) MUST be `warn`, not `error`. Mirrors the Relay solver precedent.
- Step events on `BscDelegationModal`: `started`, `signing`, `succeeded`, `failed`.
- Catch blocks: extract the message via `instanceof Error` check, then `log.error('action-failed', { requestId, chainId, err: msg })`.

## Tests / smoke matrix

After each phase, run this checklist on test mainnet:

| Phase | Test | Expected |
|---|---|---|
| 1 | `/send 0.01 USDC @x` | Avax flow unchanged |
| 1 | Build size check | No size regression > 5% |
| 2 | `/stock buy $1 AAPL` (fresh user) | 2-step onboarding then 3 sign reqs |
| 2 | `/stock buy $1 AAPL` (existing user) | BSC modal then 3 sign reqs |
| 2 | `/stock buy $1 AAPL` then force open revert | Friendly recovery msg + return |
| 3 | `/stock close TSLA` | 2 sign reqs, BscScan + Snowtrace |
| 3 | `/stock sl AAPL 150` | 1 sign req, SL updated |

## Risk register (FE-specific)

| Risk | Mitigation |
|---|---|
| Pimlico BSC bundler URL not configured at build time | Hard error in `createSessionKeyClient(56)`; surfaced as `service_unavailable` to the user. Add a runtime sanity check in `App.tsx` that warns to console (not toast) if BSC env is incomplete on a build flagged for stocks. |
| User dismisses BSC modal mid-flow | `sendReject()` is called on cancel; BE's `/stock` flow ends cleanly. Re-running the command re-triggers the modal. |
| Session client cache bug (wrong chain executes) | Per-chain `Map<number, SessionClient>` ref keyed in P1.4. Add an assertion in `getSessionClient(chainId)`: `if (client.chain.id !== chainId) throw ...`. |
| `installedChainIds` lies (key was rotated server-side) | Worst case: the userOp reverts with `session_key_invalid`; existing classifier handles it ("re-link"). Document as known. |
| `interpretSignError` patterns wrong on first contact | Patterns refined after first batch of real reverts; ship phase 2 to a small cohort first. |

## File-creation summary

| Phase | Path | Action |
|---|---|---|
| 1 | `fe/privy-auth/src/utils/chainConfig.ts` | edit — multi-chain registry + new helpers |
| 1 | `fe/privy-auth/.env.example` | edit — `VITE_BSC_*` |
| 1 | `fe/privy-auth/src/utils/createSudoClient.ts` | edit — accept `chainId` |
| 1 | `fe/privy-auth/src/utils/crypto.ts` (or wherever `createSessionKeyClient` is) | edit — accept `chainId`; refactor `installSessionKey` similarly |
| 1 | `fe/privy-auth/src/components/handlers/SignHandler.tsx` | edit — per-chain session client cache |
| 1 | `fe/privy-auth/src/components/handlers/YieldDepositHandler.tsx` | edit — per-request `chainId` plumbing |
| 1 | `fe/privy-auth/status.md` | append — chain registry refactor notes |
| 2 | `fe/privy-auth/src/hooks/useDelegatedKey.ts` | edit — `chainIds` option, `installedChainIds`, `installOnChain` |
| 2 | `fe/privy-auth/src/utils/crypto.ts` | edit — `installSessionKey(provider, eoa, chainId)` |
| 2 | `fe/privy-auth/src/components/ApprovalOnboarding.tsx` | edit — two-step copy + stepper |
| 2 | `fe/privy-auth/src/hooks/useMultiChainDelegationPost.ts` | new |
| 2 | `fe/privy-auth/src/components/BscDelegationModal.tsx` | new |
| 2 | `fe/privy-auth/src/components/handlers/SignHandler.tsx` | edit — render BSC modal before auto-sign when needed |
| 2 | `fe/privy-auth/src/utils/interpretSignError.ts` | edit — six new codes + patterns |
| 2 | `fe/privy-auth/src/App.tsx` | edit — thread `installedChainIds` into `SignHandler` |
| 2 | `fe/privy-auth/status.md` | append — multi-chain delegation conventions |
| 3 | (no new FE files; verify phase 2 covers it) | — |

## Final commit checklist

- [ ] `status.md` updated with: chain registry refactor (P1), multi-chain delegation flow (P2), error code additions (P2), `installedChainIds` semantics.
- [ ] `aaConfig.ts` byte-identical to BE — re-grep before merging.
- [ ] No `console.*` in any new file; all logs through `createLogger`.
- [ ] BSC env vars present in deployment runbook.
- [ ] Manual smoke on a live mainnet test account before opening to other users.
- [ ] BE PR's `interpretSignError` mirror codes confirmed (lockstep).
