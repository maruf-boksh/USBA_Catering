// Numeric helpers for quantities. Subtracting stock from required quantities
// (e.g. shortfall = required - onHand) routinely produces binary floating-point
// artefacts like 12.099999999999994. Route every such computation through
// roundQty so those artefacts never reach the UI.

/**
 * Round a quantity to `dp` decimal places (default 3), clearing binary FP
 * artefacts. Non-finite input collapses to 0.
 */
export function roundQty(value: number, dp = 3): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * Format a quantity for display: rounded and with trailing zeros stripped
 * (12.1 not 12.100). Use wherever a raw quantity is rendered.
 */
export function fmtQty(value: number, dp = 3): string {
  return String(roundQty(value, dp));
}
