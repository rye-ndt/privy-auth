# Result Card Framework — FE (Mini-App) Plan

**Companion to:** `be/constructions/2026-05-04-result-card-framework.md`. Read that first — terminology (`IntentVerb`, `ResultStatus`, `ErrorCode`) and the BE-side error catalog are defined there. This plan covers the mini-app side: pre-execution confirm screens, post-execution result screens, and the error UX that today shows raw revert strings.

**Goal:** the user opens the mini-app, sees a single clean card per signing flow that explains what they're about to do (confirm) or what just happened (result), in plain English. No raw `to:`, no `value: 0x`, no calldata hex unless they tap "Show details".

**Benchmark (same as BE):** a teenager who's used crypto for one week understands every sentence on screen.

---

## 0. Locked assumptions (confirmed)

1. LLM interpretation: **OFF on FE.** All interpretation is BE-side; the BE injects already-formatted strings into the sign request. FE is a dumb-but-pretty renderer.
2. **No new confirmation step.** The mini-app's existing approve modal is the only confirmation, same as today. We are only upgrading what the modal *body* displays — replacing raw `to`/`value`/`calldata` with a clean human-readable preview. The user still taps "Approve" once, exactly like today.
3. English only.
4. The BE will start sending richer fields on `sign_calldata` artifacts (see §3) — FE must accept the new fields and gracefully fall back if absent (BE roll-out is staged).

---

## 1. Where today's pain lives

- `src/components/SigningRequestModal.tsx` — shows raw `to`, raw `value` (always labelled "AVAX" even on non-AVAX chains), raw calldata. Single-line `event.description` is the only human field, and it varies wildly per capability.
- `src/components/handlers/SignHandler.tsx` (446 lines) — error path uses `interpretSignError` (good!) but the resulting `friendly` string is shown in a generic red error box with no structure, no "what's next", no "try again" button per error code.
- `src/components/handlers/YieldDepositHandler.tsx` — same issues plus its own custom multi-step UI that diverges from `SignHandler`.
- `src/components/ActivityTab.tsx` and `src/components/activity/TransferRow.tsx` — already on the right track (single-card row, plain English action). Treat as the visual reference for the new ResultCard component.

---

## 2. Domain model

### 2.1 New file: `src/types/resultCard.types.ts`

Mirrors the BE shape exactly. Both sides serialize/deserialize via JSON; type drift between BE and FE is the #1 risk.

```ts
export type ResultStatus = 'success' | 'pending' | 'failed' | 'preview';
// `preview` is the in-modal pre-tx body. There is no separate "confirm" gate.

export type IntentVerb =
  | 'send' | 'swap'
  | 'yield_deposit' | 'yield_withdraw' | 'yield_rebalance'
  | 'stock_buy' | 'stock_close' | 'stock_set_exits'
  | 'buy_onramp'
  | 'history_query' | 'balance_query' | 'positions_query'
  | 'portfolio_summary' | 'loyalty_query';

export interface ResultField {
  label: string;
  value: string;
  emphasis?: 'primary' | 'normal' | 'muted';
}

export interface ResultAction {
  label: string;
  kind: 'command' | 'callback' | 'url';
  payload: string;
}

export interface IntentResult {
  status: ResultStatus;
  verb: IntentVerb;
  headline: string;
  fields: ResultField[];
  txHashes?: { hash: string; chainId: number }[];
  nextActions?: ResultAction[];
  details?: ResultField[];
  requestId?: string;
}
```

> Keep this file in lockstep with `be/src/use-cases/interface/input/resultCard.types.ts`. When the BE adds an `IntentVerb`, add it here in the same PR.

### 2.2 Extend `SignRequestEvent`

`src/components/SigningRequestModal.tsx` currently has:

```ts
export interface SignRequestEvent {
  type: 'sign_request';
  requestId: string;
  to: string; value: string; data: string;
  description: string; expiresAt: number; autoSign?: boolean;
}
```

