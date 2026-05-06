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
  /** ms timestamp when the request started. */
  startedAt: number;
  /** ms timestamp when the response arrived. Unset = still in flight. */
  finishedAt?: number;
  /** HTTP response status. Unset = transport threw before a response. */
  status?: number;
  /** Truncated response body when status >= 400. */
  errorBody?: string;
};

const lastByChain = new Map<number, RpcTraceEntry>();

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
  return {
    onFetchRequest: (_request, init) => {
      const method = parseRpcMethod(init);
      const entry: RpcTraceEntry = {
        kind,
        host,
        method,
        startedAt: Date.now(),
      };
      lastByChain.set(chainId, entry);
      log.debug('rpc-request', { chainId, kind, host, method });
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

/** The latest RPC the instrumented transports observed for `chainId`. */
export function getLastRpc(chainId: number): RpcTraceEntry | undefined {
  return lastByChain.get(chainId);
}

/** Compact one-line summary for embedding into `errorRaw`. */
export function summarizeLastRpc(entry: RpcTraceEntry | undefined): string | undefined {
  if (!entry) return undefined;
  const inFlight = entry.finishedAt === undefined;
  const dur = (entry.finishedAt ?? Date.now()) - entry.startedAt;
  const parts = [
    `${entry.kind}:${entry.method ?? '?'}`,
    inFlight ? 'in-flight' : `status=${entry.status}`,
    `durMs=${dur}`,
  ];
  if (entry.errorBody) parts.push(`body=${entry.errorBody.slice(0, 96)}`);
  return parts.join(' ');
}
