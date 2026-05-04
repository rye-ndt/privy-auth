# Implementation plan: Activity (transfer history) tab

**Status:** Planned
**Author / date:** 2026-05-03
**Scope:** Frontend only (`fe/privy-auth/`). BE plan lives at `be/constructions/2026-05-03-ankr-transfer-history.md` and exposes `GET /transfers`.

---

## 1. Goal

Render the user's full SCA transfer history (sends + receives, native + ERC-20) inside the mini app, reading the new `GET /transfers` BE endpoint. The agent surface (Telegram chat) is handled BE-side via the `get_transfer_history` tool — this plan is **only** the visual list.

**Non-goals**

- Computing balances over time. v1 is a flat reverse-chronological list.
- Streaming / push updates. Reload-on-focus and pull-to-refresh only.
- Decoding swap / yield internals into "labelled activity" — BE returns raw transfers; FE labels by direction + counterparty only.

---

## 2. UX

A new **Activity** tab in the mini app, peer to the existing Portfolio / Configs tabs.

- Reverse-chronological card list, infinite scroll via cursor.
- Each card: relative timestamp ("2h ago"), direction icon (↗ out / ↙ in / ↺ self), token symbol + amount, USD value if present, truncated counterparty address (`0x1234…abcd`), tx hash linking to the chain explorer.
- Filter chips at the top: **All / Sent / Received**. Maps to `direction` query param.
- Empty state: "No activity yet — your sends and receives will appear here."
- Loading: skeleton rows. Error: inline retry banner (matches `useLoyalty` error UX). Rate-limit (429): banner *"Too many requests — try again in a minute."*

---

## 3. Architectural placement

Mirrors the loyalty history pattern (`useLoyalty.ts` + `LoyaltyTab.tsx`) — that's the closest precedent for a paginated, server-driven list in this app.

```
src/hooks/useTransferHistory.ts        (NEW — fetch + pagination state)
src/types/transferHistory.types.ts     (NEW — TransferRecord type, mirrors BE)
src/components/tabs/ActivityTab.tsx    (NEW — list view)
src/components/activity/
  TransferRow.tsx                      (NEW — single card)
  DirectionFilter.tsx                  (NEW — chip group)
src/utils/logger.ts                    (existing — new scope 'useTransferHistory')
src/App.tsx                            (EDIT — register Activity tab)
```

No new env vars. No new dependencies — reuses `resilientFetch`, `chainConfig` (for explorer URL), existing logger.

---

## 4. Hook contract

`src/hooks/useTransferHistory.ts` mirrors `useLoyalty`'s `useLoyaltyHistory` shape:

```ts
export type Direction = 'in' | 'out' | 'self';

export type UseTransferHistoryArgs = {
  direction?: Direction;        // when set, refetches from page 0
  limit?: number;               // default 25
};

export type UseTransferHistoryReturn = {
  entries: TransferRecord[] | null;
  loading: boolean;
  error: string | null;
  rateLimited: boolean;         // surfaces 429 specifically (banner copy differs)
  unauthorized: boolean;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
};
```

Implementation notes:

- Cursor stored in a ref (same pattern as `useLoyalty`, line 162).
- Page 0 reset on `direction` change or explicit `refresh()`.
- Endpoint: `GET ${backendUrl}/transfers?limit=&direction=&cursor=` with `Authorization: Bearer ${privyToken}` from `useAppData`.
- Error mapping:
  - `r.status === 401` → `setUnauthorized(true)`, throw `'unauthorized'`.
  - `r.status === 429` → `setRateLimited(true)`, do **not** throw — return so the banner renders without spamming the logger as `error`. Log at `warn` level: `log.warn('rate-limited', { requestId })`.
  - other non-2xx → throw, set `error` to `"Couldn't load activity"`. Log `error`.
- Auto-reload **only** on `direction` change and explicit `refresh()`. Do **not** poll — the BE cache TTL is 60 s and free-tier quota is shared.
- `refresh()` clears the cursor and the in-memory `entries`, then refetches page 0.

---

## 5. Logging (per `CLAUDE.md` §logging-fe)

```ts
const log = createLogger('useTransferHistory');

log.debug(`→ GET /transfers`, { requestId, page, direction, cursor });
log.debug(`← GET /transfers`, { requestId, status, count });
log.warn('rate-limited', { requestId });
log.error('load-failed', { requestId, err: msg });
```

`warn` and `error` will surface as Sonner toasts per the project logger convention — that's intentional for `error`, but for `rate-limited` we *also* show an inline banner; the toast is fine in addition.