Add an OPTIONAL `preview` field carrying the structured pre-tx summary:

```ts
preview?: {
  verb: IntentVerb;
  headline: string;
  fields: ResultField[];      // pre-formatted, no escaping needed
  details?: ResultField[];    // collapsed by default
};
```

When `preview` is present → render the new structured layout in the modal body. When absent → fall back to the current `description` / `to` / `value` / `data` view (legacy, until BE migration completes for that capability). Either way, the modal's Approve / Reject footer is unchanged — there is still exactly one tap to approve.

The BE attaches `preview` to the `sign_calldata` artifact (BE plan §6); the field travels through `SigningRequestRecord` and is returned by `GET /request/:id`, which `SignHandler` already polls.

---

## 3. Components

### 3.1 New: `src/components/result/ResultCard.tsx`

Single source of truth for both confirm and post-success/failed screens. Pure function of `IntentResult`. No state.

Visual grammar (locked, must match the BE Telegram receipt grammar so users see "the same card" across surfaces):

```
┌────────────────────────────────────────────┐
│  [emoji]  HEADLINE (bold, two lines max)   │
│                                            │
│  Field label 1     Field value 1           │
│  Field label 2     Field value 2           │
│  Field label 3     Field value 3 (muted)   │
│                                            │
│  [▾ Show details]   ← collapsed by default │
│  ─────────────────────────────────────     │
│  (when expanded:)                          │
│  Detail label      Detail value            │
│  Tx hash           0xabcd…1234 (explorer↗) │
│                                            │
│  ┌─────────┐  ┌─────────┐                  │
│  │ Action1 │  │ Action2 │  ← nextActions   │
│  └─────────┘  └─────────┘                  │
└────────────────────────────────────────────┘
```

- Status emoji map: `success → ✅`, `pending → ⏳ (animated)`, `failed → ⚠️`. For `preview`, render NO emoji — the surrounding modal already says "Transaction request from bot" with its own icon; a second status emoji would be visual noise. Headline alone carries the message.
- "Show details" is a `<details>`/summary or a controlled `useState` toggle styled as a chevron row.
- Tx hash truncation: `truncateHash` helper (use existing `truncateHex` from `SigningRequestModal.tsx` — extract and share).
- Explorer link uses existing `buildExplorerUrl(chainId, txHash)` from `utils/chainConfig.ts`.
- Action button styles:
  - `kind: 'callback'`: solid button. On click, posts via `postResponse({ type: 'callback', data: payload })` (existing helper) and closes the WebApp via `Telegram.WebApp.close()`.
  - `kind: 'command'`: outline button. On click, post `{ type: 'send_text', text: payload }` then close.
  - `kind: 'url'`: link-style button. Opens via `Telegram.WebApp.openLink(payload)`.

Layout reuses the same dark `#16162a` panel, `border-white/10`, `rounded-2xl` styling already used in `SigningRequestModal` and `ActivityTab` — visual consistency across surfaces.

### 3.2 Migrate `SigningRequestModal.tsx`

Two render paths:

```tsx
{event.preview ? (
  <ResultCard result={{ status: 'preview', verb: event.preview.verb, headline: event.preview.headline, fields: event.preview.fields, details: event.preview.details }} />
) : (
  // existing legacy "To / Value / Calldata" block
)}
```

The Approve / Reject footer remains owned by `SigningRequestModal` and is the **only** confirmation step in the entire flow. `ResultCard` renders body + (optional) details only — never any action buttons in `preview` mode. `nextActions` is ignored when `status === 'preview'`.

The error rendering inside `SigningRequestModal` (line 57: `setError(err.message)`) becomes a `ResultCard` with `status: 'failed'`. Build it from `interpretSignError(err)`:

```ts
const interpreted = interpretSignError(err);
setErrorCard({
  status: 'failed',
  verb: event.preview?.verb ?? 'send', // best-effort
  headline: interpreted.friendly,
  fields: [],
  nextActions: nextActionForCode(interpreted.code, event),
  requestId: event.requestId,
});
```

