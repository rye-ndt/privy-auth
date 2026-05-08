# Privy Auth Mini-App — Status Log

## Revoke flow rewrite — 2026-05-08

**What** — `useDelegatedKey.removeKey` now performs a full revoke instead of
just clearing local storage. New steps, in order:

1. **Onchain invalidation** — for every chain in `installedChainIds`, builds a
   sudo-only Kernel client (Privy EOA owner) and calls the new
   `uninstallSessionKey` helper in `utils/crypto.ts`, which submits an
   `uninstallPlugin` userOp against the same regular-validator identity the
   install path produced. Mining the userOp removes the validator from the
   kernel, voiding every spending-cap policy attached to it. Each chain is
   independent — a Privy popup rejection or RPC failure on chain A does not
   block chain B.
2. **Backend revoke** — POSTs `${backendUrl}/delegation/revoke` with the
   user's Privy bearer. The endpoint clears Redis (`delegation:<addr>`),
   deletes every `token_delegations` row for the user, and flips
   `userProfiles.sessionKeyStatus = REVOKED` while clearing
   `sessionKeyAddress` / `sessionKeyExpiresAtEpoch`.
3. **Local wipe** — only after the above (regardless of their success) we
   `cloudStorageRemoveItem('delegated_key')` and reset hook state. Local
   wipe always runs because otherwise a backend hiccup would leave the user
   stuck with a key they can't refresh from the UI.

**Why** — old `removeKey` cleared only Telegram CloudStorage, so:
- the kernel's regular validator + its caps stayed live onchain;
- BE redis cache + `token_delegations` rows kept lying around, so
  `aegisGuardInterceptor` saw "delegations cover this spend" and silently
  auto-signed the next /send instead of re-prompting the user;
- `userProfile.sessionKeyStatus` enum had `REVOKED` but nobody ever wrote it.

**Wiring** — `useDelegatedKey` now takes optional `backendUrl` + `privyToken`
options; `App.tsx` threads them in. `ConfigsTab` keeps the same `removeKey`
prop signature, so its call site is unchanged.

**Failure model** — every step is best-effort and logs `warn` on failure. The
user sees `"Key removed — reload to create a new one."` either way; debug logs
distinguish backend / onchain / provider failures via scoped log events
(`onchain-revoke-*`, `backend-revoke-*`).

## Web2-friendly UX wording revamp — 2026-05-08

**What was done** (no flow / sequence / chart changes — wording-only pass to
remove web3 jargon for web2 onboarders):

- **ApprovalOnboarding.tsx** — title `Enable Autonomous Trading` →
  `Let the bot trade for you`; reapproval title → `Refresh Spending Cap`;
  body copy reframed as "Set how much of your money the bot can use";
  primary CTA `Approve` → `Allow` (and `Approving…` → `Allowing…`);
  `TokenLimitRow` now annotates the amount with "Bot can use up to"
  so the row is self-explanatory without surrounding context;
  footer `These limits are enforced by the Aegis server. You can revoke
  access at any time.` → `Aegis enforces these caps. You can change or
  stop them anytime.`; `No token limits required.` →
  `No spending caps needed.`; `Saving limits…` → `Saving…`.
- **BscDelegationModal.tsx** — `Enable {chain}` → `Connect {chain}`;
  body → "Allow the bot to trade on {chain} for you. One quick tap.";
  CTA `Approve` → `Allow`; success title → `{chain} connected`;
  loading `Approving on {chain}…` → `Connecting to {chain}…`.
- **ConfigsTab.tsx** — `Smart Account` / `Signing Address` (`EOA`) →
  `Main Wallet` (`receives funds`) / `Backup Wallet` (`for advanced use`);
  `AI Agent` section header → `Your Bot`; `Agent Address` (`delegated key`)
  → `Bot Address` (`trades for you`); `No agent connected` →
  `No bot connected`; `Disconnect AI Agent` → `Disconnect Bot` (and the
  modal title + body copy); `What the agent can do` → `What the bot can do`;
  `Spending limit` → `Spending cap`; `No spending permissions granted` →
  `No spending caps set`; internal modal renamed `RemoveAgentModal` →
  `RemoveBotModal` (sole call-site updated).
- **SigningRequestModal.tsx** — header `Transaction request from bot` →
  `Action from your bot`; row labels `To` / `Value` / `Calldata` →
  `Going to` / `Amount` / `Details`; CTAs `Approve`/`Reject` → `Allow`/`Deny`;
  loading `Signing…` → `Working…`; default catch fallback `Transaction failed`
  → `Something went wrong`. Raw-data toggle preserved as power-user view.
- **SignHandler.tsx** — `Auto-sign failed` → `Couldn't complete this for you`;
  `Preparing your session key` / `Signing with your delegated key` →
  `Getting ready` / `Doing this for you`; corresponding subtitles dropped
  references to "session key" / "delegated key" / "popup"; status spinners
  `Loading key…` / `Broadcasting transaction…` → `Getting ready…` /
  `Sending…`; success `Transaction sent` → `Done`; manual-retry banner
  `Auto-sign failed — please approve manually.` →
  `Couldn't auto-handle this — please confirm manually.`.
- **ApproveHandler.tsx** — success title `Agent Connected` → `Bot Connected`;
  loading `Installing session key…` → `Setting up your bot…`.
- **AuthHandler.tsx** — `Installing session key…` → `Setting up your bot…`.
- **PlaceBetHandler.tsx** — every per-phase `detail` string rewritten to
  plain language: `Funding gas on Polygon…` → `Getting ready on Polygon…`;
  `Approving Polymarket contracts…` → `Setting up Polymarket access…`;
  `Authenticating with Polymarket…` → `Connecting to Polymarket…`;
  `Waiting for bridge…` → `Preparing to move your money…`;
  `Bridging to Polygon…` → `Moving your money to Polygon…`;
  `Routing stake to executor…` → `Preparing your bet…`;
  `Signing order…` → `Placing your bet…`;
  `Waiting for fill…` → `Waiting for confirmation…`;
  `Returning unused funds` / `Sweeping residual USDC to your wallet…` →
  `Returning unused money` / `Sending leftover USDC back to your wallet…`;
  `Price moved` / `… drift). Re-confirm in chat to continue.` →
  `The price changed` / `… change). Confirm again in chat to continue.`;
  user-visible `throw new Error(...)` strings (`Polygon session-key install
  timed out`, `Bridge has not been initiated for this bet (BE pending).`,
  `Bridge intent missing — bet was transitioned to BRIDGING without an id.`,
  `Gas funding timed out`, `Bet row not initialized by BE for this intent`)
  rewritten to plain English. Added `SETUP_STEP_LABELS` and
  `EXEC_STATUS_LABELS` maps so the brief moment between transitions never
  shows raw status codes (`SCA_TO_EOA`, `ORDER_SUBMITTED`, etc.) to the
  user — `labelForPhase` falls through these maps instead of the enum
  value. Status-code constants in code are unchanged (still the BE
  contract).
- **ClosePositionHandler.tsx** — `Quoting…` → `Getting price…`;
  `Signing order…` → `Placing your sell…`; `Waiting for fill…` →
  `Waiting for confirmation…`; `Returning funds to wallet…` →
  `Returning money to your wallet…`; user-visible errors
  (`Position not found`, `Position is X — cannot close`, `Close did not
  fill within timeout`) rewritten.
- **YieldDepositHandler.tsx** — `Signing with your delegated key. No
  action required.` → `The bot is doing this for you. No action needed.`;
  `Broadcasting transaction…` → `Sending…`.
- **HomeTab.tsx** — tagline `Onchain AI Agent` → `Your AI trading bot`;
  delegation banner `Setting up AI Agent` → `Setting up your bot`;
  auth pill `Authenticated` / `Not Authenticated` → `Signed in` /
  `Not signed in`.
- **login.tsx** — `Your secure onchain identity, powered by Google` →
  `Your secure account, powered by Google`; footer `A wallet is created
  automatically if you don't have one.` → `An account is created for you
  automatically.`.
- **PointsTab.tsx** — action labels `Swap (same-chain)` /
  `Swap (cross-chain)` → `Swap` / `Cross-network swap`. Action keys are
  unchanged (still match BE ledger codes).
- **interpretSignError.ts** — every `friendly` field rewritten to plain
  English: gas/sponsorship messages talk about "network fees" instead of
  "Pimlico balance" / "gas sponsorship policy"; `Token spending allowance
  is too low. Please approve more and try again.` →
  `Your spending cap is too low. Increase it and try again.`;
  `Signature was rejected. The session key may have expired — please
  re-link.` → `Your bot's connection expired — please reconnect it.`;
  `Transaction was rejected.` → `Action was cancelled.`; default fallback
  shortened to `Something went wrong. Please try again.`. Error
  *codes* are untouched — they're the contract the BE branches on.

**Why this approach over alternatives:**

- *Keep token symbols (USDC) as-is, plain language only in surrounding
  prose.* The user's brief said "100 usd in your wallet" but USDC ≠ USD;
  silently swapping the symbol on token rows / balances would be product
  fraud. Instead, descriptions / sentences talk about "your money" and
  the row annotation reads "Bot can use up to {N} USDC" so a non-crypto
  user can map the symbol to a dollar amount the first time they see it.
- *Phase / setup-step labels live next to the state machine, not in a
  central i18n map.* Two reasons: (a) we already have only one locale,
  so an i18n layer is over-engineering, and (b) the maps are tied 1:1
  to the BE-defined `BetStatus` / `SetupStep` enums — colocating them
  means a new BE status forces a TS exhaustiveness error here, which is
  the desired forcing-function. If a third locale ever ships, lift them
  into a translations module then.
