export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function pollUntil<T>(
  read: () => Promise<T>,
  done: (v: T) => boolean,
  opts: { intervalMs: number; timeoutMs: number },
): Promise<T | null> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    const v = await read();
    if (done(v)) return v;
    await sleep(opts.intervalMs);
  }
  return null;
}

export async function waitForRef(
  pred: () => boolean,
  opts: { intervalMs: number; timeoutMs: number },
): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await sleep(opts.intervalMs);
  }
  return false;
}