`nextActionForCode` (new helper, `src/utils/recoveryActions.ts`) maps `SignErrorCode → ResultAction[]`:

```
insufficient_token_balance, insufficient_gas → [{label:'Top up', kind:'command', payload:'/buy'}]
swap_amount_too_small → [{label:'Try a larger amount', kind:'callback', payload:'retry:swap'}]
session_key_invalid → [{label:'Re-link', kind:'callback', payload:'auth:relink'}]
user_rejected → []  (no recovery)
... (etc, full table mirrors BE catalog where overlap exists)
```

This is the FE counterpart to the BE error catalog — they don't share data, but they share spirit. Document the mapping in `status.md` so divergence is visible.

### 3.3 New: `src/components/result/ResultCardScreen.tsx`

Full-screen variant for handlers that don't use a modal (e.g. post-success after `Telegram.WebApp.close()` is delayed). Wraps `ResultCard` in a `FullScreen` layout with a single "Done" CTA. Used by `YieldDepositHandler` after a multi-step deposit completes (today shows ad-hoc copy).

### 3.4 Update `SignHandler.tsx`

Replace the inline error JSX (around line 169 / 217 — both `interpretSignError` call sites) with `<ResultCard result={errorCardFromInterpreted(interpreted, event)} />` rendered in the same modal slot. Same in `YieldDepositHandler.tsx`.

---

## 4. Files to create

```
fe/privy-auth/src/types/resultCard.types.ts
fe/privy-auth/src/components/result/ResultCard.tsx
fe/privy-auth/src/components/result/ResultCardScreen.tsx
fe/privy-auth/src/components/result/ResultField.tsx              (atom — label/value row)
fe/privy-auth/src/components/result/ResultActions.tsx            (atom — button row)
fe/privy-auth/src/components/result/StatusEmoji.tsx              (atom — emoji + a11y label)
fe/privy-auth/src/utils/recoveryActions.ts                       (SignErrorCode → ResultAction[])
fe/privy-auth/src/utils/truncateHash.ts                          (extract from SigningRequestModal)
fe/privy-auth/tests/ResultCard.test.tsx                          (snapshots × 12)
```

## 5. Files to modify

```
fe/privy-auth/src/components/SigningRequestModal.tsx       (use ResultCard for body + error path)
fe/privy-auth/src/components/handlers/SignHandler.tsx      (error path → ResultCard)
fe/privy-auth/src/components/handlers/YieldDepositHandler.tsx (error path + completion screen → ResultCard / ResultCardScreen)
fe/privy-auth/src/components/handlers/ApproveHandler.tsx   (confirm card if BE attaches one)
fe/privy-auth/src/components/handlers/OnrampHandler.tsx    (post-onramp success screen → ResultCard)
```

## 6. Implementation order

Phases align 1:1 with the BE plan so each side can ship incrementally without breaking the other.

**FP1 — Foundations (no UX change, additive only):**
- Create types + atoms + ResultCard + ResultCardScreen.
- Add snapshot tests for `success | failed | preview` × 4 representative verbs.
- `recoveryActions.ts` with the full SignErrorCode → action map.
- Extract `truncateHash`.

**FP2 — Preview path migration:**
- `SigningRequestModal` reads `preview` if present, renders via `ResultCard{status:'preview'}`. Falls back to legacy `to`/`value`/`calldata` view otherwise. Ship before BE starts sending `preview` — backward-compatible.

**FP3 — Error path migration:**
- `SignHandler` and `YieldDepositHandler` error blocks → `ResultCard{status:'failed'}` with recovery action buttons.

**FP4 — Post-success screens:**
- `YieldDepositHandler` completion → `ResultCardScreen`.
- `OnrampHandler` post-success → `ResultCardScreen`.
- `ApproveHandler` post-success → `ResultCardScreen` (today closes silently).

