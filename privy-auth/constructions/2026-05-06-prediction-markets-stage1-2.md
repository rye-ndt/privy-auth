# Prediction Markets — Stages 1 & 2 (Frontend / Mini-App)

Date: 2026-05-06
Status: plan — **no FE changes required for stages 1–2**.

## Why this file exists

Stages 1–2 of the prediction-market feature (filter Polymarket universe + LLM clustering) are entirely backend work. The user-visible output is a **Telegram message** rendered via the existing result-card pipeline (`renderResultCard` → `bot.api.sendMessage`). The mini-app is not on the path.

This file documents the deferral so a future engineer doesn't waste a day looking for FE work that isn't there, and pins the contract the FE will consume when stages 3–5 land.

## What we are NOT doing now

- No new tab in `StatusView.tsx`. (The dock is already tight at 5 tabs after the Activity addition — see fe status log entry from 2026-05-04. Adding another tab now, before there is interactive content, is premature.)
- No new mini-app handler. Stages 1–2 produce informational pushes only — the user does not sign anything yet.
- No new fetch hook. There is no FE-readable endpoint for cluster data in scope. (The BE persists clusters in `prediction_market_clusters` for stage 3 to consume internally.)
- No Sonner toast / debug-log plumbing. Telegram is the only delivery surface.

## What we WILL need later (stages 3–5) — documented now so we plan around it

When the daily bet card ships:
- A new `PredictionMarketBetHandler.tsx` mini-app handler that consumes a `requestType: 'predictionMarketBet'` work item from `GET /request/:requestId`. Two-side bet button UX → calldata sign on Polymarket's CTF Exchange.
- A new `requestType` enum value mirrored in BE `signing-request` shape.
- USDC funding precheck (mirror the onramp handler's `useFundWallet` pattern from 2026-05-05). The brief calls for one-tap $5 — that means we need a default-amount fast path with fallback to onramp.
- Polymarket sits on **Polygon** (chain id 137). Aegis today is Avalanche-home + BSC for Aster. Cross-chain funding flow will reuse Relay (`relayCrossChainSwapPlanner`) from BE; FE just signs the bridge step the same way it signs Aster cross-chain steps. **Confirm chain id 137 lives in `utils/chainConfig.ts` before stage 5 work starts.** If not, that's a one-line addition then.
- Possibly a `MarketsTab` if the daily card grows into a daily list. Defer until there's evidence one card per day isn't enough.

## Conventions to remember when stages 3–5 land

(Pulled from existing `status.md` so future-me does not have to re-derive them.)

- New handlers go through `useFetch` for reads. Never poll free-tier-backed endpoints; if Polymarket pricing comes through a free upstream, the read must be user-initiated only (Activity tab pattern from 2026-05-03).
- Catch blocks: extract message via `instanceof Error`, then `log.error('action-failed', { requestId, err: msg })`. `warn`/`error` auto-toast via Sonner.
- Step events: `started`, `submitted`, `succeeded`, `failed` with `requestId`.
- Manual-sign userOps go through `createSudoClient`, never `useSmartWallets` (deleted 2026-05-03).
- LocalStorage cache keys carry an explicit version suffix (`aegis.<feature>.v<N>`).
- All AA stack constants come from `utils/aaConfig.ts` and must stay in lockstep with `be/src/helpers/aaConfig.ts`.

## Done definition for this plan

- [x] File written so the next engineer doesn't re-investigate.
- [ ] On stage-5 kickoff: re-read this file, confirm chain id 137 wiring, then create a fresh construction doc for the bet-card handler.
