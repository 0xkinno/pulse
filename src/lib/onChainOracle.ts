// Reads the REAL OracleSVI object directly from the Sui blockchain, bypassing
// the indexed server entirely. This exists because the indexed server's
// /oracles list endpoint does NOT include forward price or SVI params (only
// oracle_id, expiry, min_strike, tick_size, status) — every mint attempt
// before this file existed was computing a strike against a FABRICATED
// spot/forward/SVI, which is why pricing_config::quote_spread_from_fair_price
// kept aborting: the contract's own compute_nd2 (Black-Scholes-style normal
// CDF over the SVI surface) was being fed log-moneyness computed against a
// forward price that had no relationship to the real oracle.
//
// Real struct, confirmed directly from oracle.move on predict-testnet-4-16:
//
//   public struct OracleSVI has key {
//       id: UID,
//       authorized_caps: VecSet<ID>,
//       underlying_asset: String,
//       expiry: u64,              // ms since epoch
//       active: bool,
//       prices: PriceData { spot: u64, forward: u64 },   // scaled 1e9
//       svi: SVIParams { a: u64, b: u64, rho: I64, m: I64, sigma: u64 },  // scaled 1e9
//       timestamp: u64,
//       settlement_price: Option<u64>,
//   }
//
// All numeric fields are scaled by FLOAT_SCALING = 1e9 per the Move source's
// own doc comment on SVIParams. rho/m are signed (i64::I64), which the Sui
// JSON-RPC layer serializes as a struct with a sign bit + magnitude — this
// file decodes that shape defensively since it was never directly inspected
// before now.

import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';

export interface OnChainOracle {
  oracleId: string;
  underlyingAsset: string;
  expiryMs: number;
  active: boolean;
  spot: number; // human-readable (already divided by 1e9)
  forward: number; // human-readable
  svi: { a: number; b: number; rho: number; m: number; sigma: number }; // human-readable
  settlementPrice: number | null;
  isSettled: boolean;
}

const FLOAT_SCALING = 1_000_000_000;

function toNumber(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return Number(raw);
  return NaN;
}

/**
 * Decodes Move's signed i64::I64 as serialized by the Sui JSON-RPC layer.
 * The exact wrapper shape wasn't directly inspected before this fetch, so
 * this tries the plausible encodings rather than assuming one — a negative
 * sign field (bool or 0/1) alongside a magnitude, OR a single signed numeric
 * string (some custom signed-int wrappers serialize this way directly).
 */
function decodeI64(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return Number(raw);
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const magnitude = toNumber(o.magnitude ?? o.value ?? o.bits ?? 0);
    const negativeFlag = o.negative ?? o.is_negative ?? o.sign;
    const isNegative =
      negativeFlag === true || negativeFlag === 1 || negativeFlag === '1';
    return isNegative ? -magnitude : magnitude;
  }
  return 0;
}

/**
 * Fetches one OracleSVI object directly from chain and decodes it into
 * human-readable units. Returns null if the object can't be read or parsed —
 * callers MUST treat null as "cannot safely mint against this oracle right
 * now" rather than falling back to an estimate, since an estimate is exactly
 * what caused the original bug.
 */
export async function fetchOnChainOracle(
  client: SuiJsonRpcClient,
  oracleId: string,
): Promise<OnChainOracle | null> {
  try {
    const res = await client.getObject({
      id: oracleId,
      options: { showContent: true },
    });

    const content = res.data?.content;
    if (!content || content.dataType !== 'moveObject') return null;

    const fields = (content as { fields: Record<string, unknown> }).fields;
    if (!fields) return null;

    const pricesField = fields.prices as { fields?: Record<string, unknown> } | undefined;
    const sviField = fields.svi as { fields?: Record<string, unknown> } | undefined;
    const priceFields = pricesField?.fields ?? {};
    const sviFields = sviField?.fields ?? {};

    const spotRaw = toNumber(priceFields.spot);
    const forwardRaw = toNumber(priceFields.forward);
    if (!Number.isFinite(spotRaw) || !Number.isFinite(forwardRaw) || forwardRaw <= 0) {
      return null; // can't safely derive a strike without a real forward price
    }

    const settlementOpt = fields.settlement_price;
    let settlementPrice: number | null = null;
    if (Array.isArray(settlementOpt) && settlementOpt.length > 0) {
      settlementPrice = toNumber(settlementOpt[0]) / FLOAT_SCALING;
    } else if (typeof settlementOpt === 'object' && settlementOpt !== null) {
      const opt = settlementOpt as Record<string, unknown>;
      if (opt.vec && Array.isArray(opt.vec) && opt.vec.length > 0) {
        settlementPrice = toNumber(opt.vec[0]) / FLOAT_SCALING;
      }
    }

    return {
      oracleId,
      underlyingAsset: typeof fields.underlying_asset === 'string' ? fields.underlying_asset : 'BTC',
      expiryMs: toNumber(fields.expiry),
      active: fields.active === true,
      spot: spotRaw / FLOAT_SCALING,
      forward: forwardRaw / FLOAT_SCALING,
      svi: {
        a: toNumber(sviFields.a) / FLOAT_SCALING,
        b: toNumber(sviFields.b) / FLOAT_SCALING,
        rho: decodeI64(sviFields.rho) / FLOAT_SCALING,
        m: decodeI64(sviFields.m) / FLOAT_SCALING,
        sigma: toNumber(sviFields.sigma) / FLOAT_SCALING,
      },
      settlementPrice,
      isSettled: settlementPrice !== null,
    };
  } catch {
    return null;
  }
}

/** Converts a human-readable strike (e.g. 50050.5) to the raw on-chain
 * fixed-point integer the contract expects (strike * 1e9). */
export function strikeToOnChainUnits(humanStrike: number): number {
  return Math.round(humanStrike * FLOAT_SCALING);
}