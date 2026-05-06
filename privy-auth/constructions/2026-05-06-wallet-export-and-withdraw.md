---
title: Config tab — Export EOA key + Withdraw SCA USDC to EOA
date: 2026-05-06
scope: frontend (privy-auth Mini App)
status: planned
---

# Frontend plan — Config tab self-service (export key + USDC withdraw)

## 1. Goal

Two new sections in `ConfigsTab.tsx`, each independently shippable:

1. **Export Private Key** — opens Privy's hosted export iframe to reveal the embedded EOA private key. Two-step gate (warning modal → Privy iframe).
2. **Withdraw to my Wallet** — per-chain "Withdraw all USDC on Avax" / "Withdraw all USDC on BSC" buttons. Sweeps the SCA's USDC balance to the controlling EOA via the **sudo validator** (Privy popup). Pimlico paymaster sponsors gas — user does not need to fund the EOA.

Pairs with `be/constructions/2026-05-06-wallet-export-and-withdraw.md` (single read-only endpoint `GET /wallet/withdraw/preview?chainId=X`).

## 2. Why this design (and what we rejected)

### Chosen — sudo client, per-chain explicit buttons, BE-driven preview

- **Sudo path, not session-key path.** Sweep amounts will routinely exceed any `valueLimit` granted under `Erc20SpendMessage`. Auto-sign would 400 from the BE off-chain check. Going through `createSudoClient(provider, signerAddress, chainId).sendTransaction(...)` (already proven in `SignHandler.tsx:451-466`) requires no BE involvement and works regardless of session-key state. This is the rescue path; it must not depend on the agent infrastructure being healthy.
- **Per-chain explicit buttons.** Each chain is a separate UserOp on a separate SCA — bundling them into one UI primitive would hide that and complicate error states (one chain succeeds, the other fails). Two buttons stacked is honest.
- **BE preview endpoint** instead of FE-side balance read. FE has no USDC addresses (per CLAUDE.md and the existing `chainConfig.ts` shape). One `GET /wallet/withdraw/preview?chainId=X` call returns `{ scaAddress, eoaAddress, usdc: { address, decimals, symbol, balanceRaw } }` — everything needed to build calldata locally.

### Rejected — auto-sign via session key

Forces sweep amount under granted USDC limit, defeats rescue purpose, requires BE config changes to even attempt.

### Rejected — single "Withdraw" button with chain dropdown

Adds hidden state. With two SCAs to drain, users want to see both balances at once and act on each independently.

### Rejected — sweep native AVAX/BNB in v1

Out of scope. ERC-20 transfer calldata only. Native dust stays in the SCA. Documented in BE plan §8.

### Rejected — show export key without confirmation gate

Blast radius of the EOA key is total (controls SCAs on every supported chain, current and future). A single tap to reveal it is a footgun. Two-step gate (warning + checkbox → Privy iframe) is mandatory.

## 3. UI placement

Inside `ConfigsTab.tsx`, two new sections inserted **after** "Your Wallet" and **before** "AI Agent". Reuse the existing `<SectionLabel>` and card styling.

```
┌─ Your Wallet ────────────────┐  (existing)
├─ Withdraw to my Wallet ─────┤  ← NEW
│   • Avax: balance + button  │
│   • BSC:  balance + button  │
├─ Export Private Key ────────┤  ← NEW
│   • Warning + button        │
├─ AI Agent ──────────────────┤  (existing)
├─ What the agent can do ─────┤  (existing)
```

Rationale for ordering: "Withdraw" and "Export" are **rescue primitives** — surfacing them above "AI Agent" / "Permissions" helps a panicked user find them fast. Configs that are routinely-used (agent disconnect, permissions list) sit below.

## 4. New component: `WithdrawUsdcSection`

**File:** `fe/privy-auth/src/components/configs/WithdrawUsdcSection.tsx` (new directory `configs/` to keep `ConfigsTab.tsx` itself thin).

### Responsibilities

- For each supported chain (`43114`, `56`): fetch `/wallet/withdraw/preview?chainId=X` once on mount + a manual refresh button.
- Render a `WithdrawChainRow` per chain showing: chain name, USDC balance (formatted), "Withdraw to wallet" button.
- On click → confirmation modal → on confirm → call `executeSweep(chainId)` (see §5).
- Per-row state machine: `idle | loading-preview | preview-error | confirming | submitting | success | error`.

