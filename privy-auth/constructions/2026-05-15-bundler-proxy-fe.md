# AA Bundler Proxy — Frontend

Date: 2026-05-15
Status: plan
Pair: `be/constructions/2026-05-15-bundler-proxy-be.md`. **Do not ship this FE change until the BE proxy route is live in the target environment.**

## Why

`eth_sendUserOperation` calls from Telegram Desktop's macOS WKWebView to `api.pimlico.io` throw `TypeError: Load failed` whenever the userOp body crosses roughly 8 KB (real session-key signature size). The same fetch transport, same host, same API key succeed for `pm_getPaymasterStubData`, `pm_getPaymasterData`, and `eth_estimateUserOperationGas` in the very same session, because those bodies are smaller or use dummy signatures. Captured FE diagnostic:

```
rpc-fetch-threw {kind:"bundler", method:"eth_sendUserOperation",
  bodyBytes:8719, durationMs:7, name:"TypeError", message:"Load failed"}
```

WKWebView surfaces no `cause` and no `Response`, so we cannot recover from inside the FE. The fix is to point the bundler transport at our own BE, which forwards JSON-RPC bodies to pimlico server-side. Same-origin + Node fetch = no WKWebView quirk, no CORS preflight, and the pimlico API key is no longer shipped in the bundle.

Paymaster RPCs stay direct from FE → pimlico in this change. They are small bodies and work today; revisit later if needed.

## Scope (in / out)

In scope:

- Replace the bundler URL in `chainConfig.ts` with one derived from `VITE_BACKEND_URL + /aa/bundler/<chainId>`.
- Inject the Privy token as an `Authorization: Bearer …` header on every bundler fetch.
- Drop the pimlico bundler env vars from the FE entirely (`VITE_PIMLICO_BUNDLER_URL`, `VITE_BSC_PIMLICO_BUNDLER_URL`, `VITE_POLYGON_PIMLICO_BUNDLER_URL`).
- Keep the global fetch tracer; bundler errors still flow through `rpcTrace.ts` so future failures stay diagnosable.
- Update `.env.example`.

Out of scope:

- Paymaster proxying. Paymaster URL env vars stay.
- Any change to the session-key signing flow, the userOp shape, the kernel client construction, or `SignHandler.tsx` business logic. Only the transport URL + auth header change.
- A retry/backoff layer for the bundler call. Pimlico's behaviour is preserved 1:1 via the BE pass-through.

## Files changed

- `fe/privy-auth/src/utils/chainConfig.ts` — `getBundlerUrl(chainId)` builds the BE-proxied URL from `VITE_BACKEND_URL`. Remove the `bundlerUrl` field from `CHAIN_REGISTRY`.
- `fe/privy-auth/src/utils/crypto.ts` — when creating the bundler `http()` transport, inject `fetchOptions.headers.Authorization: 'Bearer <privyToken>'`. The function needs the token threaded in; thread it through `createSessionKeyClient` and `createSudoClient`.
- `fe/privy-auth/src/utils/createSudoClient.ts` — same auth header injection.
- `fe/privy-auth/src/components/handlers/SignHandler.tsx` — pass the existing `privyToken` prop into `getSessionClient` / `getSudoClient` calls. Already received via props; just plumb it down.
- `fe/privy-auth/src/components/handlers/PlaceBetHandler.tsx` — same plumbing for the bet flow's call to `createSessionKeyClient`.
- `fe/privy-auth/.env.example` — remove bundler keys, add a short comment pointing at the BE proxy.

No changes to:

- `rpcTrace.ts` — the global fetch wrapper already keys off `safeHost(url)`, so it will trace the new same-origin URL automatically. Just confirm the registered hosts include the new URL after the first transport build.
- ZeroDev / viem versions. No package.json changes.

## Implementation steps

### Step 1 — Wait for the BE proxy

Before touching the FE, verify in the target env (staging, then prod):

```
curl -i -X POST "$BACKEND_URL/aa/bundler/43114" \
  -H "authorization: Bearer $PRIVY_TOKEN" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}'
```

Expect HTTP 200 with pimlico's entry-point list. If this curl doesn't work, the FE change has nothing to land on.

### Step 2 — Refactor `chainConfig.ts`

Current:

```ts
interface ChainEntry {
  chain: Chain;
  defaultRpcUrl: string;
  bundlerUrl: string;
  paymasterUrl?: string;
  sponsorshipPolicyId?: string;
}
```

Drop `bundlerUrl` from the entry. Replace `getBundlerUrl` with:

```ts
function backendBase(): string {
  const raw = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (!raw) throw new Error('VITE_BACKEND_URL is required');
  return raw.replace(/\/$/, ''); // tolerate trailing slash
}

export function getBundlerUrl(chainId: number): string {
  if (!CHAIN_REGISTRY[chainId]) throw new Error(`Unsupported chain ID: ${chainId}`);
  return `${backendBase()}/aa/bundler/${chainId}`;
}
```