---

## 6. Component sketch

`ActivityTab.tsx`:

```tsx
const { entries, loading, error, rateLimited, hasMore, loadMore, refresh } =
  useTransferHistory({ direction });

return (
  <div>
    <DirectionFilter value={direction} onChange={setDirection} />
    {rateLimited && <Banner kind="warn">Too many requests — try again in a minute.</Banner>}
    {error && <Banner kind="error" onRetry={refresh}>{error}</Banner>}
    {entries?.length === 0 && !loading && <EmptyState />}
    {entries?.map((t) => <TransferRow key={`${t.txHash}-${t.logIndex ?? 'native'}`} t={t} />)}
    {loading && <SkeletonRows count={5} />}
    {hasMore && !loading && <button onClick={loadMore}>Load more</button>}
  </div>
);
```

`TransferRow.tsx` formats:

- Direction → icon + colour (in = green, out = red, self = neutral).
- Amount → `t.amountFormatted` (BE already toFixed-6'd); show USD when `t.usdValue != null`.
- Counterparty → the *opposite* of direction (`direction === 'in' ? from : to`), truncated.
- Tx link → `getExplorerTxUrl(chainId, txHash)` from `utils/chainConfig.ts` (extend if not already exported).
- Time → `formatRelative(timestampEpoch)` from `date-fns` if already a dep, otherwise a tiny local helper (no new dep).

---

## 7. App-level wiring

`App.tsx` — add `'activity'` to the tab union, register the route, place the tab between Portfolio and Configs. Match the existing tab-mount pattern. Persist last-active tab in the same place as today (Telegram CloudStorage if used; otherwise component state — match precedent).

No change to `useAppData` — the hook reads `backendUrl` and `privyToken` from there same as `useLoyalty`.

---

## 8. File-level checklist

| Action | Path |
|---|---|
| NEW | `fe/privy-auth/src/types/transferHistory.types.ts` |
| NEW | `fe/privy-auth/src/hooks/useTransferHistory.ts` |
| NEW | `fe/privy-auth/src/components/tabs/ActivityTab.tsx` |
| NEW | `fe/privy-auth/src/components/activity/TransferRow.tsx` |
| NEW | `fe/privy-auth/src/components/activity/DirectionFilter.tsx` |
| EDIT | `fe/privy-auth/src/App.tsx` — register Activity tab |
| EDIT | `fe/privy-auth/src/utils/chainConfig.ts` (or wherever explorer URLs live) — ensure `getExplorerTxUrl(chainId, hash)` exists; add if missing (chain-agnostic, never inline IDs) |
| EDIT | `fe/privy-auth/status.md` — record the new tab + the convention that **never poll free-tier endpoints** (rely on BE cache TTL + manual refresh) |

No new env vars. No new dependencies.

---

## 9. Test plan

- Manual: open Activity tab on a known wallet, verify list renders with both inbound and outbound transfers.
- Filter chips: switching to *Sent* / *Received* refetches page 0; cursor is reset.
- Pagination: scroll / Load-more chains pages; cursor advances; final page hides the button.
- Refresh: pull-to-refresh (or button) clears state and fetches page 0.
- 401 path: simulate expired Privy token → `unauthorized` state, redirect to auth (match `useLoyalty`'s handling).
- 429 path: hammer the BE in dev (lower `TRANSFER_HISTORY_RPM` to 2) → banner appears, no toast spam, recovery on next minute.
- Empty path: brand-new SCA → empty state visible.
- Logger / DebugTab: verify `→`/`←` debug entries and that `error` surfaces a toast.

---

## 10. Open questions

1. **Tab placement.** Activity between Portfolio and Configs? Or somewhere else in the existing tab order? Defer to whoever owns IA.
2. **Time-window picker.** v1 has only direction filter. A "Last 7 days / 30 days / All" segmented control maps cleanly to `fromEpoch` and is cheap to add — worth shipping in v1?
3. **Counterparty display.** v1 shows truncated address. If counterparty is an Aegis user (BE could resolve via `userProfileDB.findByEoaAddress` + a sibling endpoint), showing their handle would be much friendlier. Out of scope here; flag for follow-up.
4. **Rate-limit UX.** Banner only, or also disable filter chips while limited? v1 keeps chips enabled (so the cached page for another direction can still serve from the BE cache); confirm.
5. **Refresh control.** Pull-to-refresh, an icon button, or both? Match whatever pattern the Portfolio tab uses.
