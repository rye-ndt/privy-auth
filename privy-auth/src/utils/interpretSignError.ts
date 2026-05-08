// Stable codes the BE keys off to drive recovery flows (e.g. nudge user into
// the /buy onramp on insufficient_token_balance). Add a new code here AND wire
// the matching BE branch when introducing one.
export type SignErrorCode =
  | 'insufficient_gas'
  | 'insufficient_token_balance'
  | 'insufficient_allowance'
  | 'paymaster_rejected'
  | 'paymaster_balance'
  | 'sponsorship_unavailable'
  | 'session_key_invalid'
  | 'nonce_invalid'
  | 'swap_amount_too_small'
  | 'swap_amount_too_large'
  | 'swap_no_liquidity'
  | 'user_rejected'
  | 'timeout'
  | 'rate_limited'
  | 'service_unavailable'
  | 'unknown';

export type InterpretedError = {
  friendly: string;
  raw: string;
  code: SignErrorCode;
};

const PATTERNS: Array<{ test: RegExp; friendly: string; code: SignErrorCode }> = [
  {
    test: /Insufficient Pimlico balance for sponsorship/i,
    friendly: "Sorry, we can't cover network fees right now. Please try again later.",
    code: 'paymaster_balance',
  },
  {
    test: /sponsorship policy.*(not found|invalid|disabled)/i,
    friendly: 'Free network fees are unavailable right now. Please try again later.',
    code: 'sponsorship_unavailable',
  },
  {
    test: /AA21 didn't pay prefund/i,
    friendly: "Your wallet doesn't have enough to cover network fees.",
    code: 'insufficient_gas',
  },
  {
    // Matches both decoded ("ERC20: transfer amount exceeds balance") and the
    // raw revert-data hex form viem sometimes surfaces. The hex
    // "45524332303a207472616e7366657220616d6f756e7420657863656564732062616c616e6365"
    // is the ASCII for that exact string.
    test: /transfer amount exceeds balance|45524332303a207472616e7366657220616d6f756e7420657863656564732062616c616e6365/i,
    friendly: "You don't have enough of this token to send.",
    code: 'insufficient_token_balance',
  },
  {
    // Hex "45524332303a20696e73756666696369656e7420616c6c6f77616e6365" = "ERC20: insufficient allowance".
    test: /insufficient allowance|45524332303a20696e73756666696369656e7420616c6c6f77616e6365/i,
    friendly: 'Your spending cap is too low. Increase it and try again.',
    code: 'insufficient_allowance',
  },
  {
    // Relay solver — amount below the per-route minimum. The hex form is what
    // viem surfaces from `Error(string)` reverts when ABI decoding doesn't run.
    // Hex "51554f54455f535741505f414d4f554e545f544f4f5f534d414c4c" = "QUOTE_SWAP_AMOUNT_TOO_SMALL".
    test: /QUOTE_SWAP_AMOUNT_TOO_SMALL|51554f54455f535741505f414d4f554e545f544f4f5f534d414c4c/i,
    friendly: 'Swap amount is too small for this route. Try a larger amount (typically at least a few dollars).',
    code: 'swap_amount_too_small',
  },
  {
    // Hex "51554f54455f535741505f414d4f554e545f544f4f5f4c41524745" = "QUOTE_SWAP_AMOUNT_TOO_LARGE".
    test: /QUOTE_SWAP_AMOUNT_TOO_LARGE|51554f54455f535741505f414d4f554e545f544f4f5f4c41524745/i,
    friendly: 'Swap amount is too large for this route. Try a smaller amount.',
    code: 'swap_amount_too_large',
  },
  {
    // Hex "4e4f5f4c4951554944495459" = "NO_LIQUIDITY".
    test: /NO_LIQUIDITY|4e4f5f4c4951554944495459/i,
    friendly: 'No liquidity available for this swap route right now. Please try again later or pick a different token.',
    code: 'swap_no_liquidity',
  },
  {
    test: /AA23 reverted|signature error/i,
    friendly: "Your bot's connection expired — please reconnect it.",
    code: 'session_key_invalid',
  },
  {
    test: /AA25 invalid account nonce/i,
    friendly: 'This action was already started. Please try again.',
    code: 'nonce_invalid',
  },
  {
    test: /AA(31|32|33|34)/i,
    friendly: "We couldn't cover network fees this time. Please try again later.",
    code: 'paymaster_rejected',
  },
  {
    test: /user rejected|User denied/i,
    friendly: 'Action was cancelled.',
    code: 'user_rejected',
  },
  {
    test: /timeout|timed out/i,
    friendly: 'The network is slow. Please try again.',
    code: 'timeout',
  },
  {
    test: /\b(429|rate.?limit)\b/i,
    friendly: 'Service is busy. Try again in a moment.',
    code: 'rate_limited',
  },
  {
    test: /\b(503|service unavailable)\b/i,
    friendly: 'Service is temporarily unavailable. Try again in a moment.',
    code: 'service_unavailable',
  },
];

export function interpretSignError(err: unknown): InterpretedError {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  for (const { test, friendly, code } of PATTERNS) {
    if (test.test(raw)) return { friendly, raw, code };
  }
  return {
    friendly: 'Something went wrong. Please try again.',
    raw,
    code: 'unknown',
  };
}