Note: the function used to throw "No bundler configured for chain X" when the env var was missing. With the BE-proxied URL the check is "is the chain in the registry?" — the BE returns 503 when its own per-chain env is unset, surfaced as a normal RPC error rather than a build-time check. Acceptable trade-off; document via comment in `getBundlerUrl`.

### Step 3 — Drop bundler env from `CHAIN_REGISTRY`

Each entry in `CHAIN_REGISTRY` currently includes:

```ts
bundlerUrl: import.meta.env.VITE_PIMLICO_BUNDLER_URL as string,
```

Remove that line from all four entries (43114, 43113, 56, 137). Keep `paymasterUrl` and `sponsorshipPolicyId` — those stay direct to pimlico.

### Step 4 — Thread `privyToken` into the bundler transport

The bundler call is the only one that needs auth (the BE proxy gates it). Paymaster + RPC are unchanged.

`createSessionKeyClient(serializedBlob, chainId)` becomes `createSessionKeyClient(serializedBlob, chainId, privyToken)`. Inside, build the bundler transport with a custom fetch that injects the header:

```ts
const bundlerUrl = getBundlerUrl(chainId);

const authedFetch: typeof fetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${privyToken}`);
  return fetch(input, { ...init, headers });
};

return createKernelAccountClient({
  account,
  chain,
  bundlerTransport: http(bundlerUrl, {
    ...instrumentTransport(bundlerUrl, chainId, 'bundler'),
    fetchOptions: { /* nothing — viem doesn't accept a fetch override here */ },
  }),
  // …paymaster wiring unchanged…
});
```

Important: viem's `http()` config does **not** expose a custom `fetch` swap. Two options:

A. **Bake the token into the URL as a query param** (`?t=<token>`). Cleaner viem-side, but tokens in URLs end up in BE access logs and `Referer` headers. Reject.

B. **Inject the header via a per-call `globalThis.fetch` patch scoped to the bundler host.** Extend the existing `rpcTrace.ts` patch so that when the URL matches a registered *bundler* host, it adds the `Authorization` header. Tokens stay in headers, no API surface to wrestle with.

Go with B. Update `rpcTrace.ts`:

```ts
// New: a per-host header injector, set by the transport caller.
const headerInjectors = new Map<string, () => Record<string, string>>();

export function registerHeaderInjector(
  url: string,
  inject: () => Record<string, string>,
): void {
  headerInjectors.set(safeHost(url), inject);
}
```

Inside the patched fetch (in `ensureFetchPatched`):

```ts
const inject = headerInjectors.get(host);
let mergedInit = init;
if (inject) {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(inject())) headers.set(k, v);
  mergedInit = { ...init, headers };
}
// …then call originalFetch(input, mergedInit), and continue with the existing trace/throw logging.
```

The injector is a `() => Record<string,string>` (called per request) rather than a static map, so the token can rotate without re-registering — important because Privy tokens are short-lived and the SignHandler refreshes them between transactions.

In `crypto.ts`, after building `bundlerUrl`:

```ts
registerHeaderInjector(bundlerUrl, () => ({ Authorization: `Bearer ${privyToken}` }));
```

Because `privyToken` is captured in the closure, each `createSessionKeyClient` call binds its own token. The injector keyed by host means the *last* registration wins per host — fine in practice, since the FE only ever has one active SignHandler at a time, and the token is the same Privy session anyway.

### Step 5 — Thread the token into `createSudoClient`

Same change in `createSudoClient.ts`: take `privyToken`, register the injector against `getBundlerUrl(chainId)` before building the kernel client. The manual-sign path (`SigningRequestModal` "approve") will then carry auth too.

### Step 6 — Wire callers

`SignHandler.tsx`:

```ts
const getSessionClient = React.useCallback(
  async (chainId: number) => {
    // …existing cache lookup…
    const c = await createSessionKeyClient(blob, chainId, privyToken);
    // …
  },
  [serializedBlob, serializedBlobs, privyToken],
);

