# Aster tokenized stocks — Frontend (mini-app) plan

**Status:** proposal
**Date:** 2026-05-04
**Companion to:** `be/constructions/2026-05-04-aster-stocks-plan.md`

---

## Goal

Make the `/stock buy|short|close|sl|tp` flows feel identical to `/swap` from the user's POV — open the mini app once, sign nothing extra, watch a sequence of UserOps autosign, see the explorer link. The new wrinkle: the SCA needs a **second** session-key delegation on **BSC** (chainId 56), and the existing autosign chaining must transparently span an Avax leg → BSC legs → Avax leg.

This document covers the FE-only changes. Everything chain-config-related stays in lockstep with the BE per the `aaConfig.ts` non-negotiable.

---

## Non-negotiables (locked)

1. **BSC (56) is added as a second supported chain in `utils/chainConfig.ts`.** The FE/BE chain registries must agree by construction.
2. **Eager BSC delegation at onboarding.** New users get session keys on **both** Avalanche and BSC during the same onboarding pass. Existing users get a one-time top-up flow on first `/stock` invocation.
3. **No new mini-app `requestType`.** `stock` reuses the existing `sign` artifact pipeline; the difference is the underlying UserOps target chainId 56. `SignHandler` already reads `chainId` per request — confirmed parity with the 2026-04-27 swap fix.
4. **One mini-app session per `/stock` action.** `fetchNextRequest` chains across the swap → approve → open → (recovery) sequence exactly as it does for `/swap`.
5. **Determinism: no LLM in the FE.** All resolution and disambiguation happens server-side; the FE only renders artifacts.
6. **Errors classified centrally** in `interpretSignError.ts` — extended for Aster reverts (see "Error classification" below).

---

## What changes

### `utils/chainConfig.ts` — add BSC (56)

- BSC viem chain (`bsc`).
- USDC.bsc address + decimals (18). **Note:** USDC on BSC is 18 decimals — different from Avax USDC's 6. The FE already keys decimals per-token via the registry, so this is a config-level concern only; existing rendering helpers (`formatUnits`, BigInt math) are correct.
- Bundler / paymaster URLs for BSC. Use the same Pimlico project, BSC endpoint.
- Block explorer base for BscScan (used by `buildExplorerUrl`).

The chain registry file is the **single source** the rest of the app reads from — no `chainId === 56` literals anywhere in handlers.

### `utils/aaConfig.ts` — no change

Already chain-agnostic. The same `entryPoint`, `kernelVersion`, and `index = 0n` produce the same SCA on BSC as on Avax. Critical: this MUST stay in lockstep with `be/src/helpers/aaConfig.ts` per the existing convention.

The companion BE plan adds an `index = 0n → BSC SCA` verification step into the boot-time `verify-aster-pairs.ts`-like script. The FE doesn't need its own verification, because the FE always derives via `deriveScaAddress` and the BE has already verified consistency.

### Onboarding — eager BSC delegation

Today's onboarding (see `session-delegation-plan*.md`) collects:
1. Privy auth.
2. Approval params from `GET /delegation/approval-params`.
3. User signs a delegation message that grants the bot's ephemeral session key sudo authority over the SCA on Avax.
4. `POST /delegation/grant` upserts `tokenDelegations` rows.

The change: **steps 2–4 happen twice in sequence** — once for Avax, once for BSC. Mechanics:

- `GET /delegation/approval-params?chainId=56` returns BSC defaults (USDC.bsc + native BNB suggestions).
- The same session-key keypair is used for both chains. We do not generate a second keypair — Kernel session-key validators are installed per-chain, but the validator-key identity can be shared. (Confirm at impl: if the validator install is deterministic per-key + per-validator-config, we can deploy both validators in a single batched flow.)
- UI: the existing onboarding screen renders **two delegation steps** in a tight sequence with copy explaining "approving once for Avalanche, once for BNB Chain stock trading." The session-key keypair is generated once and stored in `telegramStorage` exactly as today.

Implementation surface (FE):
- New `hooks/useMultiChainDelegation.ts` — orchestrates the two-chain delegation sign sequence. Wraps the existing single-chain hook.
- `OnrampHandler.tsx` / wherever onboarding lives — render a small two-step progress affordance ("1/2 Avalanche · 2/2 BNB Chain").

