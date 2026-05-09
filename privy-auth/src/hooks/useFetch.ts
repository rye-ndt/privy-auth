import React from 'react';
import { resilientFetch } from '../utils/resilientFetch';
import { createLogger } from '../utils/logger';

const log = createLogger('useFetch');

export function useFetch<T>(
  url: string | null,
  options: {
    headers?: Record<string, string>;
    transform?: (body: unknown) => T;
    errorMessage?: string;
    enabled?: boolean;
    refetchOnVisible?: boolean;
  } = {},
): { data: T | null; loading: boolean; error: string | null; refetch: () => void } {
  const {
    headers,
    transform,
    errorMessage = 'Request failed',
    enabled = true,
    refetchOnVisible = false,
  } = options;
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(!!url && enabled);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!enabled || !url) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    log.debug('fetching', { url });

    resilientFetch(url, { headers })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<unknown>;
      })
      .then((body) => {
        if (cancelled) return;
        setData(transform ? transform(body) : (body as T));
      })
      .catch((err) => {
        if (!cancelled) {
          log.error(errorMessage, { url, err: err instanceof Error ? err.message : String(err) });
          setError(errorMessage);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled, tick]);

  React.useEffect(() => {
    if (!refetchOnVisible || !enabled || !url) return;
    const handler = () => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1);
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [refetchOnVisible, enabled, url]);

  const refetch = React.useCallback(() => {
    if (!enabled || !url) return;
    setTick((n) => n + 1);
  }, [enabled, url]);

  return { data, loading, error, refetch };
}
