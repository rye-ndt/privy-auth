import { createLogger } from './logger';

/**
 * Fine-grained RPC tracing for the bundler/paymaster/RPC http transports.
 *
 * Goal: when a userOp send fails, the catch block should know *exactly which
 * JSON-RPC method on which endpoint* was in flight at the moment of failure.
 * `kernelClient.sendTransaction` internally orchestrates a chain of calls
 * (`pm_getPaymasterStubData`, `eth_estimateUserOperationGas`,
 * `pm_getPaymasterData`, `eth_sendUserOperation`, `eth_getUserOperationReceipt`),
 * and a top-level `UserOperationExecutionError` doesn't tell you which one.
 *
 * Usage: pass `instrumentTransport(url, chainId, kind)` into viem's `http()`:
 *   http(url, instrumentTransport(url, chainId, 'bundler'))
 *
 * Read the latest in-flight or last-completed RPC for a chain via
 * `getLastRpc(chainId)` — used by the SignHandler catch to enrich `errorRaw`.
 */

const log = createLogger('rpcTrace');

export type RpcKind = 'bundler' | 'paymaster' | 'rpc';

export type RpcTraceEntry = {
  kind: RpcKind;
  /** Sanitized host + first path segment — never the API key. */
  host: string;
  /** JSON-RPC method extracted from the request body, when present. */
  method?: string;
  /** Byte length of the JSON request body, when stringifiable. */
  bodyBytes?: number;
  /** ms timestamp when the request started. */
  startedAt: number;
  /** ms timestamp when the response arrived. Unset = still in flight. */
  finishedAt?: number;
  /** HTTP response status. Unset = transport threw before a response. */
  status?: number;
  /** Truncated response body when status >= 400. */
  errorBody?: string;
  /** Populated by the fetch-throw interceptor when fetch never returned. */
  throwName?: string;
  throwMessage?: string;
  /** First-level `err.cause` repr, when present. WebKit's TypeError sometimes
   * carries a richer cause (e.g. `kCFErrorDomainCFNetwork` code) that the
   * outer message hides. */
  throwCause?: string;
};

const lastByChain = new Map<number, RpcTraceEntry>();

// Hosts we've instrumented — keyed by `safeHost(url)`. The global fetch wrapper
// only logs/annotates errors for requests that match one of these hosts, so it
// stays scoped to wallet/AA transports and never touches unrelated app fetches.
const registeredHosts = new Map<string, { chainId: number; kind: RpcKind }>();
// Per-URL-prefix header injectors invoked per request, so short-lived auth
// tokens can rotate via `setBundlerAuthToken` without rebuilding cached
// transports. **Keyed by the full registered URL** (not by `safeHost`) — the
// fetch wrapper matches via `startsWith`. This is deliberately stricter than
// the tracer's host key: when `VITE_BACKEND_URL` includes a path prefix
// (e.g. `https://api.example.com/api`), the bundler URL
// (`/api/aa/bundler/<id>`) and other BE routes (`/api/response`) collapse to
// the same `safeHost` (`api.example.com/api`). Keying by the full URL stops
// the bundler injector from firing on unrelated backend fetches.
const headerInjectors = new Map<string, () => Record<string, string>>();

// Latest Privy bearer for the BE-proxied bundler. Updated each time a kernel
// client is built (sudo / session / uninstall). Read by `bundlerAuthHeader`
// per request, so a cached KernelAccountClient picks up the rotated token
// without being recreated.
let bundlerAuthToken: string | null = null;
export function setBundlerAuthToken(token: string): void {
  bundlerAuthToken = token;
}
export const bundlerAuthHeader = (): Record<string, string> =>
  bundlerAuthToken ? { Authorization: `Bearer ${bundlerAuthToken}` } : {};
let fetchPatched = false;

function safeHost(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean)[0] ?? '';
    return seg ? `${u.host}/${seg}` : u.host;
  } catch {
    return url.slice(0, 64);
  }
}

function parseRpcMethod(init: RequestInit | undefined): string | undefined {
  const body = init?.body;
  if (typeof body !== 'string') return undefined;
  try {
    const parsed = JSON.parse(body) as { method?: string } | Array<{ method?: string }>;
    if (Array.isArray(parsed)) {
      // Batch — return the joined method list, capped.
      return parsed
        .slice(0, 4)
        .map((r) => r?.method)
        .filter(Boolean)
        .join(',') || undefined;
    }
    return parsed?.method;
  } catch {
    return undefined;
  }
}

export function instrumentTransport(
  url: string,
  chainId: number,
  kind: RpcKind,
): {
  onFetchRequest: (request: Request, init: RequestInit) => void;
  onFetchResponse: (response: Response) => Promise<void>;
} {
  const host = safeHost(url);
  registeredHosts.set(host, { chainId, kind });
  ensureFetchPatched();
  return {
    onFetchRequest: (_request, init) => {
      const method = parseRpcMethod(init);
      const bodyBytes =
        typeof init?.body === 'string' ? init.body.length : undefined;
      const entry: RpcTraceEntry = {
        kind,
        host,
        method,
        bodyBytes,
        startedAt: Date.now(),
      };
      lastByChain.set(chainId, entry);
      log.debug('rpc-request', { chainId, kind, host, method, bodyBytes });
    },
    onFetchResponse: async (response) => {
      const entry = lastByChain.get(chainId);
      if (!entry) return;
      entry.finishedAt = Date.now();
      entry.status = response.status;
      const durationMs = entry.finishedAt - entry.startedAt;
      if (response.status >= 400) {
        try {
          // Clone so the SDK can still consume the body downstream.
          const text = await response.clone().text();
          entry.errorBody = text.slice(0, 256);
        } catch {
          // Body unreadable (already consumed, or non-text) — leave unset.
        }
        log.warn('rpc-error-response', {
          chainId,
          kind,
          host,
          method: entry.method,
          status: response.status,
          durationMs,
          body: entry.errorBody,
        });
      } else {
        log.debug('rpc-response', {
          chainId,
          kind,
          host,
          method: entry.method,
          status: response.status,
          durationMs,
        });
      }
    },
  };
}

