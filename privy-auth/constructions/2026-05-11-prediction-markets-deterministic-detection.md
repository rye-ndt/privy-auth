# Prediction Markets — Deterministic Detection (Frontend / Mini-App)

Date: 2026-05-11
Status: plan — **no FE code changes required**.
Builds on: `2026-05-06-prediction-markets-stage1-2.md`, `2026-05-06-prediction-markets-stage3.md`, `2026-05-07-prediction-markets-stage4.md`
Backend counterpart: `be/constructions/2026-05-11-prediction-markets-deterministic-detection.md`

## Foundational principle

**Markets are data, not language. The LLM's only job is to turn each market into a structured record once. Everything after that is code.**

The 7-phase deterministic-detection refactor lives entirely in the backend. Per-market extraction, clustering, mispricing detection, verification, and LP-based sizing all happen server-side. The user-visible surface — the broadcast finding card and the bet flow — is unchanged.

This file documents the deferral, pins what FE will need at each phase, and locks down the audits required to merge the BE changes safely.

## Why no FE changes

The refactor preserves every public contract the FE depends on:

- **`IntentResult` schema** — no new `verb` values, no new `ResultAction.kind`. The finding card produced by `PredictionMarketFindingBroadcaster` keeps the same structure (`headline`, `fields`, `details`, `nextActions`).
- **`ResultAction` payloads** — `place_bet:<findingId>:<A|B>` callback format is unchanged. `findingId` continues to be the primary key the FE bet handler dereferences.
- **`requestType: 'predictionMarketBet'`** — the bet handler in the mini-app reads `findingId`, `marketId`, `outcomeTokenId`, `side`, `refPriceBps` from `GET /request/:requestId`. None of those fields change.
- **Mini-app review queue** — explicitly out of scope. The new `prediction_market_extraction_reviews` table is staffed by an admin Telegram chat (approve/reject buttons handled by the BE), not by a mini-app screen.

## Per-phase FE impact

| BE Phase | FE impact | Action |
|---|---|---|
| 0 (role tagging) | None — verifier change is internal. | None. |
| 1 (schema + primitives) | None — definitions only. | None. |
| 2 (extraction + review queue) | None — admin chat is BE-only. | None. |
| 3 (deterministic clustering) | None — same `IntentResult`. | None. |
| 4 (deterministic detection) | None — same `IntentResult`. | None. |
| 5 (LP sizing) | The finding card gains a "Profit estimate" field and a "Trades" detail block when `expectedProfitUsdc` is populated. **This is rendered on the BE** (Telegram `sendMessage` text). The mini-app bet handler does not surface profit estimates today and does not need to in this phase. | None. Verify after Phase 5 ships that the place-bet flow still routes from the new card text correctly. |
| 6 (cutover) | None. | None. |
| 7 (hygiene) | None. | None. |

## Pre-merge audits the FE must run

When the BE PRs land, run these before approval. They are mechanical and take minutes.

### Phase 0 — role tag fields

The BE adds optional `widerMarketId / narrowerMarketId / earlierMarketId / laterMarketId` to `DraftFinding`. The FE only consumes a `VerifiedFinding` indirectly through `findingId` lookup, but if any FE code reads finding objects from a BE response, confirm tolerance for unknown fields:

```
grep -rn 'sideA\|sideB\|widerMarketId\|narrowerMarketId\|patternType' fe/privy-auth/src
```

Expected: no matches. If something matches, audit that the deserializer ignores unknown fields (it does — we use plain `await res.json()` everywhere).

### Phase 5 — VerifiedFinding fields

The BE adds optional `sizedTrades / expectedProfitUsdc / minPayoffUsdc` to `VerifiedFinding` and the `prediction_market_findings` table. The FE bet handler currently reads:

```
grep -rn 'GET /request' fe/privy-auth/src/handlers/PredictionMarketBetHandler
```

Confirm the handler does **not** depend on the absence of these fields. The contract is purely additive.

### Always — `kind: "callback"` payload format

The BE keeps the `place_bet:<findingId>:<A|B>` payload shape from stage 4. Confirm the FE callback parser still accepts this shape verbatim:

```
grep -rn 'place_bet' fe/privy-auth/src
```

Expected: one match in the bet handler with a regex like `/^place_bet:([^:]+):(A|B)$/`. The `findingId` UUID format is unchanged regardless of which pipeline (LLM or deterministic) produced the finding.

## What FE will need at later, unrelated stages (not part of this work)

These are flagged here so future construction docs do not accidentally trample them:

- **Per-position close UI** already exists (stage 4). Sizing improvements in Phase 5 may eventually feed a "what would I net if I close at this depth?" preview, but that is a separate stage and a separate doc.
- **Review-queue admin surface** is intentionally Telegram-only for now. If review volume grows past what an admin chat can handle (Phase 7 monitoring), a mini-app admin page becomes worth designing — but that is its own construction doc, not part of this refactor.
- **Profit-estimate display in the bet handler** could mirror the broadcast card's "Expected profit $X.XX" line. Worth considering when Phase 5 ships and we observe whether users want to see the math before confirming a bet. Out of scope here.

## Done definition

- [x] Deferral documented.
- [ ] Pre-merge: BE Phase 0 PR audit (one `grep`, one paragraph in the PR description confirming no FE consumers).
- [ ] Pre-merge: BE Phase 5 PR audit (`VerifiedFinding` field tolerance, callback shape unchanged).
- [ ] If a future construction doc proposes a mini-app review-queue page, re-read this file's "Why no FE changes" section before designing it — the BE is built around the assumption that review is admin-Telegram-only.
