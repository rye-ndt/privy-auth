// Thin wrapper over the BE prediction-market endpoints.
// All calls authenticated with the privy bearer token. Errors throw.
//
// `userId` is intentionally NOT in any URL — every BE handler resolves it
// from the `Authorization: Bearer …` header. Earlier drafts of these
// endpoints had `:userId` segments; the BE was simplified, and the FE was
// passing `smartAccountAddress` as `userId` which would have 404'd.

import { resilientFetch } from './resilientFetch';
import type {
  BetRow,
  BridgeStatusResponse,
  DriftDecisionResponse,
  IntentDetail,
  OrderbookTop,
  PaperBet,
  PaperBetPreview,
  PaperBetSideSelector,
  PaperBetStatus,
  PerformanceBucket,
  PlaceOrderRequest,
  PositionRow,
  PredictionMarketState,
  SellOrderRequest,
  SetupStep,
} from '../types/predictionMarket.types';

interface Ctx {
  backendUrl: string;
  privyToken: string;
}

function authHeaders(privyToken: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${privyToken}` };
}

/**
 * Thrown when the BE rejects a state transition as illegal (HTTP 409). The
 * caller should refresh `/state` and resume from the canonical state instead
 * of retrying or showing a generic error toast.
 */
export class IllegalTransitionError extends Error {
  readonly from?: string;
  readonly to?: string;
  constructor(message: string, opts: { from?: string; to?: string } = {}) {
    super(message);
    this.name = 'IllegalTransitionError';
    this.from = opts.from;
    this.to = opts.to;
  }
}

/**
 * Thrown when the BE rejects a confirm-bet because the user already has a
 * non-terminal bet in flight. Surfaces as a friendly chat message rather than
 * a Sonner error toast.
 */
export class BetInFlightError extends Error {
  constructor() {
    super('Another bet is still being placed.');
    this.name = 'BetInFlightError';
  }
}

async function readBodyForError(r: Response): Promise<{ error?: string; from?: string; to?: string } | null> {
  try {
    const text = await r.text();
    if (!text) return null;
    return JSON.parse(text) as { error?: string; from?: string; to?: string };
  } catch {
    return null;
  }
}

async function getJson<T>(url: string, privyToken: string): Promise<T> {
  const r = await resilientFetch(url, { method: 'GET', headers: authHeaders(privyToken) });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

async function postJson<T>(url: string, privyToken: string, body: unknown): Promise<T> {
  const r = await resilientFetch(url, {
    method: 'POST',
    headers: authHeaders(privyToken),
    body: JSON.stringify(body),
  });
  if (r.ok) return r.json() as Promise<T>;

  // 409 Conflict carries `{error, from, to}` for illegal bet transitions.
  // Distinguish so handlers can refresh state and resume from BE truth.
  if (r.status === 409) {
    const j = await readBodyForError(r);
    throw new IllegalTransitionError(j?.error ?? `POST ${url} → 409`, {
      from: j?.from,
      to: j?.to,
    });
  }
  // BET_IN_FLIGHT lands as a 500 with the message embedded by the BE error
  // mapper (`toErrorMessage`). Detect it so we can surface cleanly.
  if (r.status === 500) {
    const j = await readBodyForError(r);
    if (j?.error?.includes('BET_IN_FLIGHT')) {
      throw new BetInFlightError();
    }
  }
  throw new Error(`POST ${url} → ${r.status}`);
}

export const pmApi = {
  state(ctx: Ctx): Promise<PredictionMarketState> {
    return getJson(`${ctx.backendUrl}/predictionMarket/state`, ctx.privyToken);
  },
  intent(ctx: Ctx, intentId: string): Promise<IntentDetail> {
    return getJson(`${ctx.backendUrl}/predictionMarket/intent/${intentId}`, ctx.privyToken);
  },
  bet(ctx: Ctx, betId: string): Promise<BetRow> {
    return getJson(`${ctx.backendUrl}/predictionMarket/bet/${betId}`, ctx.privyToken);
  },
  bridgeStatus(ctx: Ctx, betId: string): Promise<BridgeStatusResponse> {
    return getJson(`${ctx.backendUrl}/predictionMarket/bet/${betId}/bridge-status`, ctx.privyToken);
  },
  orderbook(ctx: Ctx, tokenId: string): Promise<OrderbookTop> {
    return getJson(`${ctx.backendUrl}/predictionMarket/orderbook/${tokenId}`, ctx.privyToken);
  },
  positions(ctx: Ctx): Promise<PositionRow[]> {
    return getJson(`${ctx.backendUrl}/predictionMarket/positions`, ctx.privyToken);
  },

  setupStep(
    ctx: Ctx,
    step: SetupStep,
    artifacts: Record<string, unknown>,
  ): Promise<{ ok: true; setupStep: SetupStep }> {
    return postJson(`${ctx.backendUrl}/predictionMarket/setup/${step}`, ctx.privyToken, artifacts);
  },
  transitionBet(
    ctx: Ctx,
    betId: string,
    next: { status: BetRow['status']; artifact?: Record<string, unknown> },
  ): Promise<BetRow> {
    return postJson(`${ctx.backendUrl}/predictionMarket/bet/${betId}/transition`, ctx.privyToken, next);
  },
  driftDetected(
    ctx: Ctx,
    betId: string,
    body: { livePriceBps: number },
  ): Promise<DriftDecisionResponse> {
    return postJson(`${ctx.backendUrl}/predictionMarket/bet/${betId}/drift-detected`, ctx.privyToken, body);
  },
  finalizeBet(ctx: Ctx, betId: string, body: { status: BetRow['status'] }): Promise<{ ok: true }> {
    return postJson(`${ctx.backendUrl}/predictionMarket/bet/${betId}/finalize`, ctx.privyToken, body);
  },
  /**
   * Records the on-chain hash of the EOA→SCA refund UserOp the FE submitted
   * after a residual-funds non-fill terminal. BE clears `refundRequired`.
   */
  recordRefund(ctx: Ctx, betId: string, txHash: string): Promise<BetRow> {
    return postJson(`${ctx.backendUrl}/predictionMarket/bet/${betId}/refund`, ctx.privyToken, { txHash });
  },
  placeOrder(ctx: Ctx, body: PlaceOrderRequest): Promise<{ polymarketOrderId: string }> {
    return postJson(`${ctx.backendUrl}/predictionMarket/order/place`, ctx.privyToken, body);
  },
  sellOrder(ctx: Ctx, body: SellOrderRequest): Promise<{ polymarketOrderId: string }> {
    return postJson(`${ctx.backendUrl}/predictionMarket/order/sell`, ctx.privyToken, body);
  },
  finalizePosition(ctx: Ctx, positionId: string, body: { status: 'closed' | 'failed' }): Promise<{ ok: true }> {
    return postJson(
      `${ctx.backendUrl}/predictionMarket/position/${positionId}/finalize`,
      ctx.privyToken,
      body,
    );
  },

  // ── Paper-bet (evaluation mode) helpers ────────────────────────────────
  // These call the BE routes added in Part 2 + the preview route in Part 4.
  // Wire-side here is positional `A|B` because the broadcast deep-link uses
  // that contract; the BE translates to YES/NO of the matching SideThesis.

  paperBetPreview(
    ctx: Ctx,
    args: { findingId: string; side: PaperBetSideSelector },
  ): Promise<PaperBetPreview> {
    const qs = new URLSearchParams({ findingId: args.findingId, side: args.side });
    return getJson(`${ctx.backendUrl}/predictionMarket/paperBetPreview?${qs.toString()}`, ctx.privyToken);
  },
  placePaperBet(
    ctx: Ctx,
    body: { findingId: string; side: PaperBetSideSelector; stakeUsdcCents: number },
  ): Promise<{ paperBet: PaperBet }> {
    return postJson(`${ctx.backendUrl}/predictionMarket/paperBet`, ctx.privyToken, body);
  },
  paperBets(
    ctx: Ctx,
    opts: { status?: PaperBetStatus; limit?: number } = {},
  ): Promise<{ paperBets: PaperBet[] }> {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.limit != null) qs.set('limit', String(opts.limit));
    const tail = qs.toString();
    return getJson(
      `${ctx.backendUrl}/predictionMarket/paperBets${tail ? `?${tail}` : ''}`,
      ctx.privyToken,
    );
  },
  paperPerformance(
    ctx: Ctx,
    opts: {
      groupBy?: 'overall' | 'subject' | 'clusterId' | 'detectorSource';
      status?: PaperBetStatus;
      since?: string;
    } = {},
  ): Promise<{ buckets: PerformanceBucket[]; since: string }> {
    const qs = new URLSearchParams();
    if (opts.groupBy) qs.set('groupBy', opts.groupBy);
    if (opts.status) qs.set('status', opts.status);
    if (opts.since) qs.set('since', opts.since);
    const tail = qs.toString();
    return getJson(
      `${ctx.backendUrl}/predictionMarket/paperPerformance${tail ? `?${tail}` : ''}`,
      ctx.privyToken,
    );
  },
};
