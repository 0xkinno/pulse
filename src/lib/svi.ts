// SVI (Stochastic Volatility Inspired) surface math.
//
// Raw SVI parameterization (Gatheral 2004):
//   w(k) = a + b * ( rho * (k - m) + sqrt( (k - m)^2 + sigma^2 ) )
// where:
//   k     = log-moneyness = ln(K / F)   (K = strike, F = forward)
//   w(k)  = total implied variance at log-moneyness k = (iv^2) * T
//   a, b, rho, m, sigma = SVI slice parameters from OracleSVI
//
// We also run two no-arbitrage sanity checks that the problem statement names directly:
//   - Butterfly arbitrage: convexity of the variance smile (g(k) >= 0 condition, simplified)
//   - Calendar arbitrage: total variance must be non-decreasing across expiries at same k

export interface SVIParams {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

export interface SurfaceSlice {
  expiryLabel: string;
  expirySeconds: number; // seconds to expiry, used for calendar ordering
  forward: number;
  params: SVIParams;
}

/** Total implied variance w(k) under raw SVI parameterization. */
export function sviTotalVariance(k: number, p: SVIParams): number {
  const { a, b, rho, m, sigma } = p;
  const centered = k - m;
  return a + b * (rho * centered + Math.sqrt(centered * centered + sigma * sigma));
}

/** Implied volatility (annualized) from total variance and time-to-expiry in years. */
export function impliedVolFromVariance(w: number, tYears: number): number {
  if (tYears <= 0) return 0;
  const variance = Math.max(w, 0) / tYears;
  return Math.sqrt(Math.max(variance, 0));
}

export function strikeToLogMoneyness(strike: number, forward: number): number {
  return Math.log(strike / forward);
}

/**
 * Butterfly arbitrage check (simplified Gatheral g-function at a point).
 * g(k) must be >= 0 for the slice to be free of butterfly arbitrage.
 * We evaluate a numerically-differentiated approximation since we only have
 * closed-form w(k), not symbolic derivatives, which is the practical approach
 * a real-time surface monitor would take against streamed SVI params.
 */
export function butterflyGFunction(k: number, p: SVIParams, h = 1e-4): number {
  const w = sviTotalVariance(k, p);
  const wUp = sviTotalVariance(k + h, p);
  const wDown = sviTotalVariance(k - h, p);
  const wPrime = (wUp - wDown) / (2 * h);
  const wDoublePrime = (wUp - 2 * w + wDown) / (h * h);

  if (w <= 0) return 1; // degenerate, treat as non-violating to avoid div/0 noise

  const term1 = Math.pow(1 - (k * wPrime) / (2 * w), 2);
  const term2 = ((wPrime * wPrime) / 4) * (1 / w + 0.25);
  const term3 = wDoublePrime / 2;

  return term1 - term2 + term3;
}

export interface ArbViolation {
  type: 'butterfly' | 'calendar';
  expiryLabel: string;
  k?: number;
  severityBps: number;
  message: string;
}

/** Scan a slice across a k-grid for butterfly violations. */
export function scanButterflyViolations(
  slice: SurfaceSlice,
  kGrid: number[],
  toleranceBps: number,
): ArbViolation[] {
  const violations: ArbViolation[] = [];
  for (const k of kGrid) {
    const g = butterflyGFunction(k, slice.params);
    if (g < -toleranceBps / 10000) {
      violations.push({
        type: 'butterfly',
        expiryLabel: slice.expiryLabel,
        k,
        severityBps: Math.abs(g) * 10000,
        message: `Convexity violation near k=${k.toFixed(3)} on ${slice.expiryLabel}`,
      });
    }
  }
  return violations;
}

/** Calendar arbitrage: total variance at matched k must not decrease as expiry grows. */
export function scanCalendarViolations(
  slices: SurfaceSlice[],
  kGrid: number[],
  toleranceBps: number,
): ArbViolation[] {
  const violations: ArbViolation[] = [];
  const sorted = [...slices].sort((a, b) => a.expirySeconds - b.expirySeconds);

  for (const k of kGrid) {
    for (let i = 1; i < sorted.length; i++) {
      const wPrev = sviTotalVariance(k, sorted[i - 1].params);
      const wCurr = sviTotalVariance(k, sorted[i].params);
      const diff = wCurr - wPrev;
      if (diff < -toleranceBps / 10000) {
        violations.push({
          type: 'calendar',
          expiryLabel: sorted[i].expiryLabel,
          k,
          severityBps: Math.abs(diff) * 10000,
          message: `Variance decreases vs ${sorted[i - 1].expiryLabel} near k=${k.toFixed(3)}`,
        });
      }
    }
  }
  return violations;
}

export function defaultKGrid(steps = 25, range = 0.6): number[] {
  const grid: number[] = [];
  for (let i = 0; i <= steps; i++) {
    grid.push(-range + (2 * range * i) / steps);
  }
  return grid;
}
