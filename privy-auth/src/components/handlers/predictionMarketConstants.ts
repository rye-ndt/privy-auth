// Single source of truth for prediction-market handler tunables.
// Keep in sync with the BE's PREDICTION_MARKETS_* env defaults; values that
// must match BE policy (drift, slippage, timeouts) are commented as such.

/** How often FE polls bet/bridge/position status. Local — not BE-coupled. */
export const POLL_INTERVAL_MS = 2_500;

/** Telegram WebApp.close() delay after a terminal phase. Local. */
export const CLOSE_DELAY_MS = 1_500;

/** Drift gate (FE-side mirror of BE PREDICTION_MARKETS_MAX_ORDER_DRIFT_BPS). */
export const DRIFT_BPS = 200;

/** Slippage applied to the live mid when building the limit price. */
export const ORDER_SLIPPAGE_BPS = 50;

/** Bridge poll timeout. Mirrors BE PREDICTION_MARKETS_BRIDGE_TIMEOUT_MS. */
export const BRIDGE_TIMEOUT_MS = 90_000;

/** Order-fill poll timeout. Mirrors BE PREDICTION_MARKETS_UNFILLED_TIMEOUT_MS
 *  ×4 — FE waits longer than the BE's per-order GTC window because the BE
 *  poller may need a tick to pick up the terminal state. */
export const FILL_TIMEOUT_MS = 120_000;

/** Setup gas-funded poll timeout. */
export const GAS_FUNDED_TIMEOUT_MS = 120_000;

/** Polygon session-key install timeout (mini-app may need to redirect to Privy). */
export const CHAIN_INSTALL_TIMEOUT_MS = 30_000;

/** Polymarket CLOB API base URL. */
export const CLOB_API_BASE =
  (import.meta.env.VITE_POLYMARKET_CLOB_API as string | undefined) ??
  'https://clob.polymarket.com';