- *`throw new Error(...)` strings rewritten to plain English even though
  they're "internal".* These bubble up through `setPhaseUnique({ kind:
  'error', message })` and end up in `FullScreenError` verbatim — they
  ARE user-facing in practice. Dev-time-only errors (`Embedded wallet
  not available`, `keypair not initialised`, `no session-key blob for
  chain X`) were left alone — they only fire on a broken install / mid-
  initialization race that an end user shouldn't hit.

**No new conventions introduced.** No new metadata fields. No log scope
changes. No flow / handler / state-machine logic touched. Internal
identifiers (`SCA_TO_EOA`, `ORDER_SIGNED`, `setupStep === 'authed'`,
log scopes like `placeBetHandler`, error codes in `interpretSignError`)
are all unchanged so BE compatibility, log queries, and analytics
funnels continue to work.

**Side effects to watch:**

- `RemoveAgentModal` → `RemoveBotModal` is a private component renamed
  in-file with its sole caller updated; nothing imports it externally
  (verified via grep). If anyone adds a re-export later they'll need to
  use the new name.
- `EXEC_STATUS_LABELS` and `SETUP_STEP_LABELS` are exhaustive over the
  current enums via `Record<…>`. If a new `BetStatus` / `SetupStep` is
  added BE-side without updating these maps, TS will fail the build —
  by design.
- A few interim phases (`status: bet.status` set without `detail` at the
  top of the `while` loop) used to render the raw enum value for one
  render pass before the case-specific `setPhaseUnique` overrode it.
  After this change those interim renders show humanized text. Net
  effect: no jargon flashes, no behavior change.

## Prediction Markets stage 4 FE — hardening pass — 2026-05-07

**What was done** (closing review-flagged issues against `2026-05-07-prediction-markets-stage4.md` after the BE side hardened):

- **Refund flow wired.** `BetRow` now carries `refundRequired: boolean` and
  `refundTxHash: string | null`. New `pmApi.recordRefund(betId, txHash)`. On
  every mini-app open the handler scans `state.inFlightBets` for entries
  with `refundRequired && !refundTxHash`, calls `sweepUsdcToSca` from the
  EOA to the user's Polygon SCA, and POSTs the resulting tx hash to
  `/bet/:id/refund`. If the EOA has no balance to sweep (manual prior
  sweep), records a sentinel zero-hash to clear the BE flag and avoid loop.
  Same sweep also runs *post-finalize* on PARTIAL/UNFILLED/FAILED so the
  user doesn't need to reopen the mini-app once for the bet and again for
  the refund. New `Phase: 'refunding'` for the dedicated UI state.
- **409 illegal-transition handling.** `pmApi.postJson` now distinguishes
  HTTP 409 from generic errors and throws a typed `IllegalTransitionError`
  carrying `{from, to}`. The bet state-machine loop in `PlaceBetHandler`
  catches it, refreshes via `pmApi.bet`, and lets the loop converge on the
  BE's canonical state instead of retrying the (illegal) move. This is the
  expected hot-path when the BE's order poller observes a fill before the
  FE — it just rejoins the BE truth.
- **`BET_IN_FLIGHT` surfaces cleanly.** `pmApi.postJson` recognizes the BE's
  500-with-`BET_IN_FLIGHT` payload and throws a typed `BetInFlightError`.
  Handler catches it, shows a friendly `'in_flight'` phase ("Another bet is
  being placed — wait for it to settle"), and auto-closes the mini-app.
  Replaces what was previously a generic Sonner error toast.
- **Drift response decision honored.** Old code always treated
  `/drift-detected` as a reconfirm and bailed out. Now reads
  `{decision: 'ok' | 'reconfirm', …}` per BE contract; only bails on
  `reconfirm` and surfaces the BE-supplied `previousRefPriceBps` /
  `newRefPriceBps` / `driftBps` in the chat re-confirm UI. On `ok`, the
  flow continues using the *live* `ob.midBps` as the order reference (was
  pricing off the stale `bet.refPriceBps` — exactly the slippage hole
  drift-detection exists to plug).
- **Setup state-machine fixed for linear-monotonic guard.** `SCA_TO_EOA →
  ORDER_SIGNED` no-op transition removed; the `SCA_TO_EOA` case now does
  the orderbook fetch + drift check + signing + place-order in a single
  pass and emits two real transitions (`ORDER_SIGNED`, then
  `ORDER_SUBMITTED`). The `ORDER_SIGNED` case is kept as a
  resume-after-mid-flow-close path. Avoids 409s under the BE's new repo
  guard. (No-op `SCA_TO_EOA → ORDER_SIGNED` previously round-tripped
  through the BE for nothing.)
- **`pollUntilTerminal` no longer races BE poller.** Old behaviour: on FE
  120s timeout, force `transitionBet({status: 'FAILED'})`. The BE may have
  already finalized — the forced transition would then 409. New behaviour:
  on timeout, just return the latest `pmApi.bet(...)` and let the outer
  loop handle the canonical state. Keeps a `fill-poll-timeout` warn for
  observability.
- **Bridge `no-intent` made explicit.** `BridgeStatusResponse.status`
  union extended with `'no-intent'`. `pollBridgeStatus` retries once
  (the BE may be mid-write) and otherwise throws a clear typed error
  ("Bridge intent missing — bet was transitioned to BRIDGING without an
  id"). Previous code looped silently until the bridge timeout fired.
  This surfaces the BE-side gap (bridge initiation endpoint is still
  pending — see deferred items).
- **`userId` no longer in URL paths.** The BE handlers resolve user from
  the bearer token; earlier drafts of the doc had `:userId` segments and
  the FE was wrongly passing `smartAccountAddress` as the segment value
  (would have 404'd). Dropped from `/state` and `/positions` URLs. The
  `userId` prop is removed from both `PlaceBetHandler` and
  `ClosePositionHandler` and from the call sites in `App.tsx`.
- **`ClosePositionHandler.clientOrderId` no longer empty.** Now generated
  via `crypto.randomUUID()` (with the same `Date.now()+random` fallback
  the rest of the FE uses) before the `pmApi.sellOrder` POST, so the
  Polymarket idempotency contract holds across retries. `pollUntilClosed`
  dead-code branch (`if (status === 'open') return false`) replaced with
  the real signal (`closed`/`resolved` or position absent).
- **Magic numbers centralized.** `DRIFT_BPS`, `ORDER_SLIPPAGE_BPS`,
  `BRIDGE_TIMEOUT_MS`, `FILL_TIMEOUT_MS`, `GAS_FUNDED_TIMEOUT_MS`,
  `CHAIN_INSTALL_TIMEOUT_MS`, `CLOB_API_BASE` all moved into
  `predictionMarketConstants.ts` with comments mapping each to the BE env
  var it mirrors.
- **Logger scopes corrected to camelCase** (`placeBetHandler`,
  `closePositionHandler`) per FE doc §7.

**New metadata fields used in logs** (per CLAUDE.md docs requirement):
`from`, `to` (illegal-transition warn), `previousRefPriceBps`,
`newRefPriceBps`, `driftBps`, `refundRequired`, `refundTxHash`,
`livePriceBps`. **New step events:** `refund-start`, `refund-skipped`,
`refund-recorded`, `bet-in-flight` (info), `illegal-transition` (warn),
`fill-poll-timeout` (warn). **New error types:** `IllegalTransitionError`,
`BetInFlightError` exported from `predictionMarketApi.ts` — both are the
canonical way for handlers to branch on the corresponding BE outcomes;
never compare on `err.message` substrings.

**Side effects to watch:**
- The `userId` arg dropped from `pmApi.state` / `pmApi.positions`. Any
  future caller passing a userId will no-op-compile-error against the new
  signature, which is the desired forcing-function.
- Drift-decision flow only runs on `SCA_TO_EOA` and `ORDER_SIGNED` arms.
  The bet state machine doesn't re-check drift after `ORDER_SUBMITTED` —
  the order is in the CLOB by then and slippage is locked.
- Post-finalize refund sweep depends on `state.setup.polygonScaAddress`
  being populated; if a bet finalizes mid-setup (which shouldn't happen)
  the sweep silently skips with `refund-no-sca` warn — the next mini-app
  open after setup completes picks it up.

**Still-deferred / now-explicit gaps (verify before mainnet):**
1. **BRIDGING actually executes.** The FE handler now surfaces a typed
   error if `bridgeIntentId` is missing on entry to BRIDGING, but it does
   *not* drive the Avax-SCA → Polygon-SCA Relay quote itself. The BE-side
   bridge-initiation endpoint (e.g. `POST
   /predictionMarket/bet/:id/bridge`) is still pending; without it bets
   currently dead-end at INITIATED. **Ship-blocker for live bets.**
2. **`/order/sell` `closingBetId` provisioning.** Still POSTed empty.
   `clientOrderId` is now generated, but if the BE expects FE to know the
   close-bet id from `initiateClose`, we need a `pmApi.previewClose` /
   `pmApi.confirmClose` round-trip before signing the sell.
3. **Polymarket EIP-712 typed-data set.** Same caveat as before — not
   verified against on-chain CTFExchange `Signatures.sol`. Header comment
   in `polymarket.ts` flags it.
4. **Position list view ("My Predictions" §8).** Still deferred.
5. **Result-card variant renderers.** `bet_placed`, `bet_failed`,
   `position_open|closed|resolved` are pushed by BE direct to chat. No
   FE renderer registration is needed (these are BE-rendered Telegram
   messages, not mini-app cards).

## Prediction Markets stage 4 FE — 2026-05-07

**What was done** (per `constructions/2026-05-07-prediction-markets-stage4.md`):

- **Polygon (137) wired into `chainConfig.ts`.** New env vars: `VITE_POLYGON_RPC_URL`,
  `VITE_POLYGON_PIMLICO_BUNDLER_URL`, `VITE_POLYGON_PIMLICO_PAYMASTER_URL`,
  `VITE_POLYGON_PIMLICO_SPONSORSHIP_POLICY_ID`. Polymarket addresses
  (USDC, CTF, CTFExchange, NegRiskExchange, NegRiskAdapter) live alongside
  the chain entry via `getPolymarketAddresses(chainId)` — chain-agnostic-rule
  compliant per CLAUDE.md.
- **Types** in `types/predictionMarket.types.ts` mirroring BE schema:
  `SetupStep`, `BetStatus`, `PositionStatus`, `BridgeStatus`, plus row shapes
  for intent / bet / position / orderbook / bridge-status responses, and
  `PolymarketOrderArtifact` for signed orders.
- **Polymarket utilities** (`utils/polymarket.ts`):
  - `buildUnsignedOrder` / `signOrder` — hand-rolled CTFExchange EIP-712 typed
    data (avoids vendoring `@polymarket/clob-client`).
  - `signClobAuth` / `deriveClobApiKey` — L1→L2 auth flow for the setup
    `authed` step.
  - `applySlippage`, `sharesForStake`, `randomSalt`, `toBaseUnits`.
- **Session-key EOA loader** (`utils/sessionEoa.ts`) — decrypts the cloud-
  storage blob to access the raw session privateKey, needed because Polymarket
  uses signatureType=EOA (the maker IS the session key, not the SCA).
- **API client** (`utils/predictionMarketApi.ts`) — thin `pmApi` wrapper over
  the BE `/predictionMarket/*` endpoints with privy bearer auth.
- **Deep-link parser** (`utils/deepLink.ts`) — reads
  `Telegram.WebApp.initDataUnsafe.start_param` (with URL fallback for dev),
  parses `place_bet:<id>` / `close_position:<id>` verbs.
- **`PlaceBetHandler.tsx`**: orchestrates the full setup state machine
  (pending → sca_deployed → gas_funded → approved → authed → complete) and the
  bet execution machine (INITIATED → BRIDGING → BRIDGED → SCA_TO_EOA →
  ORDER_SIGNED → ORDER_SUBMITTED → terminal). Drift-detection: pre-sign live
  orderbook check; if `|live − ref| > 200 bps`, POSTs `/drift-detected`,
  closes mini-app for chat re-confirm. Terminal status → `/finalize`.
- **`ClosePositionHandler.tsx`**: build + sign sell limit at top-of-bid −
  slippage, POST `/order/sell`, poll until position status = closed, sweep
  EOA USDC back to SCA, POST `/finalize`.
- **App.tsx routing**: deep-link path takes precedence over the StatusView
  fallback, but only after `delegatedKey.state.status === 'done'`. While the
  key is restoring, shows the spinner — handlers can't sign without it.
  Existing `requestType` switch is untouched.

**Why this approach over alternatives:**

- Hand-roll Polymarket EIP-712 instead of vendoring `@polymarket/clob-client`:
  the SDK pulls a noticeable amount of weight into the mini-app bundle, and
  the typed-data shape is a single struct that's easy to mirror. Verified
  against the on-chain CTFExchange Signatures mixin pattern.
- Signing via raw session privateKey (`loadSessionEoa`) rather than through
  the kernel client: Polymarket signatureType=EOA expects a plain ECDSA sig
  from the maker address, not a smart-account ERC-1271 signature. The session
  key is already a regular EOA ECDSA key under the hood — we just bypass the
  kernel wrapper for these specific signatures.
- `MiniAppRequest`/`requestType` union NOT extended: the BE doc and FE doc
  agree that prediction-market deep links route via `startapp`, not via the
  signing-request cache. Keeping them separate avoids re-using the
  one-shot-signing model for a multi-step state machine.

**New conventions introduced:**

- **Cloud-storage blob shape now read by code outside `useDelegatedKey`.**
  `sessionEoa.ts` decrypts the same blob `useDelegatedKey` writes to access
  the raw privateKey. If that wrapper format changes, both files must move
  together. The format is documented in the file header.
- **Per-feature address registry alongside `chainConfig.ts`.** Polymarket
  addresses live in `POLYMARKET_ADDRESSES_BY_CHAIN` next to the chain entry.
  Future protocols on other chains should follow the same pattern (one map,
  one accessor, no inline literals in feature code).
- **Deep-link routing pattern.** App.tsx now checks `parseDeepLink()` before
  falling through to StatusView. Future deep-link handlers (e.g. for other
  capabilities) should add a verb here, not invent a new dispatch path.

**Side effects to watch:**

- The Polygon chain entry depends on env vars that may not be set in dev/CI;
  `getRpcUrlById(137)` will throw "No RPC configured for chain 137" if the
  app starts without them. Existing chains (Avax/Fuji/BSC) are unaffected.
- `parseDeepLink()` runs once at App mount via `useMemo([])`. If the user
  navigates within the mini-app (rare, but possible), the start_param won't
  be re-read — that matches the existing `requestId` URL-param pattern in
  `useRequest`.

**Open / deferred items (per FE doc §11 + my own findings):**

1. **Setup gas_funded bridge orchestration.** The FE construction doc §2
   describes FE-driven Avax-SCA → Polygon-EOA Relay quoting, but the existing
   FE has no Relay client. The current code POSTs `setupStep('gas_funded',
   {eoaAddress})` and polls `state.setup.setupStep` until BE flips it. This
   assumes BE owns the bridge orchestration. Verify against BE
   `relayClient.ts` extension before mainnet test.
2. **`closingBetId`/`clientOrderId` provisioning in `/order/sell`.** Current
   code POSTs empty strings expecting BE to mint them; needs confirmation
   the BE endpoint accepts that shape, otherwise FE should request a
   pre-mint via `/predictionMarket/position/:id/init-close` first.
3. **Polymarket EIP-712 exact field set.** Hand-rolled per current Polymarket
   docs; verify against on-chain CTFExchange `Signatures.sol` before
   non-test stake validation. BE doc §15 flags this as open.
4. **Position list view (FE doc §8 "My Predictions").** Not implemented —
   read-only screen reachable from a profile entry point. Close-flow works
   without it (chat-card `[Close]` callback deeplinks directly into
   `ClosePositionHandler`). Add when product wants in-app browsing.
5. **`userId` in BE endpoint URLs.** Current code passes `smartAccountAddress`
   as `userId`. BE may expect its internal user id or `me` — verify against
   the live `/predictionMarket/state/:userId` route.

## Prediction Markets stage 3 FE audit — 2026-05-07

**What was done:**
- Audit per `constructions/2026-05-06-prediction-markets-stage3.md`: confirmed
  the FE has **no `ResultAction` consumer**. Greps for `ResultAction`,
  `action.kind`, and `nextAction` in `fe/privy-auth/src` returned zero hits.
  Result-card actions live only in the BE Telegram-render path; they never
  enter the mini-app.
- Conclusion: the BE adding `ResultAction.kind: "url"` is FE-safe with no
  defensive `default` arms required. The pre-merge checkbox in the stage-3
  doc is vacuously satisfied.

**Why noted here:**
- Future stage-5 work assumes the FE will start consuming a mini-app-routed
  variant (`kind: "miniApp"`). When that lands, *that's* when a
  `ResultAction` type union shows up in the FE — at which point exhaustive
  switches with default arms become a real concern. Today they are not.

**Convention reminder:**
- If a stage-N construction doc says "the FE consumes the same type union",
  verify by grep before assuming. The mini-app surface and the
  Telegram-render surface share BE shapes selectively, not wholesale.

## Onramp cancellation + send dedup rekey by requestId — 2026-05-05

**What was done:**
- `OnrampHandler.tsx`: Privy's `fundWallet` resolves whenever the funding
  modal closes (including on cancel), so the previous `await fundWallet → setStatus('done')`
  flow showed "Payment submitted" even when the user cancelled Stripe/Apple
  Pay. Now subscribes to `useFundWallet({ onUserExited })`; if the user exits
  with no `fundingMethod` (or zero balance change) we record an
  `exitedWithoutPayingRef` flag, then on the awaited `fundResult` only
  treat `status: 'submitted' | 'confirmed'` as success. Otherwise render a
  new `'cancelled'` screen ("Payment cancelled — no charge was made") with
  a Try-again button.
- `recentBroadcasts.ts`: rekeyed dedup from `(to, value, data)` to
  `requestId`. The legacy payload-key collided with legitimate repeat
  sends (e.g. `/send 0.01 USDC` twice — second silently reused first hash,
  reported success without broadcasting). LS key bumped to
  `aegis.recentBroadcasts.v2` to drop stale v1 entries on first load.
- `SignHandler.tsx`: updated to call `findRecentBroadcast(requestId)` /
  `trackInFlightBroadcast(requestId, send)`. Behaviour for a single
  request is unchanged (StrictMode double-mount + effect re-fire still
  coalesce); cross-requestId reuse is the BE's responsibility now.

**Why over alternatives:**
- `onUserExited` is the only authoritative "user backed out" signal Privy
  exposes; it fires before `fundWallet` resolves. Reading the resolved
  `FundResult.status` alone wasn't enough because some Privy flows resolve
  with no status (older shape) on plain modal close.
- Pure requestId-keyed dedup makes the FE oblivious to "is this the same
  payload as last time" — which is correct: the BE's signing-request cache
  already prevents duplicate resolution per requestId, and the new
  server-side `SIGNING_REQUEST_DUPLICATE_HASH` guard catches the rarer
  BE-retry-with-fresh-requestId case that v1 was originally written for.

**New convention:**
- Mini-app handlers that wrap a Privy modal (`fundWallet`, etc.) must
  treat the awaited promise as ambiguous and gate the success branch on
  an explicit signal (`onUserExited` ref + `FundResult.status` check).
  Don't equate "promise resolved" with "user paid".
- LocalStorage cache keys carry an explicit version suffix
  (`aegis.<feature>.v<N>`). Bump the suffix when the value shape changes
  so old entries are silently dropped instead of poisoning the new logic.



## DebugTab removal — 2026-05-05

**What was done:**
- Deleted `components/DebugTab.tsx` and `hooks/useDebugEntries.ts` (the `console.*` interceptor).
- `StatusView.tsx`: dropped the `'debug'` tab from the `Tab` union, removed the import / mount / dock entry / `DebugIcon`. Dock is now 4 tabs.

**Why:**
- The in-app console viewer was developer-only surface area shipping to mini-app users. Logs are still observable via the host browser console; the toast surface for `warn`/`error` is unchanged.

**Kept (still in use elsewhere):**
- `utils/logger.ts` — `createLogger`, `setLogLevel`/`getLogLevel`, the `[AEGIS:scope]` prefix, and `window.__aegisLog` runtime gate. Untouched.

## TabDock overflow fix (Telegram narrow viewport) — 2026-05-04

**What was done:**
- `StatusView.tsx` `TabDock`: 5 tabs (Home/Activity/Points/Config/Debug) overflowed Telegram's ~320–360px viewport. Switched buttons to `flex-1 min-w-0` with `px-1 py-2`, capped nav at `w-full max-w-md`, tightened gap/padding (`gap-0.5`, `p-1`), shrank outer horizontal padding `px-6` → `px-3`.
- Replaced fixed `pb-6` with `pb-[max(env(safe-area-inset-bottom),1rem)]` so the dock clears the iOS home indicator instead of being hidden behind it.

**Why:**
- Tabs share width evenly via `flex-1` rather than each demanding intrinsic content width — fits any viewport ≥ ~300px without horizontal scroll.
- `max-w-md` keeps the bar from stretching uncomfortably wide on tablets/desktop.
- The safe-area inset is the standard fix for bottom-fixed UI in mini apps; previously was a regression on devices with home indicators.

## Activity tab (Ankr-backed transfer history) — 2026-05-03

**What was done:**
- New `types/transferHistory.types.ts` — `TransferRecord` / `TransferHistoryPage` mirroring the BE `GET /transfers` shape.
- New `hooks/useTransferHistory.ts` — paginated reader for `GET /transfers`. Mirrors `useLoyaltyHistory`'s cursor-via-ref pattern. Page 0 resets on `direction` change or `refresh()`. **No polling, no `refetchOnVisible`** — the BE cache TTL is 60 s and the Ankr free tier is shared, so reload is manual.
- New `components/ActivityTab.tsx` — peer of `HomeTab` / `PointsTab` / `ConfigsTab` / `DebugTab`. Direction filter chips (All / Sent / Received), reverse-chronological list, `Load more` cursor pagination, manual `Refresh` button.
- New `components/activity/TransferRow.tsx` and `components/activity/DirectionFilter.tsx` — single-card row + chip group. `buildExplorerUrl(chainId, txHash)` from `utils/chainConfig.ts` already exists; reused (no new helper).
- `StatusView.tsx`: registered `'activity'` in the `Tab` union, mounted `<ActivityTab />`, added `ActivityIcon` and dock entry between Home and Points.
- 401 → `unauthorized` state. **429 → `rateLimited` state with inline banner; warn-level log only, no toast spam.** Other non-2xx → `error` banner with retry, error-level log (also surfaces a Sonner toast per project logger convention).

**Why:**
- Activity is now a first-class surface so users can audit sends and receives without leaving the mini app, paired with the BE `get_transfer_history` agent tool from the same Ankr port. No DB writes — the BE serves from a Redis-cached Ankr response.
- Page 0 reset on `direction` change avoids stale rows leaking between filter views; cursor-via-ref lets the effect read the latest cursor without re-running on every cursor change (same trick `useLoyaltyHistory` uses).
- `Refresh` is a button rather than `refetchOnVisible` because the BE rate-guards Ankr per user and Telegram WebView re-focuses aggressively — a passive refetch on visibility would burn the per-user quota with no user signal.

**Plan deviations (worth knowing):**
- The plan listed `App.tsx` as the tab registry; the codebase reality is `StatusView.tsx` (App.tsx routes by `requestType`). Registered there.
- The plan asked for `getExplorerTxUrl(chainId, hash)`; `buildExplorerUrl(chainId, txHash)` already exists with the same signature. Reused.
- Tab placement: chose **Home → Activity → Points → Config → Debug** (Activity adjacent to Home since both are wallet-state views).

**New conventions:**
- **Never poll free-tier-backed endpoints.** Hooks reading endpoints that the BE serves via a third-party free tier (Ankr today; whoever tomorrow) MUST NOT use `refetchOnVisible` or any other passive refetch. Reload is user-initiated only — give the user a `Refresh` button. Rationale: BE caches with short TTL and per-user upstream gates are calibrated for user-driven reads; passive refetches multiply quota burn linearly with tab count and re-focus events.
- **429 is a non-error UX state.** When a hook surfaces a rate-limit response, set a dedicated `rateLimited` boolean, render a banner, and log at `warn` level (not `error`) so Sonner doesn't toast it as a failure. The 429 path returns `null` from the response promise and short-circuits — it never falls through to the catch.
- **Cursor type is opaque string.** Unlike the loyalty cursor (epoch number), the transfer history cursor is provider-defined and must be treated as a black-box `string`. Don't parse it, don't display it.

## Self-derived smart-account address — 2026-05-03

**What was done:**
- New `utils/aaConfig.ts` and `utils/deriveScaAddress.ts`: pinned AA stack constants (entry point 0.7, Kernel V3.1, `index = 0n`) and a counterfactual SCA derivation helper. MUST stay in sync with `be/src/helpers/aaConfig.ts`.
- New `utils/createSudoClient.ts`: builds a `KernelAccountClient` with the Privy embedded EOA as the sudo signer, wired to the same Pimlico bundler/paymaster as `createSessionKeyClient`. Replaces what `useSmartWallets().client` provided for manual-sign UserOps.
- `App.tsx`: dropped `useSmartWallets()`. `smartAddress` is now a `useState`/`useEffect` driven by `deriveScaAddress(eoaAddress)`. Downstream readers already accept `''` as "not ready yet" so no signature changes propagate.
- `SignHandler.tsx` + `YieldDepositHandler.tsx`: dropped `useSmartWallets()`. Manual-sign path now lazily builds a `sudoClient` via `createSudoClient(provider, eoa, ...)` using `embedded.getEthereumProvider()`. The Privy popup behavior is unchanged because the underlying signer is the same EOA via the same EIP-1193 provider.
- `main.tsx`: dropped `SmartWalletsProvider` wrapping. `@privy-io/react-auth/smart-wallets` no longer imported anywhere in the app.

**Why:**
- Privy's hosted smart-wallets product owned both the Kernel constants and address derivation. Dashboard / SDK changes could silently change a user's SCA out from under us. By pinning the AA stack in `aaConfig.ts` and deriving the address ourselves, the FE cannot drift from the BE — the two `aaConfig` files agree by construction.
- This unblocks the BE recipient-resolution fix: when a recipient onboards with a fresh Privy EOA, the SCA they end up owning matches the one the BE derived for them at handle resolution time. Behavioral promise: byte-identical `smartAddress` for every already-onboarded user (proven by the BE `verify-sca-derivation.ts` gate before the BE switches to derivation).

**New conventions:**
- AA stack constants live exclusively in `utils/aaConfig.ts`. Never inline `entryPoint`, `kernelVersion`, or `index` elsewhere. The two `aaConfig.ts` files (FE + BE) MUST stay in lockstep.
- Manual-sign userOps go through `createSudoClient`, never through `useSmartWallets`. Do not reintroduce `@privy-io/react-auth/smart-wallets` — `useFundWallet`, `usePrivy`, `useWallets`, `loginWithTelegram` all come from the base `@privy-io/react-auth` and are unaffected.
- The `sudoClient` is built lazily and cached in a ref; it is not built during render. Don't move the construction up into a `useEffect` on mount — the EIP-1193 provider isn't always ready before first user interaction.

## useFetch refetchOnVisible + delegations refresh — 2026-04-28

**What was done:**
- `useFetch.ts`: added optional `refetchOnVisible` flag. When true, registers a `visibilitychange` listener that bumps an internal `tick` (added to the effect deps) so the resource re-pulls whenever the document becomes visible.
- `useAppData.tsx`: enabled `refetchOnVisible: true` on the `delegations` resource (and only that one).

**Why:**
- `ConfigsTab.PermissionsSection` reads `spent_raw`/`limit_raw` via `useDelegations()`. With the BE fix landing in the same change (`addSpent` now wired into `signingRequest.resolveRequest`), the bar will actually move — but `useFetch` was a one-shot effect with no refetch path. The user would run a swap in the chat surface, return to the Configs tab, and still see the stale cached value until full remount. `refetchOnVisible` covers the "user closes the sign mini-app and reopens Configs" path without needing to thread an explicit `refresh()` callback through every handler.
- Limited to `delegations` (not portfolio/yield/profile) to avoid extra load — those have their own freshness expectations.

**Convention:** if a future resource's value changes as a side-effect of an autosigned tx, opt into `refetchOnVisible: true` on its `useFetch` call.

## interpretSignError — Relay solver revert classification — 2026-04-27

**What was done:**
- Added three patterns to `interpretSignError.ts` for Relay solver `Error(string)` reverts: `QUOTE_SWAP_AMOUNT_TOO_SMALL`, `QUOTE_SWAP_AMOUNT_TOO_LARGE`, `NO_LIQUIDITY`. Each matches both the ASCII form and the hex-encoded form (viem surfaces revert data unparsed when the ABI isn't loaded).
- Added matching `SignErrorCode` enum entries: `swap_amount_too_small`, `swap_amount_too_large`, `swap_no_liquidity`.

**Why:**
- Small-amount swaps via /swap (e.g. `$1`) fail at simulation with the solver's `QUOTE_SWAP_AMOUNT_TOO_SMALL` revert. Without classification the user saw a generic "Something went wrong" toast and the BE chat showed only "❌ Swap aborted at step 1/1" — no actionable hint that the amount is the problem.
- Now the user sees "Swap amount is too small for this route. Try a larger amount (typically at least a few dollars)." in both the mini-app error screen and Telegram chat (via `notifyResolved`'s `errorMessage` passthrough).

**Scope:** FE-only error classification. Doesn't change which transactions are sent — only how reverts are explained. No effect on /send, /yield, or the swap's success path.

## SignHandler — fix stale session client across chained steps — 2026-04-27

**What was done:**
- In `SignHandler.tsx`, when chaining to the next swap step via `fetchNextRequest`, clear `sessionClientRef.current = null` before `setCurrentRequest(...)`. The next auto-sign effect re-builds a fresh `KernelAccountClient` via `createSessionKeyClient`.

**Why:**
- The cached `KernelAccountClient` (intended to "avoid re-paying init cost across swap steps") carries internal state from `deserializePermissionAccount` — nonce key, validator/permission resolution. Reusing the same object for a second `sendTransaction` after the first userOp is mined leads to a simulation revert with `0xe52970aa` (a Kernel/permissions error not in the `interpretSignError` table, so it surfaces as `errorCode: "unknown"`). Symptom: step 1 of a /swap succeeds, step 2 reverts during simulation; FE posts a generic rejection and the BE aborts the swap at step 2/2.
- Re-running `createSessionKeyClient` is cheap (one decrypt + a few RPCs) and matches the OLD per-step open/close behavior of the mini app, where each step automatically got a fresh client.

**Scope / blast radius:**
- Only affects the chained-next branch (multi-step flows like /swap and /yield). Single-step flows (/send, single-tx /yield) never enter that branch and therefore see no change.

## Overview
Telegram Mini App (TMA) for **Aegis**, an onchain AI agent. Handles Privy auth (Google + Telegram auto-login), ERC-4337 smart-wallet provisioning, ZeroDev session-key delegation, and a typed request/response bridge to the Aegis backend. Runs inside Telegram WebView; degrades to a normal browser session for dev.

## Tech Stack
- React 19 / Vite 8 / TypeScript (strict)
- Privy v3 (`@privy-io/react-auth`) — `/smart-wallets` removed 2026-05-03 (we derive SCA ourselves now)
- `@tma.js/sdk-react` (dynamic-imported in `TelegramAutoLogin`)
- `viem` + `permissionless` ^0.2
- ZeroDev Kernel v3.1 + EntryPoint 0.7 (`@zerodev/sdk`, `@zerodev/ecdsa-validator`, `@zerodev/permissions`)
- Avalanche C-Chain mainnet (43114) by default; resolved at runtime via `src/utils/chainConfig.ts` (`VITE_CHAIN_ID`). Fuji (43113) still supported for testing.
- Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config.*`)
- Vite + `vite-plugin-node-polyfills` (only `buffer`); `@solana/kit`, `@solana-program/system`, `@solana-program/token` external; `permissionless` must stay bundled.

## Project Layout
```
src/
├── main.tsx                       # Privy + SmartWallets providers + TelegramAutoLogin
├── App.tsx                        # Router: auth gate → request dispatcher
├── index.css                      # Tailwind entry + TMA safe-area body padding
├── telegram.d.ts                  # Telegram WebApp + CloudStorage types
├── components/
│   ├── TelegramAutoLogin.tsx      # Silent loginWithTelegram on TMA mount
│   ├── ApprovalOnboarding.tsx     # Spending-limit grant UI (aegis_guard)
│   ├── StatusView.tsx             # Tabbed home (TabDock: home/activity/points/configs)
│   ├── HomeTab.tsx                # Portfolio + delegation status + YieldPositions
│   ├── PointsTab.tsx              # Loyalty balance, history, leaderboard
│   ├── ConfigsTab.tsx             # Wallet/agent addresses, permissions, disconnect
│   ├── SigningRequestModal.tsx    # Manual sign fallback
│   ├── YieldPositions.tsx         # Inline yield section in HomeTab
│   ├── atomics/                   # icons.tsx, spinner.tsx, FullScreen.tsx
│   ├── handlers/                  # AuthHandler, SignHandler, ApproveHandler,
│   │                              # OnrampHandler, YieldDepositHandler
│   └── views/login.tsx
├── hooks/
│   ├── privy.ts                   # usePrivyToken
│   ├── useRequest.ts              # Reads ?requestId=… and fetches /request/:id
│   ├── useFetch.ts                # Generic authed-GET hook
│   ├── useAppData.tsx             # AppDataProvider — portfolio/grants/yield/config
│   ├── useLoyalty.ts              # useLoyaltyBalance / History / Leaderboard
│   └── useDelegatedKey.ts         # Session-keypair state machine
├── types/miniAppRequest.types.ts  # Single source of truth for DTOs
└── utils/
    ├── crypto.ts                  # Keypair gen, AES-GCM, ZeroDev session-key install
    ├── telegramStorage.ts         # CloudStorage wrapper + localStorage dev fallback
    ├── loggedFetch.ts             # raw per-attempt request logger
    ├── resilientFetch.ts          # 429/5xx jittered backoff (retries 4x, 250ms→2s)
    ├── fetchNextRequest.ts        # polls /request/:id?after=… for next step
    ├── postResponse.ts            # Typed POST /response
    ├── logger.ts                  # createLogger; sonner toasts on warn/error
    └── toErrorMessage.ts
```

Planning docs under `constructions/` are historical, not source-of-truth.

## Environment Variables
| Variable | Purpose |
| -------- | ------- |
| `VITE_PRIVY_APP_ID` | Privy application ID |
| `VITE_BACKEND_URL`  | Backend HTTP API base URL (no trailing slash) |
| `VITE_CHAIN_ID`     | EVM chain ID for session-key ops (default `43114` — Avalanche mainnet) |
| `VITE_CHAIN_RPC_URL` | Standard JSON-RPC for the chain — used by `publicClient` for `eth_call`/`eth_getCode` against kernel factory & validators. **Must NOT be a bundler-only endpoint** (bundler revert envelopes crash viem with `revertError.cause.data.match`). Pimlico's `/v2/<chainId>/rpc` works (it proxies standard RPC too). |
| `VITE_PIMLICO_BUNDLER_URL`  | Pimlico bundler RPC (`https://api.pimlico.io/v2/<chainId>/rpc?apikey=…`) |
| `VITE_PIMLICO_PAYMASTER_URL`| Pimlico paymaster RPC — enables gas sponsorship (same URL as bundler is fine) |
| `VITE_PIMLICO_SPONSORSHIP_POLICY_ID` | Pimlico policy id (e.g. `sp_xxx`) — passed to `getPaymasterData/StubData` so the configured policy actually applies. Without it, paymaster falls back to the project default. |
| `VITE_LOG_LEVEL`    | `debug` \| `info` (default) \| `warn` \| `error` |

All read via `import.meta.env`, narrowed with `?? ''`. See `.env.example`.

## Entry Wiring (`main.tsx`)
- Calls `Telegram.WebApp.ready()`, `.expand()`, header/background `#0f0f1a` **before** React mounts.
- Providers: `StrictMode > PrivyProvider > { TelegramAutoLogin, App }`. (No `SmartWalletsProvider` — removed 2026-05-03 with self-derived SCA.)
- PrivyProvider: `loginMethods: ['google','telegram']`, dark theme, accent `#7c3aed`, `embeddedWallets.ethereum.createOnLogin: 'users-without-wallets'`.

## Top-Level Flow (`App.tsx`)
Single-route URL-driven dispatcher:
1. `!ready` → `<LoadingSpinner />`.
2. `!authenticated || !privyToken` → spinner if inside TMA and `tmaLoginTimedOut===false` (timeout `TMA_AUTO_LOGIN_TIMEOUT_MS=4000`); else `<LoginView />`.
3. No `requestId` → `<StatusView />`.
4. `requestLoading` → spinner; `requestError` → `<ErrorView />`.
5. Dispatch on `request.requestType`: `auth` → `AuthHandler`, `sign` → `SignHandler` (or `YieldDepositHandler` when `request.kind === 'yield_deposit' | 'yield_withdraw'`), `approve` → `ApproveHandler`, `onramp` → `OnrampHandler`.

Session-key auto-bootstrap: guarded by `autoKeyStartedRef`. Skipped for `auth` requests (AuthHandler runs `start()` itself). Inside TMA + no `requestId` → `delegatedKey.start()`. Else → `delegatedKey.unlock()` (restore-only, no popup).

## Typed Request/Response Contract
`src/types/miniAppRequest.types.ts` is the **only** source of truth.
```ts
RequestType    = 'auth' | 'sign' | 'approve' | 'onramp'
ApproveSubtype = 'session_key' | 'aegis_guard'
SignKind       = 'yield_deposit' | 'yield_withdraw'  // optional; routes to YieldDepositHandler
```
- `AuthRequest` → `{ telegramChatId }`
- `SignRequest` → `{ to, value (wei dec string), data (0x), description, autoSign, kind?, chainId?, protocolId?, tokenAddress?, steps?, displayMeta? }`
- `SignResponse` → `{ txHash? } | { rejected: true, errorCode?, errorMessage? }`. **Convention:** on `sendTransaction` failure, FE posts `rejected: true` with the `errorCode` from `interpretSignError` so the BE can drive recovery flows (e.g. `insufficient_token_balance` → /buy nudge in `notifyResolved`). Codes are stable strings; add new ones in lockstep with `SignErrorCode` in `interpretSignError.ts`.
- `ApproveRequest` → `{ subtype, suggestedTokens?, reapproval?, tokenAddress?, amountRaw? }`
- `OnrampRequest` → `{ amount, asset:'USDC', chainId, walletAddress }` (`walletAddress` is the SCA, **not** the EOA)

Responses: `POST {backendUrl}/response` via `postResponse()`. Shapes mirror request type.

## Backend HTTP Endpoints (consumed)
| Method & Path | Used by |
| -------- | ------- |
| `GET  /request/:requestId`              | `useRequest` (requires Privy `Authorization` except for `requestType === 'auth'`) |
| `GET  /request/:requestId?after=<id>`   | `fetchNextRequest` (next queued step or 404) |
| `POST /response`                         | `postResponse` |
| `GET  /portfolio`                        | `AppDataProvider` (HomeTab) |
| `GET  /yield/positions`                  | `AppDataProvider` (YieldPositions) |
| `GET  /delegation/grant`                 | `AppDataProvider` (ConfigsTab) |
| `POST /delegation/grant`                 | `ApprovalOnboarding` |
| `GET  /delegation/approval-params`       | `ApprovalOnboarding` (forwards `tokenAddress`+`amountRaw` query) |
| `GET  /loyalty/balance`                  | `useLoyaltyBalance` |
| `GET  /loyalty/history?limit=&cursorCreatedAtEpoch=` | `useLoyaltyHistory` |
| `GET  /loyalty/leaderboard?limit=`       | `useLoyaltyLeaderboard` (no auth header) |
| `GET  /transfers?direction=&limit=&cursor=&fromEpoch=&toEpoch=` | `useTransferHistory` (Activity tab) — Ankr-backed, BE returns `{ items: TransferRecord[], nextCursor }`. 429 surfaces as a non-error UX state. |

All authed calls send `Authorization: Bearer ${privyToken}`. 404/410 on `/request/:id` → "not found" / "expired".

## Handlers

### `AuthHandler`
Three-step effect chain, each ref-guarded against StrictMode:
1. POST auth response → optional `approveRequestId`. Prefer `Telegram.WebApp.initDataUnsafe.user.id` over `request.telegramChatId`.
2. If `approveRequestId`, call `startDelegatedKey()` once state is `idle`.
3. On `done`, POST approve response with `subtype: 'session_key'` + `delegationRecord`.
4. On `allDone`, `Telegram.WebApp.close()` after 1500ms.

### `SignHandler`
- `currentRequest` state initialised from prop; resyncs when parent passes a new `requestId`.
- `autoSign === true`: build session client via `createSessionKeyClient` (cached in `sessionClientRef` across steps; cleared before chaining to next step — see "Stale session client" entry above), `sendTransaction({ chain: null })` wrapped in `trackInFlightBroadcast`, POST `{ txHash }`. Then `fetchNextRequest(...)` — if next, reset `autoSignAttemptedRef` + `setCurrentRequest(next)`; on 404, close.
- Manual fallback (`autoSign:false`, or 10s timer with `keyStatus !== 'processing'`): render `<SigningRequestModal />`. Approve builds a sudo client lazily via `createSudoClient(provider, eoa, …)` (Privy EOA path, no Pimlico paymaster). Do **not** reintroduce `useSmartWallets()`.
- Reject → POST `{ rejected: true }` + close.
- Takes `keyStatus` prop; only arms 10s fallback when not `processing` (see Rule 5 below).

### `YieldDepositHandler`
Single file; `mode: 'deposit' | 'withdraw'`. Auto-open-and-sign when `autoSign && serializedBlob`: opens in `'signing'`, runs the session-key pipeline, POSTs txHash, closes after 1500ms. Fallback shows pre-sign confirmation with `displayMeta` (protocol, token, amount, APY); manual send builds a sudo client via `createSudoClient(...)`. Auto-sign failures fall back to the manual screen with inline error banner. Currently waits indefinitely on blob (no fallback timer).

### `ApproveHandler`
- `subtype === 'session_key'`: auto `startDelegatedKey()`, POST delegation record, close.
- `subtype === 'aegis_guard'`: render `<ApprovalOnboarding />`. ApprovalOnboarding reads `tokenAddress`+`amountRaw` from **props only** — never URL.

### `OnrampHandler`
Auto-invokes `useFundWallet().fundWallet({ address: request.walletAddress, chain: { id: request.chainId }, options: { asset: 'USDC' } })` once `ready && authenticated`. No confirmation (already confirmed upstream by Telegram button click). Errors render retry + monospace SCA address fallback. **Convention:** a handler may auto-invoke its primary action when the user already confirmed upstream.

## `useDelegatedKey` Conventions
- **Deterministic seed** — keypair AES-GCM encrypted with `privyDid` as PBKDF2 password. No prompt ever.
- Storage key: `STORAGE_KEY = "delegated_key"` in Telegram CloudStorage.
- State machine: `idle | processing{step} | done{record} | error{message}`.
- `start()` idempotent: CloudStorage hit → decrypt; miss → create + install + encrypt. Decrypt failure falls through to create.
- `unlock()` restore-only — never generates, never popups. Stale blobs cleared, drops to `idle`.
- `removeKey()` wipes CloudStorage; transitions to `error` ("reload to create").
- `updateBlob(newBlob)` re-encrypts without regenerating (used when reinstalling on-chain permissions).
- Rejection: `err.code === 4001` or `err.message.includes('User rejected')`.
- Exposes both `serializedBlob` state **and** `serializedBlobRef` (sync access in async callbacks) — deliberate.
- `DEFAULT_PERMISSIONS` is placeholder (native AVAX, ~30d, 1×10¹⁸); real per-token limits flow through `ApprovalOnboarding` → `POST /delegation/grant`.

## `utils/crypto.ts` Conventions
- **Never** use `installSessionKeyWithErc20Limits` (removed 2026-04-22). Only `installSessionKey` (sudo policy) exists. Per-token limits enforced **server-side**.
- AES-GCM blob: `[16 salt][12 iv][ciphertext]`, PBKDF2-SHA256 @ 100k iters. Use `encryptBlob`/`decryptBlob` only.
- Install path: `privy embedded provider → viem WalletClient → toOwner → signerToEcdsaValidator → toECDSASigner(empty addr) → toPermissionValidator({ policies:[toSudoPolicy({})] }) → createKernelAccount({ plugins:{sudo,regular} }) → serializePermissionAccount(account, sessionPrivateKey)`.
- **Serialized blob contains the session private key.** Store only in (encrypted) CloudStorage. **Never** send to backend.
- `createSessionKeyClient(blob, BUNDLER_URL, PAYMASTER_URL)` paymaster: pass URL → Pimlico-sponsored client; omit → SCA pays. Uses `createPimlicoClient` with EntryPoint 0.7 + gas oracle hook.
- Chain is driven by `getChain()` from `utils/chainConfig.ts` (reads `VITE_CHAIN_ID`). Do not pass `chain` as a parameter — it is resolved internally. **Add new chains to `chainConfig.ts`, not inline.**

## Styling Conventions
- BG: `bg-[#0f0f1a]` full-screen; `bg-[#161624]` / `#16162a` cards; `bg-white/5` / `bg-white/[0.04]` rows.
- Borders: `border-white/10` (cards), `/[0.08]` subtle, `border-violet-500/20` accent.
- Brand: violet-500/600 (`#7c3aed`) + indigo-600 gradients; emerald-400 success; amber-500 warn; red-400/500 error.
- Shield+checkmark = Aegis logo (use per-instance `linearGradient id` like `auth-ok-shield`).
- Full-screen layout: `flex flex-col items-center justify-center w-full min-h-dvh bg-[#0f0f1a] px-6 gap-N`. Always `min-h-dvh`.
- Spinner: `w-8 h-8 rounded-full border-2 border-violet-500/20 border-t-violet-500 animate-spin`.
- Section labels: `text-[10px] font-semibold tracking-widest text-white/30 uppercase`.
- Safe areas already on `body` in `index.css` — don't re-add.
- Prefer Tailwind arbitrary values; no `tailwind.config.*` exists.

## Telegram WebView Conventions
- `window.Telegram?.WebApp?.initData` presence = canonical "inside Telegram" check (`isInsideTelegram()` in `App.tsx`).
- All success flows: `window.Telegram?.WebApp?.close()` after 1500ms "Taking you back…" screen.
- CloudStorage gated to WebApp v6.9+; `telegramStorage.ts` installs a localStorage mock at module load. Always go through `cloudStorageGetItem/SetItem/RemoveItem`.
- `TelegramAutoLogin` is silent: errors never surface, logs only in `import.meta.env.DEV`. `loginWithTelegram` `@ts-ignore` is intentional.

## Logging & Debug
- **Logger** (`src/utils/logger.ts`): `const log = createLogger('Module')`. Raw `console.*` forbidden except early `main.tsx` bootstrap.
- Levels: `debug`/`info` → console + DebugTab buffer; `warn`/`error` → also sonner toasts.
- Runtime gate: `localStorage["aegis.logLevel"]` or `window.__aegisLog("debug")`. Build-time default via `VITE_LOG_LEVEL=info`.
- Output prefix `[AEGIS:scope]` — `useDebugEntries` filters on this.
- DebugTab levels: log (white), info (blue), warn (yellow), error (red); 4-button toggle.
- **Privacy:** never log `privyToken`, `initData`, `serializedBlob`, `privyDid`, signatures. Truncate via `token.slice(0,8)+'…'`.
- **Step pattern (handlers):** `log.info('step', { step: 'started'|'submitted'|'succeeded'|'failed', requestId })`.
- `<Toaster>` mounted once in `App.tsx`: `position="top-center" richColors closeButton theme="dark"`.
- Dev-only UI (e.g. "Wipe CloudStorage" in `ApprovalOnboarding`) gated on `import.meta.env.DEV`.

## Coding Conventions
- React 19 function components only. Default export only at `App.tsx` / `main.tsx`.
- Refs guard StrictMode double-fires (`hasStartedRef`, `attemptedRef`, `authPostedRef`, …) on every single-shot effect.
- `0x${string}` for addresses/hex; raw amounts: `string` over wire, `BigInt(...)` at call site.
- Async IIFE in `useEffect`; never `async` the effect itself.
- Errors: `toErrorMessage(err)` for display; otherwise narrow with `err instanceof Error`.
- Flat by convention — `src/utils` and `src/components` (except `atomics/`, `handlers/`, `views/`).
- `eslint-disable-next-line react-hooks/exhaustive-deps` allowed when narrowly scoped.

## Build & Scripts
`dev`/`build`/`typecheck` (`tsc -b`)/`lint`/`preview`. `overrides.ox: 0.14.5` pinned for Privy/viem transitive — don't bump without checking peer range.

---

## Feature Log

### Mainnet default + FE chainConfig extraction (2026-04-27)
**What:** Extracted chain resolution out of `crypto.ts` into `utils/chainConfig.ts` (a small registry keyed by chain id). `crypto.ts` now imports `getChain()`. Backend default `CHAIN_ID` flipped from `43113` → `43114`; backend `chainConfig.ts` no longer carries the dead `bundlerUrl`/`paymasterUrl` fields (Pimlico lives in the FE). Drizzle seeds (`tokenRegistry.ts`, `transferToken.ts`) are now CHAIN_ID-driven with both mainnet and Fuji token tables.
**Why:** Inline chain switch in `crypto.ts` violated CLAUDE.md "chain-agnostic" rule; dead BE config invited drift. Mainnet is the live target.
**New conventions:** add new chains by extending `utils/chainConfig.ts` (FE) and `helpers/chainConfig.ts` (BE) — never inline. Seed scripts read `CHAIN_ID` env, default `43114`.

### Pimlico bundler/paymaster migration (2026-04-27)
**What:** Replaced ZeroDev infra (bundler + paymaster) with Pimlico in `crypto.ts`. All `@zerodev/*` SDK packages are **kept** (they provide Kernel v3.1 contract bindings — removing them would break all existing smart accounts). Chain is now driven by `VITE_CHAIN_ID` (defaulting to Avalanche mainnet 43114) via a `getChain()` helper — no more hardcoded `avalancheFuji`.

**Why:** ZeroDev Pro plan ($69/mo) required for mainnet RPC traffic; Pimlico is PAYG with a free tier. Chain ID was hardcoded to Fuji (43113) but the live app runs on mainnet (43114).

**New conventions:**
- Env vars are `VITE_PIMLICO_BUNDLER_URL` / `VITE_PIMLICO_PAYMASTER_URL` (old `VITE_ZERODEV_RPC` / `VITE_PAYMASTER_URL` are gone).
- `VITE_CHAIN_ID` controls which viem chain is used in `crypto.ts`; resolves via `getChain()` — add new chain IDs there.
- The term "ZeroDev" remains only as the wire-format label `ZerodevMessage` on the FE↔BE delegation protocol — do not rename in unrelated PRs.
- `createSessionKeyClient` now uses `createPimlicoClient` (from `permissionless/clients/pimlico`) with EntryPoint 0.7 pinned, and includes `estimateFeesPerGas` via `getUserOperationGasPrice().fast` (recommended on Avalanche to avoid stale gas estimates).

**Rollback:** revert `crypto.ts` + 3 mechanical renames + restore old env vars — no on-chain state changes.

### Endpoint auth hardening — `useRequest` (2026-04-25)
`GET /request/:requestId` now requires `Authorization: Bearer <privyToken>` for `sign`/`approve` requests. `useRequest` pulls the token via `usePrivyToken()` and attaches it when non-null. The token is omitted on the first hit for `auth` requests (user has no token yet — BE keeps this endpoint unauthenticated for `auth`). 401/403 responses surface via `log.warn` (→ sonner toast). Token is never logged.

### Points / Loyalty (2026-04-25)
Read-only Points tab: balance card, recent ledger activity (cursor-paginated), top-10 leaderboard.
- Hooks (`useLoyalty.ts`): `useLoyaltyBalance`, `useLoyaltyHistory` (`loadMore()`+`hasMore`), `useLoyaltyLeaderboard`. Internal `useResilientGet` consolidates cancel+tick+visibility for balance/leaderboard. Each hook returns explicit `unauthorized` flag — only true 401 collapses to leaderboard-only.
- Balance refetches on `visibilitychange`; history resets to page 0.
- `pointsTotal` is opaque string throughout — never `Number()`.
- Leaderboard call omits `Authorization` (public endpoint).
- `ACTION_LABELS` map at top of `PointsTab.tsx`. Seven canonical BE actionTypes: `swap_same_chain`, `swap_cross_chain`, `send_erc20`, `yield_deposit`, `yield_hold_day`, `referral`, `manual_adjust`. Unknown ids render raw.
- BE timestamps are **epoch seconds** (`newCurrentUTCEpoch()`) — `relativeTime` operates on seconds.
- `nextCursor` = `createdAtEpoch` of last row or null. `hasMore = cursor != null` (never compare lengths).

### Yield Optimization (2026-04-24)
- New `SignKind` values `yield_deposit | yield_withdraw` route to `YieldDepositHandler` before `SignHandler`.
- Wire contract `GET /yield/positions` → `{ positions: YieldPosition[], totals: { principalHuman, currentValueHuman, pnlHuman } }`. `YieldPosition`: `protocolId, protocolName, chainId, tokenSymbol, principalHuman, currentValueHuman, pnlHuman, pnl24hHuman, apy`. `parseYieldPositions` in `useAppData.tsx` normalises.
- `YieldPositions` component mounted inline below portfolio in `HomeTab` (chosen over a dedicated route).
- **Convention:** yield `SignRequest.kind` prefixed `yield_`; positions go through `AppDataProvider` (`useYieldPositions()`) — never ad-hoc fetch.

### Multi-step swap (2026-04-24)
`SignHandler` chains via `fetchNextRequest(backendUrl, requestId)` on `GET /request/:id?after=<prev>`; backend indexes pending sign requests per-user in Redis ZSET (`user_pending_signs:<userId>`). Fixed-interval retry 6×400ms (BE creates step N+1 shortly after FE posts step N). Convention: a handler MAY keep the WebApp open across multiple same-type requests when BE signals continuation; default remains close-after-one. **`fetchNextRequest` lives in `utils/`, not `hooks/`** — utilities, not React hooks.

### Onramp (2026-04-23)
`requestType: 'onramp'` → `OnrampHandler` (see Handlers above).

### Resilient fetch (2026-04-24)
- `resilientFetch.ts`: retries 429/502/503/504 up to 4× with jittered exp backoff (250ms→2s); honors `Retry-After`; 401/404/410 pass through immediately. Used in `postResponse`, `fetchNextRequest`, `useFetch`.
- `fetchNextRequest` keeps its own outer 404-retry loop (6×400ms) for "BE creating next step" — different job from `resilientFetch`'s transport retry. Don't collapse.
- `toErrorMessage`: 429/503 → `'Service is busy. Try again in a moment.'`.
- **Stateless-routing invariant** (verified 2026-04-24): zero use of cookies, `credentials: 'include'`, or server-issued opaque handles in client state. Every request self-authenticates with `Authorization: Bearer <privyToken>`. Server-issued `requestId` resolves on any replica via Redis. Violations require `// STATELESS-AUDIT: allowed because <reason>` + BE sticky-routing config.

### AppDataProvider — global tab data (2026-04-23)
`useAppData.tsx` owns `useFetch` for portfolio, grants, yield positions; provider mounted once around `StatusView` tabs so tab-switch doesn't refire fetches. Selectors: `usePortfolio()`, `useDelegations()`, `useYieldPositions()`, `useAppConfig()` (returns `{backendUrl, privyToken}`). Parsers (`parsePortfolio`, `parseGrants`, `parseYieldPositions`) and types live here. **Convention:** shared cross-tab data belongs in `AppDataProvider`; do not call `useFetch` inline in tabs that can be unmounted by `TabDock`. Mutation refresh hook not yet wired (provider lifetime ≈ one session).
**Cross-cutting risk:** `backendUrl`+`privyToken` in context value re-render consumers when token rotates; benign because Privy tokens are stable for session lifetime.

### ConfigsTab permissions field alignment (2026-04-23)
FE was reading `symbol`/`maxAmount`/`spent` but BE (`TokenDelegation`) emits `tokenSymbol`/`limitRaw`/`spentRaw`/`tokenDecimals`. Renamed FE fields. **Convention:** when surfacing delegation rows, divide `limitRaw`/`spentRaw` by `10 ** tokenDecimals` via BigInt — never display raw.

### Frictionless delegation refactor (2026-04-22) — REMOVED, do not reintroduce
`PasswordDialog`, `AegisGuardToggle`, `AegisGuardModal`, `useAegisGuard`, `installSessionKeyWithErc20Limits`, `Erc20SpendingLimit`, password-based blob encryption.

### Dead-code cleanup (2026-04-23) — REMOVED, do not reintroduce
`SigningApprovalModal`, `signingInterceptor`, `decodeEip712`, `DelegationDebugPanel`, `ErrorView` (replaced by `FullScreenError`), unused `Keypair` / `AegisGrant` / duplicate `DelegationRecord` exports.

### Shared atomics (post-2026-04-23)
- `atomics/spinner.tsx`: `<Spinner size="xs|sm|md|lg" />`, `<LoadingSpinner />`.
- `atomics/icons.tsx`: `<ShieldIcon size? variant="violet|success">` (gradient id via `useId()`), `<GoogleIcon />`.
- `atomics/FullScreen.tsx`: `<FullScreen>`, `<FullScreenLoading step?>`, `<FullScreenError message showClose?>`, `<FullScreenSuccess title subtitle?>` — caller still calls `.close()` itself.

### Recipient notifications — superseded by ActivityTab (2026-05-03)
The earlier `RecentTransfers` block in `HomeTab` (backed by `useNotifications` → `GET /notifications` + welcome flush via `GET /me`) was **never wired on the BE** — those endpoints don't exist. The Activity tab (May 3) replaces that surface using the BE's actual `GET /transfers` (Ankr-backed). `useNotifications` is currently a stub returning `[]` and `RecentTransfers` is dead code; do not extend it. Use the ActivityTab pattern (`useTransferHistory`) for any future "who paid me" surfacing.
- `buildExplorerUrl(chainId, txHash)` and `chainName(chainId)` in `utils/chainConfig.ts` are still the canonical helpers — extend there for new chains.

---

## Critical Rules — Sign Flow (DO NOT VIOLATE)

Source: hard-won fixes 2026-04-24. Read before touching `SignHandler.tsx`, `YieldDepositHandler.tsx`, or any new auto-signing handler.

### Three request classes
1. **`autoSign: true`** — BE emitted via `sign_calldata`; delegation already sufficient. Mini-app must execute silently via session key. **Do not prompt user.**
2. **`autoSign: false`** — explicit confirmation required. `SigningRequestModal` + Privy smart-wallet client.
3. **`auth` / `approve`** — separate handlers; drive `delegatedKey.start()` themselves.

### Rule 1: auto-sign failures MUST NOT pop manual modal
Manual sign uses the same SCA + chain + paymaster — if session-key UserOp fails (AA21, paymaster 404, prefund), manual fails identically and submits a second doomed UserOp. Render a full-screen error view instead: raw error text (selectable, copyable), diagnostics (`bundler:set|MISSING`, `paymaster:set|MISSING`, `to`, `value`, `dataLen`), Close button.

### Rule 2: `SigningRequestModal` is only for `autoSign: false`
Modal builds a sudo client via `createSudoClient(provider, eoa, ...)` (Privy EOA, no Pimlico paymaster). Never a fallback for an auto-sign path expecting sponsorship. Handler split:
- `autoSign: true` → `createSessionKeyClient(blob, BUNDLER_URL, PAYMASTER_URL)`.
- `autoSign: false` → `createSudoClient(...)` (lazily built; see `utils/createSudoClient.ts`).

### Rule 3: Pimlico — one URL for bundler and paymaster
Both `VITE_PIMLICO_BUNDLER_URL` and `VITE_PIMLICO_PAYMASTER_URL` can point at the same Pimlico per-chain endpoint (`https://api.pimlico.io/v2/<chainId>/rpc?apikey=…`). Pimlico routes `eth_sendUserOperation` vs `pm_getPaymasterStubData` internally. Keep them as two separate env vars for independent override capability.

### Rule 4: `autoSignError` must stay surfaced
Never `setAutoSignError(null)` without also clearing `autoSignAttemptedRef.current`. Never render only as a toast/banner — must be in a copyable view (Telegram clips overlays). Log every failure with `[AEGIS:SignHandler]` prefix.

### Rule 5: `serializedBlob === null` is not terminal
Pair with `delegatedKey.state.status`:
- `processing` → wait indefinitely (unlock in flight).
- `idle`/`error` no blob → genuine "no key"; arming 10s fallback OK.
- `done` with blob → execute.

Any new auto-sign handler **must** take `keyStatus` as a prop from `App.tsx`.

### Rule 6: Broadcast dedupe is two-layered — both required
A signing payload `(to, value, data)` can arrive twice for one user intent (BE re-emits `sign_calldata` after a `waitFor` timeout, agent loops, FE effect re-fires on swap, StrictMode double-mount). Without dedupe, the first send mines + drains the wallet and the second send's bundler-side gas estimation reverts with `ERC20: transfer amount exceeds balance` — surfaced as a spurious error toast over a successful tx.

Two layers in `utils/recentBroadcasts.ts`:
- `trackInFlightBroadcast(to, value, data, send)` — in-memory `Map<payloadKey, Promise<hash>>`. Coalesces *concurrent* sends within the tab. Always wrap `sessionClient.sendTransaction` in this for auto-sign paths.
- `findRecentBroadcast(...)` + `recordBroadcast(...)` — localStorage, 10min TTL. Catches *post-completion* duplicates across reloads.

Order in handler: check `findRecentBroadcast` first (reuse hash, skip send); else `trackInFlightBroadcast(...)` to do the send. `recordBroadcast` is called by `trackInFlightBroadcast` on success — do not call it directly.

### Pre-ship checklist (new sign-capable handler)
- [ ] `autoSign:true` path uses `createSessionKeyClient` with both `ZERODEV_RPC`+`PAYMASTER_URL`.
- [ ] Auto-sign errors render a persistent error view, not a modal.
- [ ] `autoSign:false` path uses `SigningRequestModal`.
- [ ] Consumes `keyStatus` and waits on `processing`.
- [ ] Logs `[AEGIS:<HandlerName>]` prefix.
- [ ] No hardcoded chain object/RPC — pull from `utils/chainConfig.ts`/env.

---

## Known Invariants / Gotchas
- Chain is driven by `VITE_CHAIN_ID` (defaults `43114` — Avalanche mainnet). `getChain()` in `utils/chainConfig.ts` resolves it to a viem chain object; **add new chains to that registry, not inline**. Multi-chain support already threads `chain` through all clients in `installSessionKey` / `createSessionKeyClient`.
- Privy token refresh is the caller's responsibility — `usePrivyToken` fetches once on `authenticated` flip; long sessions may see stale tokens. Re-mount or call `getAccessToken()` if 401 bounces.
- `useRequest` reads `requestId` once at mount. For chained swap steps, `SignHandler` uses `fetchNextRequest` directly — URL stays fixed.
- Manual-sign userOps go through `createSudoClient(provider, eoa, ...)` — `useSmartWallets()` and `SmartWalletsProvider` are gone (removed 2026-05-03). FE+BE `aaConfig.ts` MUST stay in lockstep (entry point 0.7, Kernel V3.1, `index = 0n`).
- No test runner — static stateless-routing regression guard deferred until vitest is added.

---

## 2026-05-04 — Multi-chain (BSC) support for Aster tokenized stocks

**What changed:**
- `utils/chainConfig.ts` is now a real multi-chain registry (`CHAIN_REGISTRY`). Per-chain helpers (`getChainById`, `getRpcUrlById`, `getBundlerUrl`, `getPaymasterUrl`, `getSponsorshipPolicyId`, `isSupportedChain`, `getOnboardingChainIds`). Backwards-compatible `getChain()` / `getChainId()` / `getRpcUrl()` continue to resolve to the home chain (`VITE_CHAIN_ID`, default 43114).
- `createSudoClient(provider, signerAddress, chainId)` and `createSessionKeyClient(serializedBlob, chainId)` and `installSessionKey(provider, signerAddress, sk, addr, chainId)` are all **chain-id-aware**. The old (bundler/paymaster URL) parameter forms are gone — never re-introduce them. Bundler/paymaster URLs come from the registry by `chainId`.
- `SignHandler` and `YieldDepositHandler` cache `KernelAccountClient` instances **per chainId** (`Map<number, ...>`). Cross-chain step lists (e.g. `/stock buy` bridging Avax → BSC) re-use cached clients within the session. Each client carries `chain.id`; an assertion catches accidental drift.
- `SignHandler` reads `request.chainId ?? getChainId()` per step and passes it to both `getSessionClient` and `getSudoClient`. Logs include `chainId`.

**Multi-chain delegation:**
- `useDelegatedKey({ chainIds })` installs the **same** session-key keypair on each chain in sequence. Storage payload now carries `{ privateKey, address, blobs: Record<chainId, blob>, installedChainIds: number[] }`. Legacy single-`blob` storage still decodes (assumed home chain).
- Eager onboarding (`App.tsx`) defaults to `getOnboardingChainIds()` — home chain plus BSC when `VITE_BSC_PIMLICO_BUNDLER_URL` is set. Skipped automatically otherwise (no broken popups).
- Existing-user top-up: when a `SignRequest.chainId` arrives for a chain not yet installed, `SignHandler` renders `BscDelegationModal` instead of auto-signing. The user signs once; `installOnChain(chainId)` installs and the parent re-renders, auto-sign proceeds.
- `ApprovalOnboarding` now fetches `/delegation/approval-params?chainId=…` and POSTs `/delegation/grant` **per chain** sequentially. Body includes `{ delegations, chainId }` for each. BE plan P2.3 is the contract.

**New env vars:**
- `VITE_BSC_RPC_URL`, `VITE_BSC_PIMLICO_BUNDLER_URL`, `VITE_BSC_PIMLICO_PAYMASTER_URL`, `VITE_BSC_PIMLICO_SPONSORSHIP_POLICY_ID`.
- `VITE_ONBOARDING_CHAIN_IDS` (optional comma-separated override).

**Sign-error codes (lockstep with BE `notifyResolved.ts`):**
Added `aster_pair_inactive`, `aster_min_size`, `aster_max_position`, `aster_oracle_stale`, `aster_insufficient_collateral`, `stock_recovery_failed` to `SignErrorCode` + `PATTERNS`. Adding any new code requires the matching BE branch in the same PR.

**Recovery flow (BSC venue revert):**
There is no in-session recovery. The BE corrects design (see BE plan P2.5) emits a fresh `mini_app` artifact for the return swap; the user closes the failed mini-app, taps the new chat prompt, signs once. The FE needed zero new code for this — only the `aster_*` error mappings.

**Conventions added:**
- New scopes: `BscDelegationModal`, `ApprovalOnboarding` (logger added).
- Per-chain client caches must use `Map<number, KernelAccountClient>` (or `SessionClient`) — never a single ref. Drop a chain's entry on `'next swap step'` invalidation, not all entries.
- All sign-related logs include `chainId`. Same for `installSessionKey` / `createSessionKeyClient` debug.
- `aaConfig.ts` (FE) ↔ `aaConfig.ts` (BE) byte-identical — chain-agnostic, do not change for this feature.

---

## 2026-05-05 — Telegram CloudStorage: timeouts + transparent chunking

**What changed:** `utils/telegramStorage.ts` now wraps every CloudStorage callback in a 15s timeout (`withTimeout`) and transparently chunks values larger than `MAX_CHUNK_CHARS = 3800` across `${key}_c${i}` slots, with a `__aegis_chunks_v1:<N>` manifest at the main key. Read/write/remove are unchanged in shape — callers (`useDelegatedKey`) need no edits.

**Why:** Multi-chain delegation made the encrypted `delegated_key` payload exceed Telegram's 4096-byte per-value cap. Telegram silently drops the `setItem` callback in that case, so `persistAll()` (`useDelegatedKey.ts:109`) hung forever and setup got stuck on the "Storing session key…" step. Alternatives considered: (a) compressing the payload — fragile, still bounded; (b) moving storage server-side — rejected, would defeat the FE-owned key custody model. Chunking is local, reversible, and the 1024-key Telegram limit gives plenty of headroom.

**Conventions introduced:**
- New module logger scope: `telegramStorage`. Emits `cloudstorage-timeout` (warn — surfaces as toast since hangs are user-visible-worthy), `chunked-read` / `chunked-write` (debug), `chunked-read-missing` (warn — torn write). Metadata fields: `op`, `key`, `chunks`, `totalChars`, `missingIndex`, `expected`, `timeoutMs`.
- Write order: chunks first, **then** manifest. A torn write leaves the main key holding the prior (or no) manifest — never a manifest pointing at missing chunks.
- Every set first calls `clearChunksIfAny(key)` to evict stale chunks from a previous larger value, so shrinking rewrites can't be misread by a later chunked read.
- Manifest sentinel `__aegis_chunks_v1:` is reserved — do not write user data starting with this prefix to any CloudStorage key. Bumping the format requires a new prefix (`v2:`) and a read-side fallback for both.
- Backward compatible with pre-chunking single-value entries (no manifest → returned as-is).
