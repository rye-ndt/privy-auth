# Prediction Markets — Stage 3 (Frontend / Mini-App)

Date: 2026-05-06
Status: plan — **no FE changes required for stage 3**.

## Why this file exists

Stage 3 (mispricing detection + verification + push) lives entirely in the backend. The user-visible surface is a Telegram message rendered via the existing result-card pipeline, with two **external-link** buttons pointing to Polymarket — not in-app handlers, not signing flows, no Polygon wiring.

This file documents the deferral and pins what FE will need when stage 5 ships in-app betting.

## What stage 3 ships, FE-side

Nothing direct. The only FE-adjacent change happens in the **shared result-card contract**:

- `ResultAction.kind` gains a `"url"` value. The BE renderer translates this to a Telegram inline-keyboard URL button. The FE consumes the same type union (used for mini-app result cards) — adding `"url"` is additive and non-breaking, but every place the FE matches on `kind:` must default-branch unknown values rather than throw.

Audit before merging the BE PR:

```
grep -rn 'kind: "command"\|kind: "callback"\|kind: "miniApp"\|action\.kind' fe/privy-auth/src
```

Every switch must have a default arm. If any match exhaustively switches without a default, add one returning `null` so the FE silently ignores `"url"` actions in mini-app contexts (URL actions are meaningless inside the mini-app — they only exist in the Telegram chat surface).

## What we will need at stage 5 (do not build yet)

When in-app betting lands, the BE will start emitting `nextActions[].kind: "miniApp"` instead of `"url"` for buttons that should route to a new bet handler. At that point:

- New `PredictionMarketBetHandler.tsx` consuming `requestType: 'predictionMarketBet'` from `GET /request/:requestId`.
- Add Polygon (chain id 137) to `utils/chainConfig.ts`.
- Reuse the cross-chain pattern from Aster: Relay-bridge home-chain USDC → Polygon USDC → CTF Exchange order. Same `executeSignSteps` flow, new step kinds.
- USDC funding precheck via `useFundWallet` (mirror onramp handler).

Stage 3 is intentionally URL-only so we ship value before that stack is built.

## Done definition

- [x] Deferral documented.
- [x] Pre-merge: confirmed (2026-05-07) — FE has zero `ResultAction` consumers, so adding `kind: "url"` is non-breaking with no FE switch changes required. See status.md entry "Prediction Markets stage 3 FE audit — 2026-05-07".
- [ ] On stage-5 kickoff: re-read this file + the stage 1-2 deferral, check Polygon wiring, then create a fresh construction doc for the bet handler.