### Props

```tsx
type Props = {
  privyToken: string;
  backendUrl: string;
  eoaAddress: `0x${string}`;
};
```

### Hooks/utilities used

- `useFetch` (existing pattern from `useAppData.tsx`) for the preview call. **Do not** use `refetchOnVisible` — preview hits BE→RPC, treat like the Activity-tab convention (status.md §1).
- `usePrivy()` from `@privy-io/react-auth` to get the embedded wallet provider.
- `createSudoClient` from `src/utils/createSudoClient.ts`.
- `createLogger` from `src/utils/logger.ts` with scope `withdrawUsdc`.

### Refresh / re-read race

The preview's `balanceRaw` can drift between fetch time and sign time (the agent might spend USDC concurrently). Mitigation: at click-time, immediately re-call `GET /wallet/withdraw/preview?chainId=X` once and use **that** balance for the calldata. Show the modal with the freshly-read balance, not the cached one. Race window collapses to "modal open → user confirms" — if they sit on it, they may get a revert on submit; we surface the error and let them retry.

## 5. Sweep execution — `executeSweep(chainId)`

In `WithdrawUsdcSection.tsx` or a colocated `executeSweep.ts`. Pure function, no React state.

```ts
async function executeSweep(args: {
  chainId: number;
  scaAddress: `0x${string}`;
  eoaAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  balanceRaw: bigint;
  provider: EIP1193Provider;
  signerAddress: `0x${string}`;
}): Promise<{ hash: `0x${string}` }> {
  const requestId = crypto.randomUUID();
  log.info("step", { step: "started", requestId, action: "sweep-usdc", chainId: args.chainId });

  const sudoClient = await createSudoClient(args.provider, args.signerAddress, args.chainId);

  // ERC-20 transfer(eoa, balance) calldata
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [args.eoaAddress, args.balanceRaw],
  });

  log.debug("submitting sudo userOp", { requestId, to: args.usdcAddress });

  try {
    const hash = await sudoClient.sendTransaction({
      to: args.usdcAddress,
      value: 0n,
      data,
      account: sudoClient.account!,
      chain: null,
    });
    log.info("step", { step: "succeeded", requestId, hash });
    return { hash };
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    log.error("sweep-usdc-failed", { requestId, chainId: args.chainId, err: msg });
    throw err;
  }
}
```

Notes:

- `value: 0n` — never send native with the transfer; this is ERC-20 only.
- `chain: null` — matches the pattern in `SignHandler.tsx:451-466` and `createSudoClient.ts` (Privy embedded wallet personal_signs userOp hashes chain-agnostically).
- `balanceRaw` parsed with `BigInt(string)` — preview returns it as decimal string.
- No retry loop. If the tx reverts (race against agent), surface the error and let the user click again — re-fetches preview.

## 6. Confirmation modal

`WithdrawConfirmModal` — reuse the visual language of `RemoveAgentModal` in `ConfigsTab.tsx:286-357` but with neutral (not destructive) red — **violet/info palette**, since this is the user's own money going to their own wallet, not a destructive action.

Body must clearly state:

- **Amount**: `<balance> USDC`
- **From**: `<scaAddress>` (truncated)
- **To**: `<eoaAddress>` (truncated, with "this is the address you can import into MetaMask" tooltip)
- **Chain**: `Avalanche` | `BNB Chain`
- **Gas**: "Sponsored by Aegis" (since paymaster covers it)

Two actions: "Cancel" / "Withdraw all USDC".

## 7. Export Key section

**File:** `fe/privy-auth/src/components/configs/ExportKeySection.tsx`.

### Flow

1. Section card with title "Export Private Key", short description, and a single button "Reveal private key".
2. Button → `ExportKeyWarningModal`:
   - Headline: "This key controls all your funds."
   - Bullet list:
     - Anyone with this key can move USDC, AVAX, BNB, and any other tokens out of your accounts on **every chain**, present and future.
     - Aegis cannot recover stolen funds.
     - Save the key somewhere offline — never paste it into a website you don't fully trust.
   - Required: `<input type=checkbox>` "I understand the risks" — submit button disabled until checked.
   - Buttons: "Cancel" / "Continue".
