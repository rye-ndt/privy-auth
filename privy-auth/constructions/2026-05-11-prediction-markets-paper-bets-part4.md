# Prediction Markets — Paper Bets — Part 4 (Frontend + Status Docs)

Date: 2026-05-11
Status: plan
Index: `be/constructions/2026-05-11-prediction-markets-paper-bets.md` (Parts 1–3 live in `be/constructions/`; this FE part lives here in `fe/privy-auth/constructions/`).
Prerequisite: Part 2 (HTTP routes exist).
Unblocks: nothing — this is the last part.

## Goal

Reroute the broadcast deep-link to a new minimal `PaperBetHandler` page that does: fetch request → fetch live top-of-book preview → prompt amount → confirm → POST `/predictionMarket/paperBet` → receipt → close mini-app. Plus document the new path in both `status.md` files.

## Files added

- `fe/privy-auth/src/components/handlers/PaperBetHandler.tsx`

## Files changed

- `fe/privy-auth/src/utils/predictionMarketApi.ts` — add `placePaperBet`, `getPaperBets`, `getPaperPerformance`. Match the existing fetch-helper style (Privy bearer, typed errors).
- `fe/privy-auth/src/types/predictionMarket.types.ts` — add `PaperBet`, `PaperBetSide`, `PaperBetStatus`, `PerformanceBucket` types (mirror of `PaperBetTypes.ts` from Part 1).
- Whichever file currently routes `place_bet` deep-links to `PlaceBetHandler.tsx` (likely the mini-app router or `App.tsx`) — swap the mount to `PaperBetHandler`. Leave `PlaceBetHandler.tsx` on disk; just don't route to it.
- `fe/privy-auth/status.md` — append a "Prediction markets — paper-bet mode" section.
- `be/STATUS.md` — append a "Paper bets (evaluation mode)" section under the prediction-markets block.

## `PaperBetHandler.tsx` — flow

Single component, no setup state machine. State:

```ts
type Phase = 'loading' | 'amount' | 'confirming' | 'submitting' | 'done' | 'error';
```

Step-by-step:

1. **Mount** — `Phase='loading'`. Parse `findingId` and `side` (`'A'|'B'`) from the deep-link query. Call `getRequest(requestId)` to load the finding context (headline, role explanation, market names). Also call `getOrderbookTop(marketId, side)` for the preview price. (Backend resolves which market `'A'/'B'` maps to — but we want to **show** the price before the user commits, so we either: (a) duplicate `pickMarketForSide` on the FE, or (b) add a tiny `GET /predictionMarket/paperBetPreview?findingId=&side=` route that returns the resolved `marketId` and live price. **Option (b)** is cleaner — no duplication, server stays the source of truth. Add this route to the Part 2 HTTP list when implementing.)
2. **Amount** — `Phase='amount'`. Numeric input (USDC, integer cents under the hood), min/max from the preview response. Show: live price, implied shares, max payoff (`shares × $1`), max loss (`= stake`). Continue button → `'confirming'`.
3. **Confirming** — `Phase='confirming'`. Show a recap card with all the numbers. Tapping confirm POSTs `/predictionMarket/paperBet` with `{ findingId, side, stakeUsdcCents }`. Set `'submitting'`.
4. **Submitting** — spinner. Disable cancel. Most calls resolve in <1 s.
5. **Done** — show receipt (`paperBetId`, entry price, shares, stake, "we'll settle this when the market resolves"). Auto-close mini-app after 3 s via `WebApp.close()`, with manual button as fallback. **No `WebApp.close()` retry loop** — single call.
6. **Error** — show error message, log via `log.error('paper-bet failed', { requestId, err: msg })` (the logger surfaces `error` as a Sonner toast per CLAUDE.md FE rules). Offer retry.

### Logging — per CLAUDE.md FE rules

```ts
const log = createLogger('PaperBetHandler');

log.info('step', { step: 'started', requestId });
log.debug('preview', { findingId, side, priceBps });
log.info('step', { step: 'submitted', requestId, paperBetId });
log.info('step', { step: 'succeeded', requestId, paperBetId });
// in catch:
const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
log.error('paper-bet failed', { requestId, err: msg });
```

Choose `debug` for the preview-load chatter; `info` for state transitions; `error` only if the placement actually fails (it surfaces as a toast).

### What this handler does **not** do

- No SCA deploy, no Kernel call, no Privy session-key crypto, no `polygonEoaClient` import.
- No bridge — does not touch Relay, Avax, or USDC approvals.
- No CLOB signing — does not import `utils/polymarket.ts`'s `signOrder` / `buildUnsignedOrder`.
- No `polymarket.types` chain enum check.

The handler should be ~150 lines. If it grows past 250 the design has drifted.

## API additions — `predictionMarketApi.ts`

```ts
export async function placePaperBet(args: {
  findingId: string;
  side: 'A' | 'B';
  stakeUsdcCents: number;
}, opts: { token: string }): Promise<{ paperBet: PaperBet }> { /* ... */ }

export async function getPaperBets(opts: {
  token: string;
  status?: PaperBetStatus;
  limit?: number;
}): Promise<{ paperBets: PaperBet[] }> { /* ... */ }

export async function getPaperPerformance(opts: {
  token: string;
  groupBy?: 'overall' | 'subject' | 'clusterId' | 'detectorSource';
  since?: string;  // ISO date
}): Promise<{ buckets: PerformanceBucket[] }> { /* ... */ }

export async function getPaperBetPreview(args: {
  findingId: string;
  side: 'A' | 'B';
}, opts: { token: string }): Promise<{
  marketId: string;
  priceBps: number;
  depthShares: number;
  minStakeUsdcCents: number;
  maxStakeUsdcCents: number;
}> { /* ... */ }
```

