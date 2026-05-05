import { createLogger } from './logger';

const log = createLogger('telegramStorage');

// Telegram CloudStorage limits per key/value: max 4096 bytes per value, max 1024 keys.
// Leave headroom under the 4096 cap for safety against UTF-8 byte/char drift.
const MAX_CHUNK_CHARS = 3800;
// Hard timeout on every CloudStorage callback. Telegram has been observed to drop
// callbacks silently when the value exceeds the per-key cap or when the WebView
// event channel hangs — without this, awaits inside setup block forever.
const TIMEOUT_MS = 15_000;
// Manifest sentinel written at the main key when a value is split across chunks.
// Chunk keys live at `${key}_c${i}` for i in [0, N).
const MANIFEST_PREFIX = '__aegis_chunks_v1:';

// CloudStorage requires Telegram WebApp v6.9+. Install an in-memory mock when:
//   - CloudStorage is absent entirely (dev browser, non-Telegram context), OR
//   - the runtime version is below 6.9 (stub object present but callbacks never fire)
function cloudStorageSupported(): boolean {
  const cs = window.Telegram?.WebApp?.CloudStorage;
  if (!cs) return false;
  const version = parseFloat((window.Telegram?.WebApp as any)?.version ?? '0');
  return version >= 6.9;
}

if (!cloudStorageSupported()) {
  const LS_PREFIX = '__tg_cs__';
  const lsGet = (k: string) => localStorage.getItem(LS_PREFIX + k) ?? '';
  const lsSet = (k: string, v: string) => localStorage.setItem(LS_PREFIX + k, v);
  const lsDel = (k: string) => localStorage.removeItem(LS_PREFIX + k);
  const lsKeys = () =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith(LS_PREFIX))
      .map((k) => k.slice(LS_PREFIX.length));

  (window as any).Telegram = {
    WebApp: {
      ...(window.Telegram?.WebApp ?? {}),
      CloudStorage: {
        setItem: (k: string, v: string, cb?: (e: null, s: boolean) => void) => { lsSet(k, v); cb?.(null, true); },
        getItem: (k: string, cb: (e: null, v: string) => void) => cb(null, lsGet(k)),
        getItems: (ks: string[], cb: (e: null, v: Record<string, string>) => void) => cb(null, Object.fromEntries(ks.map(k => [k, lsGet(k)]))),
        removeItem: (k: string, cb?: (e: null, r: boolean) => void) => { lsDel(k); cb?.(null, true); },
        getKeys: (cb: (e: null, ks: string[]) => void) => cb(null, lsKeys()),
      },
    },
  };
}

function getCloudStorage(): TelegramCloudStorage {
  const cs = window.Telegram?.WebApp?.CloudStorage;
  if (!cs) {
    throw new Error(
      'Telegram CloudStorage is not available. This app must run inside Telegram.',
    );
  }
  return cs;
}

function withTimeout<T>(p: Promise<T>, op: string, key: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      log.warn('cloudstorage-timeout', { op, key, timeoutMs: TIMEOUT_MS });
      reject(new Error(`Telegram CloudStorage ${op}("${key}") timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function rawGet(key: string): Promise<string | null> {
  return withTimeout(
    new Promise<string | null>((resolve, reject) => {
      getCloudStorage().getItem(key, (error, value) => {
        if (error) return reject(new Error(error));
        resolve(value === '' ? null : value);
      });
    }),
    'getItem',
    key,
  );
}

function rawSet(key: string, value: string): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve, reject) => {
      getCloudStorage().setItem(key, value, (error, stored) => {
        if (error) return reject(new Error(error));
        if (!stored) return reject(new Error(`CloudStorage refused to store key "${key}"`));
        resolve();
      });
    }),
    'setItem',
    key,
  );
}

function rawRemove(key: string): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve, reject) => {
      getCloudStorage().removeItem(key, (error) => {
        if (error) return reject(new Error(error));
        resolve();
      });
    }),
    'removeItem',
    key,
  );
}

function chunkKey(key: string, i: number): string {
  return `${key}_c${i}`;
}

function parseManifest(raw: string): number | null {
  if (!raw.startsWith(MANIFEST_PREFIX)) return null;
  const n = Number(raw.slice(MANIFEST_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function clearChunksIfAny(key: string): Promise<void> {
  const head = await rawGet(key).catch(() => null);
  if (head == null) return;
  const n = parseManifest(head);
  if (n == null) return;
  for (let i = 0; i < n; i++) {
    await rawRemove(chunkKey(key, i)).catch(() => {});
  }
}

export async function cloudStorageGetItem(key: string): Promise<string | null> {
  const head = await rawGet(key);
  if (head == null) return null;
  const n = parseManifest(head);
  if (n == null) {
    // Legacy / small unchunked value — return as-is.
    return head;
  }
  log.debug('chunked-read', { key, chunks: n });
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const part = await rawGet(chunkKey(key, i));
    if (part == null) {
      log.warn('chunked-read-missing', { key, missingIndex: i, expected: n });
      return null;
    }
    parts.push(part);
  }
  return parts.join('');
}

export async function cloudStorageSetItem(key: string, value: string): Promise<void> {
  // Always clear any prior chunk residue first so a shorter rewrite doesn't leave
  // orphaned chunks that a future read could mis-concatenate.
  await clearChunksIfAny(key).catch((err) => {
    log.debug('clear-chunks-failed', { key, err: String(err) });
  });

  if (value.length <= MAX_CHUNK_CHARS) {
    await rawSet(key, value);
    return;
  }

  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += MAX_CHUNK_CHARS) {
    chunks.push(value.slice(i, i + MAX_CHUNK_CHARS));
  }
  log.debug('chunked-write', { key, chunks: chunks.length, totalChars: value.length });
  // Write chunks before the manifest — if anything fails mid-write, the main key
  // still holds the previous (or no) manifest, so a partial state can't be read
  // as a successful chunked value.
  for (let i = 0; i < chunks.length; i++) {
    await rawSet(chunkKey(key, i), chunks[i]!);
  }
  await rawSet(key, `${MANIFEST_PREFIX}${chunks.length}`);
}

export async function cloudStorageRemoveItem(key: string): Promise<void> {
  await clearChunksIfAny(key);
  await rawRemove(key);
}
