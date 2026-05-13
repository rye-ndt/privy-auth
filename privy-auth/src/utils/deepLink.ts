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
  if (verb === 'place_bet') {
    // Paper-bet contract: `place_bet:<findingId>:<A|B>`. The middle segment is
    // a UUID; the trailing segment encodes which SideThesis the user picked.
    if (rest.length < 2) return null;
    const findingId = rest[0]!;
    const side = rest[1];
    if (!findingId) return null;
    if (side !== 'A' && side !== 'B') return null;
    return { kind: 'place_bet', findingId, side };
  }
  if (verb === 'close_position') {
    const positionId = rest.join(':');
    if (!positionId) return null;
    return { kind: 'close_position', positionId };
  }
  return null;
}