**Existing-user top-up:** if the BE returns `requestType: 'sign'` for a `/stock` request and the FE detects the underlying UserOp targets a chain the user has **no** session-key delegation for, the FE intercepts and renders a one-time delegation modal first. Detection mechanism: a new `GET /delegation/grant?chainId=56` (already part of the BE plan) returns empty when no BSC delegation exists.

The modal flow reuses the eager-onboarding UI in single-step form.

### `utils/createSessionKeyClient.ts` and `createSudoClient.ts` — chain switch

Both client builders accept a `chainId`. Required changes:

- `createSessionKeyClient(chainId)`: pick chain, RPC, bundler, paymaster from `chainConfig` by `chainId`. The session-key signer (loaded from `telegramStorage`) is chain-agnostic — same key works for both chains.
- `createSudoClient(provider, eoa, chainId)`: same pattern. Used during onboarding's BSC delegation install.

Today these helpers default to `VITE_CHAIN_ID`. After this change, they accept an explicit `chainId` and only fall back to the default when omitted.

### `SignHandler.tsx` — already supports per-request `chainId`

The 2026-04-27 swap fix already added per-request `chainId` plumbing:

> `chainId: params.fromChainId` on every `SignRequest` … `SignHandler` defaults to `VITE_CHAIN_ID` when chainId is absent.

So a stock buy emits three sign requests with `chainId: 43114` (Avax swap leg), `chainId: 56` (BSC approve), `chainId: 56` (BSC openMarketTrade). `SignHandler` builds the right `sessionKeyClient` per request via `createSessionKeyClient(req.chainId)` — already the correct shape.

`fetchNextRequest` continues to chain via `?after=<prevId>`, regardless of whether the next request is on a different chain. No change needed.

### `interpretSignError.ts` — Aster revert classification

New `SignErrorCode` entries and pattern matchers:

| Code | Trigger |
|---|---|
| `aster_pair_inactive` | Diamond reverts because the pair isn't tradable (e.g. listing paused). |
| `aster_min_size` | Notional below Aster's minimum (display: "Minimum trade size is $X. Try a larger amount."). |
| `aster_max_position` | Per-user position cap hit. |
| `aster_oracle_stale` | Mark price too old at execution. Suggest "try again." |
| `aster_insufficient_collateral` | After bridge, USDC.bsc landed below required `amountIn`. Recoverable via the BE auto-bridge-back path. |
| `stock_recovery_failed` | The auto-return-swap also failed. Surface the BSC tx hash and instruct user to contact support. |

Each pattern matches both the ASCII revert string and its hex-encoded form (per the Relay solver precedent).

### Recovery UX

When the BE's stranded-funds recovery succeeds, the user-facing result message reads:

> ❌ Stock trade failed: oracle price changed. Your $100 was returned to Avalanche. [explorer]

When recovery fails, two explorer links surface — the original failure tx and the failed recovery tx. The mini-app screen renders both via the existing `MultiTxResultScreen` (or the equivalent — confirm the pattern at impl; the swap result screen handles multi-tx already).

### `/positions` view

This is **not** a mini-app surface. `/positions` is a Telegram chat command that hits the BE's `get_stock_positions` agent tool and renders a Markdown reply with an LLM-generated paragraph on top.

The mini-app's existing `HomeTab` (or a future stocks-aware extension) **may** show open positions inline. v0 scope: skip — the chat surface owns this.

If we add a stocks panel later, the data shape `StockPosition[]` is already specced in the BE plan and a future `useStockPositions` hook would be a thin clone of `useTransferHistory`'s no-poll, manual-refresh shape (per the "Never poll free-tier-backed endpoints" convention).

### SL / TP on a position — picker UI

When the user types `/stock sl AAPL 150` and they have multiple AAPL positions open, the BE emits an `inline_keyboard` artifact (existing artifact type). Telegram renders the button list; the user taps; the callback re-enters the BE with the selected `tradeHash`.

**FE has no role in this disambiguation** — it happens entirely in Telegram. No mini-app surface change needed.

---

