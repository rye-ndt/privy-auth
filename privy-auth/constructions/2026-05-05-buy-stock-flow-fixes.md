# Buy-stock flow — patch plan (FE)

Date: 2026-05-05
Scope: frontend (Telegram mini-app) fixes for the `/stock buy` flow. Pair to `be/constructions/2026-05-05-buy-stock-flow-fixes.md`. Do not touch `/swap`, `/send`, `/yield`, onramp, or auth flows beyond what is explicitly listed.

---

## Priority legend

- **P0** — blocks the FE side of the `/stock buy` happy path or causes a stuck mini-app.
- **P1** — UX polish / correctness for edge paths.
- **P2** — defensive.

---

## P0.1 — BSC session-key install race in `SignHandler`

**Problem.** `SignHandler.tsx` line 124–127:
```ts
const needsCrossChainApproval =
  !!installedChainIds &&
  installedChainIds.length > 0 &&
  !installedChainIds.includes(reqChainIdForGate);
```
When the user's session-key blob is still being decrypted (`useDelegatedKey.unlock` in flight), `installedChainIds` is `[]` and `needsCrossChainApproval` evaluates **false**. Auto-sign starts, `getSessionClient(56)` throws "no session-key blob for chain 56", and the user lands on the auto-sign-error full-screen instead of the `BscDelegationModal`.

The current `keyStatus === 'processing'` short-circuit at line 140 only fires when `serializedBlob` is null — for users who DO have a home-chain blob but no BSC blob, the gate misfires.

**Files**
- `fe/privy-auth/src/components/handlers/SignHandler.tsx`

**Change**

1. Treat "key still loading" as a no-decision state for the cross-chain gate:
   ```ts
   const keyMachineSettled =
     keyStatus === 'done' || keyStatus === 'idle' || keyStatus === 'error';
   const needsCrossChainApproval =
     keyMachineSettled &&
     !!installedChainIds &&
     !installedChainIds.includes(reqChainIdForGate);
   ```
   Drop the `installedChainIds.length > 0` condition. With the settled gate, an empty array on a `done` state means "no chains installed at all" → the modal correctly fires.

2. Inside the auto-sign effect, **before** `getSessionClient(reqChainId)`, check whether `serializedBlobs?.[reqChainId]` is missing AND the key machine is settled. If so, do not start the sign — return early; the gate above will render `BscDelegationModal`.
   ```ts
   if (!serializedBlobs?.[reqChainId] && keyMachineSettled) {
     // Cross-chain gate above is responsible for surfacing the install modal.
     return;
   }
   ```

3. Add structured log on the new branch: `log.info('cross-chain-gate-await', { reqChainId, keyStatus, installedChainIds })`. Level `info` because the user will see UI state change.

**Test plan**
- Cold-start with stored home-chain-only blob, fire BSC sign request → modal appears, no auto-sign attempt.
- Cold-start with stored multi-chain blob → no modal, auto-sign proceeds.
- No stored key + Telegram cloud-storage delay (simulate via `cloudStorageGetItem` 3s sleep) → no premature auto-sign-error screen.

**Scope guard.** Do not change the manual-sign fallback or `AUTO_SIGN_TIMEOUT_MS`. The single-chain happy path stays identical.

---

## P0.2 — Clarify "you're buying a stock" in modal copy

**Problem.** A user typing "buy AAPL" or `/stock buy $10 AAPL` gets a mini-app titled "Open stock position" that doesn't disambiguate from a hypothetical AAPL token. The BE side (BE plan §P0.5) adds a "What this is" line to the preview; the FE has its own copy in `SigningRequestModal.tsx` and `SignHandler.tsx` that needs to match.

**Files**
- `fe/privy-auth/src/components/SigningRequestModal.tsx`
- `fe/privy-auth/src/components/handlers/SignHandler.tsx` (the `description` text comes from `request.description` so changes here are minimal — verify rendering)
- `fe/privy-auth/src/components/atomics/FullScreen.tsx` (no edit; verify the preview block renders the new field)

**Change**

1. In `SigningRequestModal`, when the rendered `preview.verb` is `stock_buy`, render a prominent disclaimer band at the top of the modal:
   ```tsx
   {preview.verb === 'stock_buy' && (
     <div className="bg-violet-500/10 border border-violet-500/30 text-violet-100 text-xs p-2 rounded-lg leading-relaxed">
       <strong>Synthetic stock perp.</strong> This opens a USDC-settled position
       that tracks the stock price on Aster (BSC). It is NOT the company's actual shares.
     </div>
   )}
   ```
2. In `SignHandler`'s waiting-screen body (the `!showManual` branch around line 378), when the request `description` matches `/^Open stock position/i` (or a future flag on `SignRequest.preview.verb`), render the same disclaimer above the action card.

3. Add a `verb?: string` field to the FE-side `SignRequest` type if not already present, sourced from `preview.verb`. This is read-only on FE; the BE already stamps it.