Same error-class convention as the rest of the file (typed errors thrown on 4xx/5xx with parsed body).

## Route reroute

Find the place where `place_bet:findingId:A|B` deep-links currently mount `PlaceBetHandler`. Replace the component reference:

```diff
- import { PlaceBetHandler } from './components/handlers/PlaceBetHandler';
+ import { PaperBetHandler } from './components/handlers/PaperBetHandler';

- <Route path="/place-bet" element={<PlaceBetHandler />} />
+ <Route path="/place-bet" element={<PaperBetHandler />} />
```

(Pseudo-diff — actual file may differ.) Do not delete `PlaceBetHandler.tsx`; it stays as a reference / future re-enable path.

## Status doc updates

### `be/STATUS.md` — append under "Prediction markets":

```md
### Paper bets (evaluation mode) — 2026-05-11

- Goal: measure model profitability before any real money moves on-chain.
- Schema: `prediction_market_paper_bets` (see drizzle schema; indexed on userId+status, findingId, marketId+status, subject).
- Flow: broadcast button → mini-app `PaperBetHandler` → `POST /predictionMarket/paperBet` → DB row. No SCA, no bridge, no CLOB. Live CLOB top-of-book snapshotted at confirm time.
- Resolution: `predictionMarketPaperResolutionJob` ticks hourly, polls Polymarket Gamma `markets/{id}`, computes payout = `sharesE6 × $1` if outcome matches `side`, else 0. `realizedPnlUsdcCents = payout - stake`.
- Evaluation: `GET /admin/prediction-markets/paper-performance?groupBy=detectorSource` is the canonical "is the model profitable" query. Slicing also available by `subject` and `clusterId`.
- The on-chain bet pipeline (`PredictionMarketBetUseCase`, `PlaceBetCapability`, `ClosePositionCapability`) remains wired in DI but is **unreachable from the broadcast deep-link**. Re-enable by reverting the FE route mount.
- New env: `PREDICTION_MARKETS_PAPER_STAKE_MIN_USDC_CENTS`, `PREDICTION_MARKETS_PAPER_STAKE_MAX_USDC_CENTS`, `PREDICTION_MARKETS_PAPER_PRICE_TTL_MS`, `PREDICTION_MARKETS_PAPER_RESOLUTION_INTERVAL_MS`, `PREDICTION_MARKETS_PAPER_RESOLUTION_BATCH_SIZE`, `PREDICTION_MARKETS_PAPER_RESOLUTION_LOCK_TTL_MS`.
- New metadata fields used in logs: `paperBetId`, `detectorSource`, `groupBy`, `betCount`, `checked`, `resolved`.
- New convention introduced: when the broadcast contract (`place_bet:findingId:A|B`) is preserved, BE may swap the destination of the deep-link unilaterally — FE just remounts. This contract is the boundary; everything behind it is implementation-private.
```

### `fe/privy-auth/status.md` — append under "Prediction markets":

```md
### Paper bets (evaluation mode) — 2026-05-11

- `place_bet:findingId:A|B` deep-link now mounts `PaperBetHandler` instead of `PlaceBetHandler`. `PlaceBetHandler.tsx` is dormant — kept for reference and possible re-enable.
- `PaperBetHandler` is a pure HTTP flow: load preview, prompt amount, confirm, POST, receipt, close. No SCA, no bridge, no signing. ~150 LOC target.
- New API helpers in `utils/predictionMarketApi.ts`: `placePaperBet`, `getPaperBets`, `getPaperPerformance`, `getPaperBetPreview`.
- The preview call (`GET /predictionMarket/paperBetPreview`) is the source of truth for the live price and stake bounds — do not duplicate `pickMarketForSide` mapping on the FE.
- No changes to `polygonEoaClient`, `polymarket.ts`, or any chain-specific util — those remain available for the dormant on-chain path.
```

## Tests

- `PaperBetHandler.test.tsx` — render with a deep-link, mock API to return a preview, simulate amount entry + confirm, assert `placePaperBet` called with correct args.
- `predictionMarketApi.test.ts` — happy-path call to each new helper, plus 4xx/5xx error mapping.

## Acceptance

- Tapping "Place Bet" on a real broadcast finding card opens the mini-app on the new handler.
- Preview loads in <500 ms; price matches what `polymarketAdapter.getTopForSide` returns server-side at that instant.
- Submitting writes a row visible in `GET /predictionMarket/paperBets`.
- Mini-app closes within 3 s of confirm.
- Status docs reflect the new flow and the broadcast-contract decision.

## Follow-ups (not in this part)

- User-facing "my paper performance" page in the mini-app reading from `getPaperPerformance`.
- Push notification on resolution (`PushNotification` tool integration).
- Admin Slack/Telegram weekly digest summarizing `paper-performance?groupBy=detectorSource`.
- Cleanup PR deleting the dormant on-chain capability registrations once paper data conclusively shows the model is (or isn't) profitable.
