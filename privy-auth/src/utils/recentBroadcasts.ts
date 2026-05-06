import { createLogger } from './logger';

const log = createLogger('recentBroadcasts');
const LS_KEY = 'aegis.recentBroadcasts.v2';
const DEFAULT_TTL_MS = 10 * 60 * 1000;

type Entry = { hash: string; ts: number };
type Store = Record<string, Entry>;

// Dedupe is keyed by the BE-assigned signing requestId, NOT by calldata.
//
// History: v1 keyed by `(to, value, data)` to defend against a BE retry that
// re-issued an identical sign request under a fresh requestId. That worked
// for the retry case but collided with legitimate user-initiated repeats —
// e.g. /send 0.01 USDC twice in a row would silently reuse the first hash
// and report success a second time without broadcasting. The BE-side
// signing-request cache already prevents double-resolution per requestId,
// so requestId-keyed dedupe is sufficient here. The BE adds a server-side
// freshness/uniqueness guard on POST /response for the BE-retry case.
function requestIdKey(requestId: string): string {
  return requestId;
}

function load(): Store {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed as Store : {};
  } catch {
    return {};
  }
}

function save(store: Store) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch {}
}

function prune(store: Store, ttlMs: number): Store {
  const cutoff = Date.now() - ttlMs;
  const next: Store = {};
  for (const [k, v] of Object.entries(store)) {
    if (v.ts >= cutoff) next[k] = v;
  }
  return next;
}

export function findRecentBroadcast(
  requestId: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Entry | null {
  const store = prune(load(), ttlMs);
  const hit = store[requestIdKey(requestId)] ?? null;
  if (hit) log.debug('requestId-dedupe-hit', { requestId, hash: hit.hash, ageMs: Date.now() - hit.ts });
  return hit;
}

export function recordBroadcast(
  requestId: string,
  hash: string,
  ttlMs: number = DEFAULT_TTL_MS,
) {
  const store = prune(load(), ttlMs);
  store[requestIdKey(requestId)] = { hash, ts: Date.now() };
  save(store);
  log.debug('requestId-recorded', { requestId, hash });
}

// In-flight broadcasts: serializes concurrent sends of the same requestId
// within this tab. Catches StrictMode double-mount and effect re-fire while
// a send is still in flight. localStorage dedupe (above) only catches
// *completed* broadcasts; this catches the race in between.
const inFlight = new Map<string, Promise<string>>();

export function trackInFlightBroadcast(
  requestId: string,
  send: () => Promise<`0x${string}`>,
): Promise<`0x${string}`> {
  const key = requestIdKey(requestId);
  const existing = inFlight.get(key);
  if (existing) {
    log.debug('requestId-inflight-coalesced', { requestId });
    return existing as Promise<`0x${string}`>;
  }
  const p: Promise<`0x${string}`> = (async () => {
    try {
      const hash = await send();
      recordBroadcast(requestId, hash);
      return hash;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}