**Test plan**
- `/stock buy $10 AAPL` → modal shows disclaimer band.
- `/swap 1 USDC to USDT` → no disclaimer (other verbs unaffected).
- Visual: disclaimer must not push action button below the fold on iPhone SE viewport.

**Scope guard.** Do not change `swap`, `send`, `yield`, or `auth` modal copy.

---

## P0.3 — Onboarding: install BSC eagerly when bundler is configured

**Problem.** `getOnboardingChainIds()` in `chainConfig.ts` already adds chain `56` when `CHAIN_REGISTRY[56]?.bundlerUrl` is set. Confirm this is actually firing in production:

1. Verify `VITE_BSC_BUNDLER_URL` is set in `.env.production` and `.env.staging`.
2. Verify `useDelegatedKey.start()` runs `createAndStore(chainIdsToInstall)` with `[homeChainId, 56]` for new users.
3. Existing users with a single-chain blob WILL still hit the `BscDelegationModal` lazy path — that is the documented contract; no change needed beyond P0.1's fix to the gate.

**Files**
- `fe/privy-auth/src/utils/chainConfig.ts` (READ ONLY — verify behaviour, no edit unless misconfigured)
- `fe/privy-auth/.env.example` — add `VITE_BSC_BUNDLER_URL=` placeholder if missing.
- `fe/privy-auth/src/hooks/useDelegatedKey.ts` (READ ONLY)

**Change**

1. In `App.tsx`, after `useDelegatedKey` returns `state.status === 'done'`, log `installedChainIds` at debug to confirm BSC is included on fresh installs.
2. If `VITE_BSC_BUNDLER_URL` is not configured at build time, render a one-time warning in dev mode in the StatusView:
   ```tsx
   {import.meta.env.DEV && !CHAIN_REGISTRY[56]?.bundlerUrl && (
     <div className="text-xs text-amber-400 p-2">
       BSC bundler not configured — /stock will require an extra approval per session.
     </div>
   )}
   ```
3. Do **not** change the install order or block onboarding on BSC failure. If the BSC install throws, log and continue with the home-chain blob; the lazy modal will retry on first stock request.

**Test plan**
- Fresh user, `VITE_BSC_BUNDLER_URL` set → `installedChainIds` includes 56 after onboarding.
- Fresh user, `VITE_BSC_BUNDLER_URL` empty → onboarding succeeds with home-chain only; first `/stock buy` triggers `BscDelegationModal`.
- Existing user with single-chain blob → unchanged (lazy modal flow).

**Scope guard.** Do not modify the install loop in `useDelegatedKey.createAndStore` to swallow per-chain errors silently — the existing throw is correct. We only add observability + dev-mode warning.

---

## P0.4 — `interpretSignError` mappings for stock-specific reverts

**Problem.** When the venue-leg `openMarketTrade` reverts (insufficient delivered USDC, invalid pair, oracle stale), the FE shows the raw viem error in the auto-sign-error screen. The user has no actionable next step. The BE plan adds `notifyResolved` branches but those fire only after the BE sees the rejection; the FE-rendered modal text is the first thing the user reads.

**Files**
- `fe/privy-auth/src/utils/interpretSignError.ts`

**Change**

Add detection branches (string match on the raw error message — same pattern as existing `BAL#` checks):

```ts
// Aster: insufficient collateral after bridge slippage.
if (/transfer.*amount.*exceeds.*balance/i.test(raw)) {
  return {
    code: 'stock_collateral_short',
    friendly:
      'Bridge delivered slightly less than the trade needed. Your USDC is on BSC — tap "Return Funds" in the next chat message to get it back to Avalanche.',
    raw,
  };
}
// Aster: pair / oracle off
if (/pairBase|oracle|stale/i.test(raw)) {
  return {
    code: 'stock_oracle_unavailable',
    friendly:
      'The stock price feed is currently unavailable. The market may be closed. Try again later.',
    raw,
  };
}
```

Mirror the new codes in the BE's `notifyResolved` branches (see BE plan §P0.4) so chat messaging stays in lockstep with the modal text.

