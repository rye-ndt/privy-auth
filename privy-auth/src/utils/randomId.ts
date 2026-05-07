/**
 * crypto.randomUUID with a deterministic-on-failure fallback. Used for
 * client-generated correlation/idempotency keys (request ids, Polymarket
 * `clientOrderId`, etc.) where the value just needs to be unique within the
 * caller's window.
 */
export function newRandomId(fallbackSliceLen = 8): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 2 + fallbackSliceLen)}`;
}