## What does NOT change

- `useFetch`'s `refetchOnVisible` semantics — this feature adds no polled resources.
- The `Activity` tab — Aster trades do not surface there in v0 (Ankr's transfer-history coverage on BSC + the synthetic-perp model means there's no clean ERC-20 movement to render). Document explicitly.
- `ConfigsTab.PermissionsSection` — stocks debit the existing USDC.avax delegation; no new permission row to render.
- Manual-sign path via `createSudoClient` — only used for onboarding and the BSC delegation install. The autosign hot path through `createSessionKeyClient` covers all `/stock` execution.

---

## Logging

New scopes via `createLogger`:

- `useMultiChainDelegation` — `step` events `started`, `avax-submitted`, `bsc-submitted`, `succeeded`, `failed`.
- `BscDelegationModal` — modal lifecycle.

Existing scopes pick up the chain switch transparently:
- `SignHandler` — its `step` events should now include `chainId` in metadata so we can debug cross-chain mini-app sessions.
- `createSessionKeyClient` / `createSudoClient` — log `chainId` at `debug` on construction.

Per the convention: `warn` and `error` surface as Sonner toasts, so error classification matters. The new Aster errors above are most often **user-actionable** (try smaller, try larger, try again) — those should be `warn` not `error`, matching the Relay solver precedent.

---

## Phasing (mirrors BE)

**Phase 1 — Read-only:**
- BSC chain config entry.
- Nothing user-visible in the FE yet (BE serves `/stocks/pairs` and `/stocks/quote` to the agent).

**Phase 2 — Buy / short:**
- Multi-chain onboarding sign flow.
- Existing-user BSC top-up modal.
- Sign-error classification for Aster reverts.
- `createSessionKeyClient` / `createSudoClient` chainId plumbing.

**Phase 3 — Close + SL/TP:**
- Multi-tx result screen handles the close + return-swap pair.
- (No new FE work for SL/TP — Telegram inline keyboard handles disambiguation.)

---

## Acceptance criteria

- A fresh user onboarding signs **two** delegation messages back-to-back (Avax then BSC), with clear copy, and lands in `HomeTab` exactly like before.
- An existing user (Avax-only delegation) typing `/stock buy $1 AAPL` (test mode) is shown a one-time BSC delegation modal first, then proceeds without any further signature.
- Three sign requests in one mini-app session, each with the correct `chainId` (43114, 56, 56), all autosigned.
- Final screen shows the BSC `openMarketTrade` explorer link via `buildExplorerUrl(56, txHash)`.
- All new error codes in `interpretSignError.ts` show classified, user-friendly messages — no "Something went wrong" generics.
- `aaConfig.ts` (FE) ↔ `aaConfig.ts` (BE) byte-identical, verified by grep + manual review on every PR touching either.

---

## Risk register (FE-specific)

| Risk | Mitigation |
|---|---|
| User dismisses the BSC delegation modal mid-flow | `/stock` request remains pending in BE Redis (existing `sign_req` TTL); user can re-open mini-app and the modal re-renders. After the existing `sign_req` TTL, the BE expires the request cleanly. |
| BSC bundler/paymaster outage | Surface as a normal sign failure with a "try again later" code; no user funds at risk because the swap leg hasn't fired yet. |
| Chain-config drift between FE and BE | This is the existing `aaConfig.ts` lockstep risk extended one chain — same mitigation: PR review checklist, no inline literals. |
| User on a Telegram client that doesn't render `inline_keyboard` reliably | Disambiguation is a chat surface; falls back to numbered list with `/stock close 1` / `/stock close 2` syntax (BE owns this fallback — flagged in BE plan). |
| 18-decimal USDC.bsc math error | All BigInt math goes through the existing `toRaw` / `formatUnits` helpers; decimals come from chainConfig — never inlined. |

---

## What this plan does not commit to

- Specific Pimlico bundler URL for BSC (drop in at impl).
- Whether the multi-chain delegation flow batches both signatures into one Privy popup or two — depends on Privy's UX; default to two for clarity, revisit if friction is high.
- Whether the mini-app gains a dedicated stocks tab — out of scope for v0; revisit when usage data justifies it.
