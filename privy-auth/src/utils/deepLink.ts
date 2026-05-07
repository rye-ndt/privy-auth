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
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const verb = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  if (!id) return null;
  if (verb === 'place_bet') return { kind: 'place_bet', intentId: id };
  if (verb === 'close_position') return { kind: 'close_position', positionId: id };
  return null;
}
