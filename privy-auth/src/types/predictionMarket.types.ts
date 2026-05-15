export type SetupStep =
  | 'pending'
  | 'sca_deployed'
  | 'gas_funded'
  | 'approved'
  | 'authed'
  | 'complete';

export type BetStatus =
  | 'INITIATED'
  | 'BRIDGING'
  | 'BRIDGED'
  | 'SCA_TO_EOA'
  | 'ORDER_SIGNED'
  | 'ORDER_SUBMITTED'
  | 'FILLED'
  | 'PARTIAL'
  | 'UNFILLED'
  | 'FAILED';

export const TERMINAL_BET_STATUSES: BetStatus[] = [
  'FILLED',
  'PARTIAL',
  'UNFILLED',
  'FAILED',
];

export type PositionStatus = 'open' | 'closing' | 'closed' | 'resolved';

export type BridgeStatus = 'pending' | 'success' | 'failure' | 'refund';

export interface BetIntent {
  id: string;
  userId: string;
  findingId: string | null;
  marketId: string;
  outcomeTokenId: string;
  side: string;
  sideLabel: string;
  stakeUsdc: string;
  refPriceBps: number;
  status: 'awaiting_amount' | 'awaiting_confirm' | 'executing' | 'completed' | 'cancelled' | 'failed';
  betId: string | null;
}

export interface BetRow {
  id: string;
  userId: string;
  intentId: string;
  marketId: string;
  outcomeTokenId: string;
  side: string;
  stakeUsdc: string;
  refPriceBps: number;
  clientOrderId: string;
  bridgeIntentId: string | null;
  scaToEoaTxHash: string | null;
  polymarketOrderId: string | null;
  status: BetStatus;
  filledShares: string | null;
  filledAvgPriceBps: number | null;
  failureReason: string | null;
  betKind: 'open' | 'close';
  parentBetId: string | null;
  /**
   * BE flags this when an `open` bet terminates as PARTIAL/UNFILLED/FAILED
   * with `scaToEoaTxHash` set (USDC made it to the EOA but didn't convert
   * fully to outcome tokens). FE sweeps the residual back to the SCA on next
   * mini-app open and POSTs the resulting tx hash to /bet/:id/refund, which
   * clears the flag.
   */
  refundRequired: boolean;
  refundTxHash: string | null;
}

export interface PositionRow {
  id: string;
  userId: string;
  marketId: string;
  marketQuestion: string;
  outcomeTokenId: string;
  side: string;
  sideLabel: string;
  sizeShares: string;
  entryPriceAvgBps: number;
  entryStakeUsdc: string;
  currentPriceBps: number | null;
  currentValueUsdc: string | null;
  unrealizedPnlUsdc: string | null;
  status: PositionStatus;
  realizedPnlUsdc: string | null;
  openedAt: string;
  closedAt: string | null;
}

export interface PredictionMarketState {
  setup: {
    setupStep: SetupStep;
    polygonScaAddress: string | null;
    polygonEoaAddress: string | null;
  };
  inFlightBets: BetRow[];
  openPositions: PositionRow[];
}

export interface IntentDetail {
  intent: BetIntent;
  marketQuestion: string;
  bet: BetRow | null;
}

export interface OrderbookTop {
  tokenId: string;
  bestBidBps: number;
  bestAskBps: number;
  midBps: number;
  fetchedAt: string;
}

export interface BridgeStatusResponse {
  /**
   * Status string from Relay normalized to `BridgeStatus`, OR `'no-intent'`
   * when the bet hasn't kicked off a bridge yet. The handler treats the
   * latter as a hard error (the FE failed to record `bridgeIntentId`).
   */
  status: BridgeStatus | 'no-intent';
  bridgeIntentId?: string;
  deliveredUsdc?: string | null;
  detail?: string | null;
}

export type DriftDecisionResponse =
  | { decision: 'ok' }
  | {
      decision: 'reconfirm';
      previousRefPriceBps: number;
      newRefPriceBps: number;
      driftBps: number;
    };

export interface PolymarketOrderArtifact {
  salt: string;
  maker: `0x${string}`;
  signer: `0x${string}`;
  taker: `0x${string}`;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  expiration: string;
  nonce: string;
  feeRateBps: string;
  side: 0 | 1; // 0 = BUY, 1 = SELL
  signatureType: 0; // 0 = EOA
  signature: `0x${string}`;
}

export interface PlaceOrderRequest {
  betId: string;
  clientOrderId: string;
  order: PolymarketOrderArtifact;
  livePriceBps: number;
}

export interface SellOrderRequest {
  positionId: string;
  closingBetId: string;
  clientOrderId: string;
  order: PolymarketOrderArtifact;
  livePriceBps: number;
}

export type DeepLinkAction =
  | { kind: 'close_position'; positionId: string };
