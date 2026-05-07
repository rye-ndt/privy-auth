# Stage 4 — One-Click Bet Execution (FE construction doc)

Date: 2026-05-07
Companion to `be/constructions/2026-05-07-prediction-markets-stage4.md`. The BE doc is the source of truth for architecture and decisions; this doc covers everything that runs inside the Privy mini-app.

## What the FE owns

The mini-app is the **signing context**. All cryptographic actions (UserOps on Avalanche/Polygon, Polymarket EIP-712 order signing, Polymarket L1 auth message) run inside the mini-app using the session key loaded from Telegram cloud storage. The BE never holds the key.

Concretely, the FE owns:

1. **Two deep-link handlers** for bet execution and position close.
2. **First-bet setup execution** (§4 of BE doc) — running the 4-step setup state machine in-app.
3. **Steady-state bet execution** — running the §3 BE-doc state machine (bridge → SCA→EOA transfer → order sign → submit → fill polling).
4. **Close-position execution** — symmetric flow.
5. **Resumability** when the app is closed mid-flow.
6. **Drift re-confirmation UX** when the live Polymarket price has moved since the finding card was broadcast.
7. **Result-card rendering** for the BE-defined card types (the BE emits the IntentResult; FE renders it).

The chat-side conversational steps (amount prompt, confirm card, "Bridging..." progress messages, final receipt) are **BE-rendered** via the existing chat/result-card pipeline. FE only enters the picture once the user taps **Confirm** and the mini-app deep-links open.

## 1. Deep-link handlers

### `PlaceBetHandler.tsx`

Path: `fe/privy-auth/src/handlers/PlaceBetHandler.tsx`

Trigger: deep link `tg://...?startapp=place_bet:<intentId>` opens the mini-app with `intentId` in the URL.

Responsibilities:

1. Fetch intent + bet rows from BE (`GET /predictionMarket/intent/:id`).
2. If user setup not complete (`predictionMarketUserSetup.setupStep !== 'complete'`) → run setup state machine (§2). Otherwise skip.
3. Run bet execution state machine (§3).
4. Surface every step transition through `log.info('step', { step, requestId, betId })`. The DebugTab and BE telemetry both consume these.
5. On terminal state (filled / partial / unfilled / failed) → POST `/predictionMarket/bet/:id/finalize` so the BE can render the appropriate receipt card to the chat. Then close the mini-app.

### `ClosePositionHandler.tsx`

Path: `fe/privy-auth/src/handlers/ClosePositionHandler.tsx`

Trigger: deep link `...?startapp=close_position:<positionId>`.

Responsibilities:

1. Fetch position row.
2. Build a sell limit order on `outcomeTokenId` at top-of-book − slippage. Sign with session key, POST to BE's `/predictionMarket/order/sell`.
3. Wait for fill (poll), then trigger EOA→SCA USDC transfer.
4. POST `/predictionMarket/position/:id/finalize`. Close mini-app.

## 2. First-bet setup state machine

Runs once per user, on the first time `PlaceBetHandler` opens. Idempotent — each transition POSTs its outcome to the BE before advancing, so a mid-flow close resumes correctly.

```
pending
  → sca_deployed       (Polygon SCA + delegated session key)
  → gas_funded         (~0.05 MATIC dust delivered to EOA)
  → approved           (3 approvals from EOA: USDC × CTF/NegRisk/NegRiskAdapter)
  → authed             (Polymarket L1 sig → L2 creds derived and stored)
  → complete
```

Each step:

| Step | What runs in-app | Signing | Network |
|---|---|---|---|
| `sca_deployed` | Use existing session-delegation flow with `chainId = polygon`. Reuses Avalanche onboarding code; only the chain target differs. | UserOp on Polygon (counterfactual deploy on first interaction) | session key |
| `gas_funded` | Build Relay quote → Polygon EOA recipient, EXACT_OUTPUT MATIC dust. Sign on Avalanche SCA. **Fallback** if Relay can't deliver MATIC direct to EOA: deliver to Polygon SCA then `transfer(EOA, dust)` UserOp. | UserOp on Avax SCA + (fallback) UserOp on Polygon SCA | session key |
| `approved` | Three EOA → exchange `USDC.approve(MAX)` txs + `ConditionalTokens.setApprovalForAll`. EOA signs directly with the session key (the EOA private key is the session key). | EOA tx, MATIC paid from dust | session key |
| `authed` | Sign Polymarket "Generate API key" EIP-712 with session key. POST to Polymarket `/auth/api-key`. POST creds to BE for AES-encrypted storage. | EIP-712 sig | session key |

