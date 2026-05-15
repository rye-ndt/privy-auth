// In dev/desktop the start_param isn't on Telegram.WebApp; fall back to the URL.

import type { DeepLinkAction } from '../types/predictionMarket.types';

interface TgStart {
  initDataUnsafe?: { start_param?: string };
}

export function readStartParam(): string | null {
  const tg = (window as unknown as { Telegram?: { WebApp?: TgStart } }).Telegram?.WebApp;
  const fromTg = tg?.initDataUnsafe?.start_param;
  if (fromTg) return fromTg;
  const params = new URLSearchParams(window.location.search);
  return params.get('tgWebAppStartParam') ?? params.get('startapp');
}

export function parseDeepLink(): DeepLinkAction | null {
  const raw = readStartParam();
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length < 2) return null;
  const [verb, ...rest] = parts;
  if (verb === 'close_position') {
    const positionId = rest.join(':');
    if (!positionId) return null;
    return { kind: 'close_position', positionId };
  }
  return null;
}