3. On Continue → call `exportWallet({ address: eoaAddress })` from `usePrivy()` (Privy v3.21 supports this directly; no extra dep). Privy renders its own iframe. Close the warning modal as soon as the iframe opens.

### Logging

```ts
log.info("step", { step: "started", action: "export-key" });
log.info("step", { step: "submitted", action: "export-key" }); // user clicked Continue
log.info("step", { step: "closed", action: "export-key" });    // iframe closed
log.error("export-key-failed", { err: msg }); // exportWallet rejected
```

**Never** log the address payload returned by Privy (it's just the EOA address — already public, but no need). **Never** log anything resembling the key itself; Privy's iframe doesn't return it to JS, but defense in depth.

### Tooltip for clarity

Below the section title, a small note: "This is your Privy embedded-wallet key. Importing it into a wallet like MetaMask shows your EOA — to access the smart account balance, use the Withdraw button above or visit the ZeroDev dashboard with this key."

## 8. Wiring into `ConfigsTab.tsx`

`ConfigsTab` already takes `eoaAddress`, `smartAddress`, `delegatedAddress`, `removeKey`. Add one prop:

```ts
backendUrl: string;
privyToken: string;
```

Pass them through from wherever `<ConfigsTab>` is mounted (likely `App.tsx` → `StatusView.tsx`). Pull from the same source as the rest of the auth state (`useAppData` / `usePrivy`).

Insert sections:

```tsx
<WithdrawUsdcSection
  privyToken={privyToken}
  backendUrl={backendUrl}
  eoaAddress={eoaAddress as `0x${string}`}
/>

<ExportKeySection eoaAddress={eoaAddress as `0x${string}`} />
```

## 9. Testing

- **Manual on Fuji** (43113) if BE endpoint accepts it; otherwise lowest-cost mainnet check.
- **Force the race**: open Withdraw modal, send USDC out via the bot in another window, confirm sweep — expect a clear error toast, not a silent failure.
- **Export key on iOS Telegram + Android Telegram** — Privy's iframe has had spotty behavior on TMA webviews historically; verify before claiming feature-complete (status.md §4 is explicit about gating success on Privy modal callbacks, not promise resolution alone).
- **Both chains in sequence**: withdraw on Avax → withdraw on BSC, confirm balances clear independently.
- **Dust path**: SCA balance = 0 → button disabled, clear "Nothing to withdraw" copy.

## 10. Conventions introduced (record in status.md)

Add to `fe/privy-auth/status.md`:

- **Rescue-path UI sits above operational controls in ConfigsTab.** Withdraw + Export Key precede AI Agent + Permissions sections, by convention.
- **Sudo-signed user actions outside `SignHandler`** must use `createSudoClient` directly with `requestId`-tagged `step` logs (`started | submitted | succeeded | failed`), and must re-read balance/state from BE immediately before signing to minimize the read→sign race.
- **Privy `exportWallet` flow**: gate behind a confirmation modal with an explicit checkbox; never auto-trigger.

## 11. Out of scope (v2)

- Native asset sweep (AVAX/BNB) — needs separate UserOp shape (`value`, no `data`).
- Multi-token sweep with batched UserOp via Kernel `executeBatch` — wait until BE adds a multi-asset preview endpoint.
- A "Show seed phrase" path — Privy embedded wallets are MPC-sharded; no seed exists. Don't surface the option.
- Linking to the ZeroDev dashboard from the Export Key section — discuss with product before adding outbound links from inside the TMA.

## 12. Logging quick reference

```ts
const log = createLogger("withdrawUsdc");
log.info("step", { step: "started", requestId, chainId });
log.debug(`→ GET /wallet/withdraw/preview chainId=${chainId}`, { requestId });
log.info("step", { step: "submitted", requestId, hash });
log.warn("preview-stale", { requestId, chainId }); // optional, if we detect drift
log.error("sweep-usdc-failed", { requestId, chainId, err: msg });

const exportLog = createLogger("exportKey");
exportLog.info("step", { step: "started" });
exportLog.error("export-key-failed", { err: msg });
```