**Test plan**
- Force a `transferFrom exceeds balance` revert in dev → user sees the "Bridge delivered slightly less" copy, not the raw bytes.
- Existing reverts (user_rejected, AA21, BAL#) → unchanged.

**Scope guard.** Don't reorder existing branches; append new branches at the bottom.

---

## P0.5 — `/buy <stock>` reroute card click-through

**Problem.** BE plan §P0.3 emits a chat with one inline button ("Buy 100 USD of AAPL stock") whose callback is `stock:reroute:<symbol>`. The FE rendering layer needs to display this normally; no FE change required if the chat artifact uses standard inline-keyboard rendering.

**Verification only.** Confirm `result_card` and `chat` artifact renderers handle a one-button `nextActions` keyboard with kind `callback`. No file changes expected — open ticket if the button does not render.

**Files**
- READ ONLY — `fe/privy-auth/src/components/views/*` and the result-card renderer.

**Action.** Run `/buy 100 AAPL` end-to-end in dev; if the inline button doesn't render, file a follow-up scoped to the chat-artifact renderer (do not patch in this batch).

---

## P1.1 — `installedChainIds` on-chain verification

**Problem.** `installedChainIds` comes from the locally stored blob. After a Privy account reset or session-key revocation, the stored array can claim BSC is installed when it isn't.

**Files**
- `fe/privy-auth/src/hooks/useDelegatedKey.ts`
- `fe/privy-auth/src/utils/crypto.ts` (read existing `verifySessionKeyInstalled` if present; else add)

**Change**

When restoring a stored blob, before `dispatch({ type: 'DONE', ... installedChainIds: restored.installed })`, optionally run a lightweight on-chain `eth_call` (or kernel `getValidator`) per chain to confirm the validator is still installed. Cache result for the session. If the on-chain check fails, drop the chain from `installedChainIds` and let the lazy `BscDelegationModal` re-install.

This is **P1** because the session-key install is idempotent — re-installing on a chain where the key is already present is a no-op-ish Privy popup. Annoying, not broken.

**Defer note.** If the on-chain check adds >300ms to unlock, gate it behind `import.meta.env.VITE_VERIFY_INSTALLED === 'true'` and ship disabled by default.

**Test plan**
- Manually revoke the BSC session key with a sudo client, reload mini-app → `installedChainIds` no longer claims 56.

**Scope guard.** Do not block unlock on the verification call — fire it in the background and dispatch a `RESYNC` action when results return.

---

## P1.2 — Drop stale per-chain session client on error

**Problem.** When `getSessionClient(reqChainId)` succeeds but `sendTransaction` reverts, the cached `KernelAccountClient` may carry stale validator state. The post-success branch already invalidates via `sessionClientByChainRef.current.delete(reqChainId)` (line 287). Mirror this on the **error** path so a user retry doesn't reuse a poisoned client.

**Files**
- `fe/privy-auth/src/components/handlers/SignHandler.tsx`

**Change**

In the `catch (err)` of `sendTransaction` (around line 215–239), before `setAutoSignError(interpreted)`, add:
```ts
sessionClientByChainRef.current.delete(reqChainId);
```

**Test plan**
- Force a venue-leg revert → user retries via "Try again" → fresh client built; no `0xe52970aa` simulation revert from cached state.

**Scope guard.** Do not invalidate on `createSessionKeyClient failed` (line 167–175) — that branch already returned before caching.

---

## File summary

| Section | Path | Action |
|---|---|---|
| P0.1 | `fe/privy-auth/src/components/handlers/SignHandler.tsx` | gate uses `keyMachineSettled` |
| P0.2 | `fe/privy-auth/src/components/SigningRequestModal.tsx` | disclaimer band for `stock_buy` |
| P0.2 | `fe/privy-auth/src/components/handlers/SignHandler.tsx` | mirror disclaimer in waiting screen |
| P0.2 | `fe/privy-auth/src/types/miniAppRequest.types.ts` | add optional `verb` to preview |
| P0.3 | `fe/privy-auth/src/App.tsx` | dev-mode BSC bundler warning |
| P0.3 | `fe/privy-auth/.env.example` | placeholder env |
| P0.4 | `fe/privy-auth/src/utils/interpretSignError.ts` | two new branches |
| P0.5 | — | verification only |
| P1.1 | `fe/privy-auth/src/hooks/useDelegatedKey.ts` | optional on-chain verify |
| P1.2 | `fe/privy-auth/src/components/handlers/SignHandler.tsx` | invalidate cache on error |

## After implementing

Update `fe/privy-auth/status.md`:
- Note the `keyMachineSettled` gate in `SignHandler`.
- Note the `stock_buy` disclaimer band convention; future stock-related verbs must reuse the same component.
- Note the `interpretSignError` codes added (they pair with BE `notifyResolved` strings — string is the contract).

Do NOT update `2026-05-04-aster-stocks-impl.md` — it remains the original plan; this doc supersedes it only for the listed sections.

## Quality bar

- Every new branch logs through `createLogger`. No `console.*`.
- The disclaimer band must not appear for non-stock verbs.
- The `keyMachineSettled` gate must not regress the single-chain happy path — verify with a clean home-chain `/swap`.
- After P0.1, manual: BSC sign request with stored home-only blob → modal appears within 200ms of mini-app open, no error screen flash.
- After P0.2, manual: `/stock buy $10 AAPL` → user reads "Synthetic stock perp" before tapping Approve.
- Mirror string contracts with BE `notifyResolved` for every code added in P0.4 (the BE doc tracks this; verify both PRs land together).