The session key signs every step silently. **Zero wallet prompts.** Total time on first bet: ~15s of progress UI; then the bet flow runs immediately after.

If a step fails: write `setupStep` failure outcome, surface as a `log.error('setup-failed', { step, requestId, err })` (which auto-toasts via the existing logger contract). User can retry by re-tapping Confirm in chat.

## 3. Bet execution state machine

Mirrors BE doc §3 exactly:

```
INITIATED → BRIDGING → BRIDGED → SCA_TO_EOA → ORDER_SIGNED
  → ORDER_SUBMITTED → {FILLED | PARTIAL | UNFILLED | FAILED}
```

FE responsibilities per state:

| State | FE action |
|---|---|
| `BRIDGING` | Build Relay quote (`EXACT_OUTPUT`, `recipient = Polygon SCA`, `currency = USDC`). Sign on Avax SCA. POST quote response to BE. Poll BE's `/predictionMarket/bet/:id/bridge-status` (BE polls Relay's intent endpoint and exposes a unified status to FE). |
| `BRIDGED` | Re-read SCA Polygon USDC balance via on-chain RPC. POST balance to BE for state transition. |
| `SCA_TO_EOA` | Build UserOp `USDC.transfer(EOA, stake)` from Polygon SCA. Sign with session key. Submit. Wait for receipt. |
| `ORDER_SIGNED` | Fetch live top-of-book from BE (`GET /predictionMarket/orderbook/:tokenId`). If `\|live - ref\| > maxOrderDriftBps` → POST `/predictionMarket/bet/:id/drift-detected` so BE re-prompts user in chat; close mini-app and wait. Else: build EIP-712 order, sign with session key. |
| `ORDER_SUBMITTED` | POST signed order to BE's `/predictionMarket/order/place`. BE forwards to Polymarket CLOB with HMAC creds. |
| `FILLED \| PARTIAL \| UNFILLED` | BE owns the polling. FE just calls `/predictionMarket/bet/:id/finalize`. |

**Why the BE wraps Polymarket calls instead of FE going direct:** the L2 HMAC creds are stored encrypted on the BE — we don't ship them to the client. FE provides the signed order (the secret-bearing piece is the EIP-712 signature only). BE attaches HMAC headers and forwards.

## 4. Resumability

On every mini-app open with a bet/setup deep link, FE first calls `GET /predictionMarket/state/:userId`. The response describes:

- Current `predictionMarketUserSetup.setupStep`
- Any in-flight bets (`status` not in terminal set)
- Any open positions awaiting close

FE picks up at the first incomplete state. The user sees the same progress UI and step events as if they hadn't closed the app. No duplicate bridges or orders — `clientOrderId` and BE state guard against re-submission.

If a deep link names a `betId` that's already terminal, FE shows a brief "this bet has finished" message and closes — the receipt card was already rendered to the chat by the BE.

## 5. Drift re-confirmation

Triggered when, at `ORDER_SIGNED` time, the live Polymarket top-of-book is more than `maxOrderDriftBps` (default 200 bps) away from `bet.refPriceBps`.

FE flow:

1. POST `/predictionMarket/bet/:id/drift-detected` with the live price.
2. BE re-renders a chat card: *"Price moved from $0.42 → $0.48 (+14.3%). Still place the bet?"* with `[Confirm new price] [Cancel]`.
3. Mini-app closes. User decides in chat.
4. On `Confirm new price` → BE writes new `refPriceBps` to bet row, deep-links back into mini-app to resume from `ORDER_SIGNED`.

This is the **only** moment the user sees an extra interaction. It's a chat confirm — not a wallet prompt — and it only fires when the price has materially moved.

## 6. Result-card variants (rendering)

BE emits `IntentResult` objects of these new card kinds. FE renders them using the existing result-card framework (`fe/privy-auth/src/components/ResultCard/`). New variants to register:

| Card kind | Source | Action buttons |
|---|---|---|
| `bet_placed` | post-fill receipt | `[View position]` (callback), `[Open in Polymarket]` (url) |
| `bet_failed` | terminal failure | `[Retry]` (callback), `[Cancel]` (callback) |
| `position_open` | active position view | `[Close]` (callback), `[Open in Polymarket]` (url) |
| `position_closed` | post-close receipt | `[Open in Polymarket]` (url) |
| `position_resolved` | settlement notification | `[Open in Polymarket]` (url) |