const getSudoClient = React.useCallback(
  async (chainId: number) => {
    // …
    const c = await createSudoClient(provider, embedded.address, chainId, privyToken);
    // …
  },
  [embedded, privyToken],
);
```

Add `privyToken` to the cache invalidation key consideration: if a user reauthenticates and the token rotates, the cached client still has the old injector closure. The `headerInjectors` map is keyed by host, not by client instance, so a fresh `createSessionKeyClient` call (e.g. after the existing per-step `delete` on the cache in `SignHandler.tsx`) will overwrite the injector with the new token. No extra invalidation logic needed.

`PlaceBetHandler.tsx`: locate `createSessionKeyClient(getKernelBlob(eoa, chainId), chainId)` and append `privyToken` (already available in the component as a prop or from `usePrivy()` — match the pattern already used in the file).

### Step 7 — Update `.env.example`

Replace:

```
VITE_PIMLICO_BUNDLER_URL=https://api.pimlico.io/v2/43114/rpc?apikey=your-pimlico-api-key
VITE_BSC_PIMLICO_BUNDLER_URL=
VITE_POLYGON_PIMLICO_BUNDLER_URL=
```

with:

```
# Bundler RPCs go through the BE proxy (see be/constructions/2026-05-15-bundler-proxy-be.md).
# The FE no longer holds a pimlico API key. Set VITE_BACKEND_URL to your BE
# origin and the bundler URL is computed as `${VITE_BACKEND_URL}/aa/bundler/<chainId>`.
```

Keep the paymaster env vars exactly as they are. Confirm `VITE_BACKEND_URL` already exists (it is used by every other BE call — `postResponse`, `fetchNextRequest`, etc.).

### Step 8 — Local repro

Run the FE against a local BE that has the proxy route:

```
cd be && BACKEND_URL=http://localhost:8080 PIMLICO_BUNDLER_URL_43114='https://api.pimlico.io/v2/43114/rpc?apikey=…' npm run dev
cd fe/privy-auth && VITE_BACKEND_URL=http://localhost:8080 VITE_PIMLICO_PAYMASTER_URL='…' VITE_PIMLICO_SPONSORSHIP_POLICY_ID=sp_… npm run dev
```

Manual test in browser (not Telegram yet):

1. Log in as a test user.
2. Trigger `/send 0.01 USDC` to your own SCA.
3. Confirm a network request to `localhost:8080/aa/bundler/43114` with status 200 in DevTools.
4. Confirm a tx hash returns and the BE logs show `bundler-proxy-forward` + `bundler-proxy-result` lines.

Then repro the original failure surface:

1. Deploy FE to staging.
2. Open in Telegram Desktop macOS.
3. Run `/swap 0.1 USDC AVAX`. The original failure was at this exact flow.
4. Confirm success. Confirm `rpcTrace.ts` records no `rpc-fetch-threw` for the bundler host.

### Step 9 — Clean up old logging artifacts

After confirming success in prod for a few days, optionally trim:

- `errorRaw` builders in `SignHandler.tsx` still surface `lastRpcThrowName` / `lastRpcThrowCause` — keep them. They cost nothing and will be the first clue if a similar issue reappears on a different transport.
- The `bodyBytes` field in `RpcTraceEntry` stays — it's useful general diagnostics.

Nothing to revert in `rpcTrace.ts` itself; the global fetch wrapper is still valuable.

## Conventions introduced (record in status.md)

- The FE never holds pimlico (or any AA-bundler) credentials. All bundler RPCs go through `${VITE_BACKEND_URL}/aa/bundler/<chainId>`. Adding a new chain on the FE means: register it in `CHAIN_REGISTRY` and ensure the BE has `PIMLICO_BUNDLER_URL_<chainId>` set.
- The `rpcTrace.ts` global fetch patch now supports per-host header injection via `registerHeaderInjector(url, () => headers)`. Use this for any future host that needs auth — don't introduce a parallel wrapper.
- Privy token plumbing convention: anywhere we build a kernel client (sudo or session), pass `privyToken` as the last positional arg.

## Risks & mitigations

- **Token rotation mid-userOp.** Privy access tokens are short-lived. The injector closure captures the token at `createSessionKeyClient` call time, so a stale token can fire if the client is reused across token refreshes. The existing SignHandler logic already re-creates the session client per step for multi-step swaps (`sessionClientByChainRef.current.delete(reqChainId)` in the next-step branch); for single-step flows the user is always within seconds of the page load, so the token is fresh. Acceptable.
- **`VITE_BACKEND_URL` missing or mis-set.** `getBundlerUrl` throws at first call time, surfacing as an autoSign error in the existing `interpretSignError` flow. Manual sign path also throws. Both paths log via `log.error('createSessionKeyClient failed', …)` already.
- **CORS.** BE already sets `Access-Control-Allow-Origin: *`. No new preflight: `Authorization` + `Content-Type: application/json` is a non-simple combination that triggers preflight, but the BE already responds to OPTIONS for every route.
- **Re-introducing the leaked API key by accident.** After ship, `grep -r PIMLICO_BUNDLER fe/privy-auth/src` should return zero hits. Add it to a CI check or just include it in the PR checklist.

## What does "done" look like

- `npm run build` for `fe/privy-auth` produces a bundle that contains no `api.pimlico.io` reference for the bundler. (Paymaster reference is allowed.) Verify with `grep -r 'pimlico' dist/`.
- Telegram Desktop macOS user runs `/swap` and `/send` on AVAX; both succeed. No `rpc-fetch-threw` events in BE logs.
- `Authorization: Bearer …` header observed on every `/aa/bundler/*` request in BE access logs (one per signed step).