**FP5 — Cleanup:**
- Delete the legacy `to / value / calldata` rows from `SigningRequestModal` once BE rollout reaches 100%. Until then, keep as fallback.
- Move `formatValue` (line 14) into a shared `utils/format.ts` so the same chain-aware formatter is available app-wide. Today it always labels `value` as "AVAX" — fix to read chain native symbol via `chainConfig`.

---

## 7. Logging (per project convention — message first, then metadata)

New scope: `resultCard`.

```ts
const log = createLogger('resultCard');

log.info('rendered', { verb, status, requestId });
log.debug('details-toggled', { open, verb });
log.warn('action-failed', { kind, payload, requestId, err: msg });
```

- Action button clicks log at `debug` (`button-tapped`, `{ kind, payload, requestId }`).
- `recoveryActions.ts`: when an error code maps to no recovery, log `debug` once per `requestId` (not warn — "no recovery" is a valid state).
- Existing `interpretSignError` → `log.error` calls in handlers stay; the new `ResultCard{status:'failed'}` is purely visual, no extra error log.

---

## 8. A11y / mobile niceties (non-negotiable for SEA Telegram audience)

- Tap targets ≥ 44×44px for action buttons (Telegram WebView on Android has unforgiving tap zones).
- `aria-live="polite"` on the headline so screen readers announce the success/failure.
- "Show details" toggle is keyboard-accessible (`<button>` + `aria-expanded`).
- Status emoji has hidden `<span className="sr-only">Success</span>` so it's not just decoration.
- Card height capped with `max-h-[80vh]` + internal scroll — long detail lists must not push the action buttons off-screen.

---

## 9. status.md updates

After each FP phase, append to `fe/privy-auth/status.md`:
- What changed (concise).
- Why (the BE-FE serialisation contract for `preview`; the SignErrorCode → recovery action mapping).
- Conventions added: e.g. "All new signing flows MUST attach a `preview` on the BE side; FE legacy view is fallback only and will be removed in FP5."

---

## 10. Out-of-scope (intentional, follow-up)

- Animation between confirm → pending → success states (the modal teleports today; smooth transitions are a polish pass).
- Internationalisation. Prepare strings via a single `strings.ts` module so a future i18n swap is one file.
- Dark/light theme — Telegram Mini Apps inherit theme from the host; keep current dark palette and trust the inheritance.
- Voice / haptics on success (Telegram WebApp `HapticFeedback.notificationOccurred('success')` would be a +1 day add — leave as a tracked enhancement).

---

## 11. Cross-plan contracts (must match BE, do not drift)

| Item | Source of truth |
|---|---|
| `IntentVerb` union | BE `resultCard.types.ts` — FE mirrors verbatim |
| `ResultStatus` union | BE — FE mirrors verbatim |
| Status emoji map | BE renderer — FE matches |
| Error code names | BE `errorCatalog.ts` for server errors; FE `interpretSignError.ts` for client errors. Where the same situation can arise on both sides (e.g. `swap_amount_too_small`), names MUST agree |
| `ResultField` shape | Identical |
| Tx hash truncation format | `0xabcd…1234` (6 + 4 post-`0x`) — both sides use the same helper signature |

If either side adds a verb / status / code, both PRs must land together.

---

## 12. Open questions to flag during implementation

- Telegram WebApp's `openLink` opens in an external browser by default. Explorer links should open inline if possible — check if `Telegram.WebApp.openLink(url, { try_instant_view: true })` keeps users in-app on iOS/Android (different behaviors).
- The `preview` payload travels through the existing `sign_calldata` artifact serialisation. If size becomes an issue (Telegram bot API limits artifact JSON to ~4KB practically), trim `details[]` first and let users tap a "more details" button that fetches via a separate endpoint.
- Action button `kind: 'command'` posts text and closes the WebApp. Confirm with QA that the resulting `/swap` re-render in Telegram lands cleanly without a race condition against the `Telegram.WebApp.close()` animation. If race observed, add a 250ms delay before close.
