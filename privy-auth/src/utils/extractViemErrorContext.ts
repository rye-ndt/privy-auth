import { getBundlerUrl, getPaymasterUrl, getRpcUrlById } from './chainConfig';

export type ViemErrorContext = {
  /** Whether the failing HTTP request was the bundler, paymaster, or generic RPC. */
  kind?: 'bundler' | 'paymaster' | 'rpc' | 'unknown';
  /** Host + first path segment of the failing URL (no query, no api key). */
  endpoint?: string;
  /** HTTP status code, if surfaced by viem's HttpRequestError. */
  status?: number;
  /** Response body (truncated) when present. */
  body?: string;
  /** viem's short top-level message — kind tag of the error. */
  shortMessage?: string;
  /** viem's `details` field — the underlying error message. */
  details?: string;
  /** Names of every error in the cause chain, root-cause last. */
  causeChain?: string[];
};

function safeHost(url: string): string {
  try {
    const u = new URL(url);
    const firstSeg = u.pathname.split('/').filter(Boolean)[0] ?? '';
    return firstSeg ? `${u.host}/${firstSeg}` : u.host;
  } catch {
    return url.slice(0, 64);
  }
}

function classifyUrl(url: string, chainId?: number): ViemErrorContext['kind'] {
  if (!chainId) return 'unknown';
  try {
    const bundler = getBundlerUrl(chainId);
    if (bundler && url.startsWith(bundler.split('?')[0]!.split('#')[0]!)) return 'bundler';
  } catch {}
  const paymaster = getPaymasterUrl(chainId);
  if (paymaster && url.startsWith(paymaster.split('?')[0]!.split('#')[0]!)) return 'paymaster';
  try {
    const rpc = getRpcUrlById(chainId);
    if (rpc && url.startsWith(rpc.split('?')[0]!.split('#')[0]!)) return 'rpc';
  } catch {}
  return 'unknown';
}

/**
 * Walks viem's `cause` chain to surface the underlying HTTP/RPC failure
 * details that `err.message` strips. Read-only — never throws.
 */
export function extractViemErrorContext(
  err: unknown,
  chainId?: number,
): ViemErrorContext {
  const out: ViemErrorContext = {};
  if (!(err instanceof Error)) return out;

  const chain: string[] = [];
  let cur: unknown = err;
  let depth = 0;
  while (cur instanceof Error && depth < 8) {
    chain.push(cur.name);
    const anyErr = cur as Error & {
      shortMessage?: string;
      details?: string;
      url?: string;
      status?: number;
      body?: unknown;
      cause?: unknown;
    };
    if (!out.shortMessage && anyErr.shortMessage) out.shortMessage = anyErr.shortMessage;
    if (!out.details && anyErr.details) out.details = anyErr.details;
    if (!out.status && typeof anyErr.status === 'number') out.status = anyErr.status;
    if (!out.endpoint && typeof anyErr.url === 'string') {
      out.endpoint = safeHost(anyErr.url);
      out.kind = classifyUrl(anyErr.url, chainId);
    }
    if (!out.body && anyErr.body !== undefined) {
      try {
        const s = typeof anyErr.body === 'string' ? anyErr.body : JSON.stringify(anyErr.body);
        out.body = s.slice(0, 256);
      } catch {
        out.body = String(anyErr.body).slice(0, 256);
      }
    }
    cur = anyErr.cause;
    depth++;
  }
  if (chain.length > 0) out.causeChain = chain;
  return out;
}

export type ErrorRawEnv = {
  /** ms from the userOp send dispatch to the failure. */
  durationMs?: number;
  /** navigator.onLine at the time of failure. */
  online?: boolean;
  /** document.visibilityState ('visible' | 'hidden') at the time of failure. */
  visibility?: string;
  /** window.Telegram.WebApp.platform — 'ios' | 'android' | 'tdesktop' | etc. */
  tgPlatform?: string;
  /** window.Telegram.WebApp.version. */
  tgVersion?: string;
  /** SCA address for on-chain cross-reference (nonce/balance) during triage. */
  sca?: string;
  /** Compact summary of the last in-flight RPC call from `rpcTrace`.
   *  Format: `<kind>:<method> (in-flight|status=N) durMs=N [body=…]`. */
  lastRpc?: string;
};

/**
 * Compact `errorRaw` for the BE response payload. Prefixes the viem context
 * (kind/status/endpoint/body) and an environment snapshot
 * (duration/online/visibility/platform) so the BE log shows root cause and
 * device-state at-a-glance, then appends the original `err.message`. Capped
 * at 1024 chars (BE schema).
 *
 * BE-side parser: `parseTransportTag` in
 * `be/src/use-cases/implementations/signingRequest.usecase.ts` lifts the
 * `[kind] HTTP <status> <endpoint>` segment back into structured fields.
 */
export function buildErrorRaw(
  err: unknown,
  ctx: ViemErrorContext,
  env?: ErrorRawEnv,
): string {
  const base = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const tag = [
    ctx.kind && `[${ctx.kind}]`,
    ctx.status && `HTTP ${ctx.status}`,
    ctx.endpoint && ctx.endpoint,
    ctx.body && `body=${ctx.body}`,
  ].filter(Boolean).join(' ');
  const envParts: string[] = [];
  if (env?.durationMs !== undefined) envParts.push(`durationMs=${env.durationMs}`);
  if (env?.online !== undefined) envParts.push(`online=${env.online}`);
  if (env?.visibility) envParts.push(`vis=${env.visibility}`);
  if (env?.tgPlatform) envParts.push(`tg=${env.tgPlatform}/${env.tgVersion ?? '?'}`);
  if (env?.sca) envParts.push(`sca=${env.sca}`);
  const envTag = envParts.length ? `{${envParts.join(' ')}}` : '';
  // Carried on its own line so the BE parser can lift the lastRpc summary
  // into a structured field without conflicting with the env-tag braces.
  const lastRpcLine = env?.lastRpc ? `lastRpc=${env.lastRpc}` : '';
  const head = [tag, envTag].filter(Boolean).join(' ');
  const combined = [head, lastRpcLine, base].filter(Boolean).join('\n');
  return combined.slice(0, 1024);
}