/**
 * Register a per-URL-prefix header injector. The injector is called per
 * request, so the closure can return a freshly-read token each time —
 * important for short-lived Privy access tokens. Matches by URL prefix at
 * fetch time, so the registered string acts as the narrowest namespace the
 * caller is comfortable with (typically the exact bundler URL).
 *
 * Trailing slashes are stripped so callers don't have to think about it.
 */
export function registerHeaderInjector(
  url: string,
  inject: () => Record<string, string>,
): void {
  const key = url.replace(/\/$/, '');
  headerInjectors.set(key, inject);
  ensureFetchPatched();
}

/** First injector whose registered URL is a prefix of `urlStr`, or undefined. */
function findInjector(urlStr: string): (() => Record<string, string>) | undefined {
  for (const [prefix, fn] of headerInjectors) {
    if (urlStr === prefix || urlStr.startsWith(prefix + '/') || urlStr.startsWith(prefix + '?')) {
      return fn;
    }
  }
  return undefined;
}

/** The latest RPC the instrumented transports observed for `chainId`. */
export function getLastRpc(chainId: number): RpcTraceEntry | undefined {
  return lastByChain.get(chainId);
}

/** Compact one-line summary for embedding into `errorRaw`. */
export function summarizeLastRpc(entry: RpcTraceEntry | undefined): string | undefined {
  if (!entry) return undefined;
  const inFlight = entry.finishedAt === undefined && !entry.throwName;
  const dur = (entry.finishedAt ?? Date.now()) - entry.startedAt;
  const parts = [
    `${entry.kind}:${entry.method ?? '?'}`,
    inFlight
      ? 'in-flight'
      : entry.throwName
        ? `threw=${entry.throwName}`
        : `status=${entry.status}`,
    `durMs=${dur}`,
  ];
  if (entry.bodyBytes !== undefined) parts.push(`bodyBytes=${entry.bodyBytes}`);
  if (entry.throwMessage) parts.push(`msg=${entry.throwMessage.slice(0, 96)}`);
  if (entry.throwCause) parts.push(`cause=${entry.throwCause.slice(0, 96)}`);
  if (entry.errorBody) parts.push(`body=${entry.errorBody.slice(0, 96)}`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Global fetch wrapper
//
// viem's `onFetchRequest`/`onFetchResponse` hooks only fire on the happy path.
// When fetch itself throws (TypeError: Load failed in WebKit, AbortError,
// network unreachable), the hook never runs and viem wraps the original error
// as a generic `HttpRequestError("HTTP request failed")` — losing the
// underlying name/message/cause. To recover that detail without changing the
// SDK call sites, we monkey-patch global fetch once, scoped to the hosts the
// transports register. On throw we annotate the matching trace entry so
// SignHandler's catch can read it back via `getLastRpc` + `summarizeLastRpc`.
// ---------------------------------------------------------------------------
function ensureFetchPatched(): void {
  if (fetchPatched) return;
  if (typeof globalThis.fetch !== 'function') return;
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const host = safeHost(urlStr);
    const registered = registeredHosts.get(host);
    const inject = findInjector(urlStr);
    if (!registered && !inject) return originalFetch(input, init);

    let nextInit = init;
    if (inject) {
      const headers = new Headers(init?.headers);
      for (const [k, v] of Object.entries(inject())) headers.set(k, v);
      nextInit = { ...init, headers };
    }
    if (!registered) return originalFetch(input, nextInit);

    try {
      return await originalFetch(input, nextInit);
    } catch (err) {
      const entry = lastByChain.get(registered.chainId);
      const name = err instanceof Error ? err.name : 'UnknownError';
      const message = err instanceof Error ? err.message : String(err);
      const causeRaw = (err as { cause?: unknown })?.cause;
      const cause =
        causeRaw instanceof Error
          ? `${causeRaw.name}: ${causeRaw.message}`
          : causeRaw !== undefined
            ? String(causeRaw)
            : undefined;
      if (entry) {
        entry.throwName = name;
        entry.throwMessage = message;
        entry.throwCause = cause;
        entry.finishedAt = Date.now();
      }
      log.warn('rpc-fetch-threw', {
        chainId: registered.chainId,
        kind: registered.kind,
        host,
        method: entry?.method,
        bodyBytes: entry?.bodyBytes,
        durationMs: entry ? Date.now() - entry.startedAt : undefined,
        name,
        message,
        cause,
      });
      throw err;
    }
  };

  fetchPatched = true;
  log.debug('global-fetch-patched');
}
