// Computes a DISPLAY-ONLY Up/Down probability (like Polymarket's "63¢") from
// the same SVI surface already used elsewhere in this app.
//
// IMPORTANT — this is a faithful re-derivation of the SHAPE of the real
// on-chain math (oracle.move's compute_nd2: SVI total variance -> Black-
// Scholes-style d2 -> standard normal CDF), but it uses ordinary JS floating
// point with a standard normal-CDF approximation (Abramowitz & Stegun 7.1.26),
// NOT a port of the contract's exact fixed-point Cody's-algorithm
// implementation (predict/sources/helper/math.move). The two will agree to
// many decimal places for any reasonable input, but this function must NEVER
// be used to decide a real strike, quantity, or any value that goes into an
// actual transaction — only for showing an indicative probability on screen.
// Real transactions continue to read on-chain state directly (onChainOracle.ts).

export interface SVIParamsHuman {
    a: number;
    b: number;
    rho: number;
    m: number;
    sigma: number;
  }
  
  function standardNormalCdf(x: number): number {
    // Abramowitz & Stegun 7.1.26, accurate to ~7.5e-8 — plenty for a display price.
    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * absX);
    const y =
      1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
        t *
        Math.exp(-absX * absX);
    return 0.5 * (1 + sign * y);
  }
  
  /**
   * Returns the probability (0..1) that the underlying settles ABOVE `strike`
   * at expiry, given the oracle's forward price and SVI smile parameters — the
   * same inputs and shape of computation the real contract uses to price a
   * binary "Up" position before adding spread.
   */
  export function upProbability(strike: number, forward: number, svi: SVIParamsHuman): number | null {
    if (forward <= 0 || strike <= 0) return null;
    const k = Math.log(strike / forward);
    const kMinusM = k - svi.m;
    const sq = Math.sqrt(kMinusM * kMinusM + svi.sigma * svi.sigma);
    const inner = svi.rho * kMinusM + sq;
    if (inner < 0) return null; // mirrors the contract's ECannotBeNegative guard
    const totalVar = svi.a + svi.b * inner;
    if (totalVar <= 0) return null;
    const sqrtVar = Math.sqrt(totalVar);
    const d2 = -((k + totalVar / 2) / sqrtVar);
    // compute_nd2 returns N(d2) directly as the Up price (no extra negation —
    // verified against oracle.move's compute_price/compute_nd2 return value).
    return standardNormalCdf(d2);
  }
  
  export function formatProbabilityAsCents(prob: number | null): string {
    if (prob === null || !Number.isFinite(prob)) return '—';
    return `${Math.round(prob * 100)}¢`;
  }