Each card needs a renderer component that consumes the BE-supplied fields (see BE doc §6 for the field list per card kind). No mini-app interactivity required for these cards beyond button taps that route through the existing callback handler.

## 7. Logging convention

Per CLAUDE.md, FE uses the custom logger with `log.level('message', metadataObj)` signature.

```ts
import { createLogger } from "../utils/logger";

const log = createLogger("placeBetHandler");

log.info('step', { step: 'started', requestId, betId, intentId });
log.info('step', { step: 'setup-required', requestId, setupStep });
log.info('step', { step: 'sca-deployed', requestId });
log.info('step', { step: 'gas-funded', requestId, txHash });
log.info('step', { step: 'approved', requestId, approvalCount: 3 });
log.info('step', { step: 'authed', requestId });
log.info('step', { step: 'bridging', requestId, bridgeIntentId });
log.info('step', { step: 'bridged', requestId, durationMs });
log.info('step', { step: 'sca-to-eoa', requestId, txHash });
log.info('step', { step: 'order-signed', requestId, clientOrderId });
log.info('step', { step: 'submitted', requestId, polymarketOrderId });
log.info('step', { step: 'filled', requestId, filledShares, durationMs });
log.warn('partial-fill', { requestId, betId, filledShares, requestedShares });
log.warn('drift-detected', { requestId, betId, refPriceBps, livePriceBps });

// Catch-block convention:
catch (err) {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  log.error('place-bet-failed', { requestId, betId, step, err: msg });
  log.debug('stack', { stack: err instanceof Error ? err.stack : undefined });
}
```

`closePositionHandler` mirrors the same step taxonomy with its own scope.

**Privacy (per CLAUDE.md):** never log session-key material, raw signatures, Polymarket creds, `privyToken`, `serializedBlob`, `initData`. Truncate any token reference: `token.slice(0,8)+'…'`.

**Toast policy:** `warn` and `error` auto-surface as Sonner toasts. Use `error` only for things the user should see (bet failed, drift too large, setup error). Use `warn` for recoverable degraded paths (partial fill, retry exhaustion). Use `info`/`debug` for step events that should not interrupt the user.

## 8. Position list view

New screen in the mini-app: **My Predictions**.

- Lists all `predictionMarketPositions` rows where `userId = current` and `status = 'open' | 'closing'`.
- Each row: market question (truncated), side, size, entry price, current price (live from BE), unrealized PnL.
- Tap row → opens position detail with `[Close]` button → triggers `ClosePositionHandler`.
- Pull-to-refresh re-fetches `/predictionMarket/positions/:userId`.
- Resolved positions appear in a separate "History" tab.

This screen is reachable from a profile entry point; it does NOT auto-open after a bet (the `bet_placed` chat card's `[View position]` button is the canonical entry from a bet flow, and that opens the detail directly).

## 9. Out of scope (FE side)

- In-app market browsing or detection — findings come exclusively from chat.
- In-app price charts.
- Order-book depth view.
- Custom limit-price input — v1 only supports ref-price + slippage.
- Multi-leg bet UI.

## 10. Sequencing

1. Reuse session-delegation onboarding for Polygon — verify by smoke-testing SCA deploy on Polygon before any Polymarket code lands.
2. Result-card variant renderers (independent of bet logic) — can ship behind a flag.
3. Setup state machine in `PlaceBetHandler` (steps 1–4 of §2 above).
4. Bet execution state machine (§3).
5. Resumability + drift re-confirm.
6. `ClosePositionHandler` + position list view.

## 11. Open items

1. Existing `ResultAction.kind` set — confirm `"callback"` and `"url"` cover all card actions; if a `"deeplink"` variant exists separately for opening the mini-app, audit consumers for default branches.
2. Verify session-delegation onboarding is multi-chain-clean (no Avalanche-specific assumptions in the SCA-deploy path) before extending to Polygon.
3. The Polymarket `clob-client` SDK can be vendored client-side for EIP-712 typed-data construction, OR we can hand-roll the typed-data structs. Decide based on bundle size impact.

---

**Status:** ready to implement once the BE-side state endpoints (`/predictionMarket/state`, `/predictionMarket/intent/:id`, `/predictionMarket/bet/:id/*`, `/predictionMarket/orderbook/:tokenId`, `/predictionMarket/order/place`, `/predictionMarket/order/sell`, `/predictionMarket/positions/:userId`) are spec'd. Sequencing in §10 starts with chain-onboarding verification, which is a prerequisite for everything else and unblocks the Relay extension on the BE side too.
