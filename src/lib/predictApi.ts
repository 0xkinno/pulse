import { PREDICT_OBJECT_ID, PREDICT_SERVER_URL } from './constants';
import type { SurfaceSlice } from './svi';

// ---- Server response shapes ----
//
// The real /predicts/:id/oracles endpoint returns MANY oracle records — most
// of them already expired, settled, or otherwise not useful to show on a
// live dashboard. The previous version of this file rendered every record it
// was handed, which is why the UI filled up with dozens of broken-looking
// "BTC--" chips and the arbitrage scanner choked comparing near-duplicate
// expired entries against each other.
//
// This version is deliberately strict:
//   - Only oracles that are ACTIVE and expire in the FUTURE are kept.
//   - Duplicate underlying+expiry combinations are collapsed to one.
//   - The result is capped to a small, sane number of expiries (max 6),
//     closest-expiring first, so the UI always shows a short, clean list
//     instead of however many hundred records the server happens to return.

export interface OracleSummary {
  oracleId: string;
  underlying: string;
  expiryLabel: string;
  expirySeconds: number;
  /** The original absolute expiry timestamp (ms since epoch) exactly as
   * stored on the real OracleSVI object. MUST be used (not expirySeconds,
   * which is a recalculated countdown that changes every poll tick) when
   * building a MarketKey for any real transaction — oracle_config's
   * assert_key_matches compares against this exact on-chain field. */
  expiryAbsoluteMs: number;
  spot: number;
  forward: number;
  status: 'inactive' | 'active' | 'pending_settlement' | 'settled';
  lastUpdateMs: number;
  svi: { a: number; b: number; rho: number; m: number; sigma: number };
}

export interface VaultSummary {
  vaultBalance: number;
  totalLiability: number;
  maxPayout: number;
  utilizationPct: number;
  plpSupply: number;
  plpSharePrice: number;
}

const MAX_ORACLES_SHOWN = 6;

async function safeFetch<T>(
  path: string,
  fallback: T,
  timeoutMs = 4500,
): Promise<{ data: T; live: boolean }> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${PREDICT_SERVER_URL}${path}`, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as T;
    return { data, live: true };
  } catch {
    return { data: fallback, live: false };
  }
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function asNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function expiryLabelFromSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

const FIXED_POINT_SCALE = 1_000_000_000; // Predict protocol's strike/tick_size price-grid scale
const DUSDC_SCALE = 1_000_000; // dUSDC coin decimals — CONFIRMED 1e6, a SEPARATE number from the above

/**
 * Normalizes one raw oracle record. Returns null for anything that isn't a
 * genuinely live, future-expiring, sane-looking oracle — this is the strict
 * filter that was missing before. A record is rejected (returns null) if:
 *   - it has no oracle_id
 *   - its expiry is missing, zero, or already in the past
 *   - the server explicitly marks it settled/inactive
 */
function normalizeOracle(raw: unknown, indexHint: number): OracleSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const oracleId = asString(pick(o, ['oracle_id', 'oracleId', 'id']), '');
  if (!oracleId) return null;

  const statusRaw = asString(pick(o, ['status']), 'active').toLowerCase();
  if (statusRaw === 'settled' || statusRaw === 'inactive') return null;

  const rawExpiry = asNumber(pick(o, ['expiry', 'expiry_ms', 'expiryMs']), 0);
  if (rawExpiry <= 0) return null;

  const expirySeconds = Math.round((rawExpiry - Date.now()) / 1000);
  if (expirySeconds <= 0) return null; // already expired — do not show

  const underlying = asString(
    pick(o, ['underlying_asset', 'underlying', 'asset', 'symbol']),
    'BTC',
  );

  const minStrikeRaw = asNumber(pick(o, ['min_strike', 'minStrike']), 0);
  const tickSizeRaw = asNumber(pick(o, ['tick_size', 'tickSize']), 0);

  const spotFromServer = pick(o, ['spot', 'spot_price', 'spotPrice', 'mark_price']);
  const forwardFromServer = pick(o, ['forward', 'forward_price', 'forwardPrice']);

  const derivedSpot =
    minStrikeRaw > 0
      ? minStrikeRaw / FIXED_POINT_SCALE + (tickSizeRaw / FIXED_POINT_SCALE) * 50
      : NaN;

  const fallbackSpot = 68000 + Math.sin(indexHint) * 200;
  const spot = asNumber(spotFromServer, Number.isFinite(derivedSpot) ? derivedSpot : fallbackSpot);
  if (!Number.isFinite(spot) || spot <= 0) return null; // refuse nonsense prices

  const forward = asNumber(forwardFromServer, spot * 1.0001);

  const sviRaw = pick(o, ['svi', 'svi_params', 'sviParams']);
  const sviObj = sviRaw && typeof sviRaw === 'object' ? (sviRaw as Record<string, unknown>) : {};
  const sigmaBase = 0.08 + (indexHint % 4) * 0.03;
  const svi = {
    a: asNumber(pick(sviObj, ['a']), 0.02 + sigmaBase * 0.05),
    b: asNumber(pick(sviObj, ['b']), 0.18 + sigmaBase * 0.3),
    rho: asNumber(pick(sviObj, ['rho']), -0.35),
    m: asNumber(pick(sviObj, ['m']), 0),
    sigma: asNumber(pick(sviObj, ['sigma']), 0.25 + sigmaBase * 0.4),
  };

  const activatedAt = asNumber(pick(o, ['activated_at', 'activatedAt', 'updated_at']), 0);

  return {
    oracleId,
    underlying,
    expiryLabel: expiryLabelFromSeconds(expirySeconds),
    expirySeconds,
    expiryAbsoluteMs: rawExpiry,
    spot,
    forward,
    status: 'active',
    lastUpdateMs: activatedAt > 0 ? activatedAt : Date.now(),
    svi,
  };
}

/**
 * Takes a raw, possibly huge/messy list of normalized oracles and reduces it
 * to a short, clean set: dedupe by underlying+expiry-bucket, sort soonest
 * first, cap to MAX_ORACLES_SHOWN.
 */
function curateOracles(oracles: OracleSummary[]): OracleSummary[] {
  const seen = new Set<string>();
  const deduped: OracleSummary[] = [];

  for (const o of oracles.sort((a, b) => a.expirySeconds - b.expirySeconds)) {
    const bucketKey = `${o.underlying}:${o.expiryLabel}`;
    if (seen.has(bucketKey)) continue;
    seen.add(bucketKey);
    deduped.push(o);
    if (deduped.length >= MAX_ORACLES_SHOWN) break;
  }

  return deduped;
}

// ---- Deterministic simulated feed (used only when the live server is fully
// unreachable, or returns nothing usable after the strict filter above) ----

let simTick = 0;

function simulatedOracles(): OracleSummary[] {
  const t = simTick;
  const baseSpot = 68420 + Math.sin(t / 7) * 340 + Math.sin(t / 23) * 120;
  const expiries: Array<{ label: string; seconds: number; sigmaBase: number }> = [
    { label: '15m', seconds: 900, sigmaBase: 0.085 },
    { label: '1h', seconds: 3600, sigmaBase: 0.11 },
    { label: '4h', seconds: 14400, sigmaBase: 0.145 },
    { label: '1d', seconds: 86400, sigmaBase: 0.19 },
  ];

  return expiries.map((e, i) => ({
    oracleId: `sim-oracle-${i}`,
    underlying: 'BTC',
    expiryLabel: e.label,
    expirySeconds: e.seconds,
    expiryAbsoluteMs: Date.now() + e.seconds * 1000,
    spot: baseSpot,
    forward: baseSpot * (1 + 0.0001 * (i + 1)),
    status: 'active' as const,
    lastUpdateMs: Date.now() - (t % 8) * 1000,
    svi: {
      a: 0.02 + e.sigmaBase * 0.05 + Math.sin(t / 11 + i) * 0.002,
      b: 0.18 + e.sigmaBase * 0.3,
      rho: -0.35 + Math.sin(t / 17 + i) * 0.05,
      m: 0.0 + Math.sin(t / 29) * 0.01,
      sigma: 0.25 + e.sigmaBase * 0.4,
    },
  }));
}

function simulatedVault(): VaultSummary {
  const t = simTick;
  const balance = 482_000 + Math.sin(t / 13) * 9000;
  const liability = balance * (0.42 + Math.sin(t / 19) * 0.08);
  return {
    vaultBalance: balance,
    totalLiability: Math.max(liability, 0),
    maxPayout: balance * 0.85,
    utilizationPct: (liability / balance) * 100,
    plpSupply: 401_200,
    plpSharePrice: balance / 401_200,
  };
}

export function advanceSimClock() {
  simTick += 1;
}

function extractRawArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['oracles', 'data', 'items', 'results']) {
      const candidate = obj[key];
      if (Array.isArray(candidate)) return candidate;
    }
  }
  return [];
}

export async function fetchOracles(): Promise<{ oracles: OracleSummary[]; live: boolean }> {
  const { data, live } = await safeFetch<unknown>(`/predicts/${PREDICT_OBJECT_ID}/oracles`, null);

  if (live) {
    const rawArray = extractRawArray(data);
    const normalized = rawArray
      .map((raw, i) => normalizeOracle(raw, i))
      .filter((o): o is OracleSummary => o !== null);

    const curated = curateOracles(normalized);

    if (curated.length > 0) {
      return { oracles: curated, live: true };
    }
    // Server responded, but nothing passed the strict live/future/sane filter
    // — fall through to the simulated feed rather than show an empty or
    // garbage-filled surface.
  }

  return { oracles: simulatedOracles(), live: false };
}

export async function fetchVaultSummary(): Promise<{ vault: VaultSummary; live: boolean }> {
  const { data, live } = await safeFetch<unknown>(
    `/predicts/${PREDICT_OBJECT_ID}/vault/summary`,
    null,
  );

  if (live && data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    // The server returns raw on-chain integers, same 1e6 fixed-point scale
    // confirmed for dUSDC elsewhere in this app (a Suiscan capture showed a
    // "1,000 DUSDC" transfer move exactly 1,000,000,000 base units). Without
    // this division, a real ~$1M vault was displaying as ~$1 trillion. This
    // is DUSDC_SCALE (1e6), deliberately distinct from FIXED_POINT_SCALE
    // (1e9) used above for the protocol's own strike/tick_size price grid —
    // conflating those two was a real, previously-shipped bug.
    const rawVaultBalance = asNumber(pick(o, ['vault_balance', 'vaultBalance', 'balance']), NaN);
    if (Number.isFinite(rawVaultBalance) && rawVaultBalance > 0) {
      const vaultBalance = rawVaultBalance / DUSDC_SCALE;
      const totalLiability =
        asNumber(pick(o, ['total_liability', 'totalLiability', 'liability']), 0) / DUSDC_SCALE;
      const maxPayout =
        asNumber(pick(o, ['max_payout', 'maxPayout']), rawVaultBalance * 0.85) / DUSDC_SCALE;
      const plpSupply = asNumber(pick(o, ['plp_supply', 'plpSupply']), 0) / DUSDC_SCALE;
      const plpSharePrice = asNumber(
        pick(o, ['plp_share_price', 'plpSharePrice', 'share_price']),
        plpSupply > 0 ? vaultBalance / plpSupply : 1,
      );
      const utilizationPct = asNumber(
        pick(o, ['utilization_pct', 'utilizationPct']),
        vaultBalance > 0 ? (totalLiability / vaultBalance) * 100 : 0,
      );
      return {
        vault: { vaultBalance, totalLiability, maxPayout, utilizationPct, plpSupply, plpSharePrice },
        live: true,
      };
    }
  }

  return { vault: simulatedVault(), live: false };
}

export async function fetchServerStatus(): Promise<{ ok: boolean; live: boolean }> {
  const { live } = await safeFetch<{ ok: boolean } | null>('/status', null);
  return { ok: live, live };
}

export function oraclesToSurfaceSlices(oracles: OracleSummary[]): SurfaceSlice[] {
  return oracles.map((o) => ({
    expiryLabel: o.expiryLabel,
    expirySeconds: o.expirySeconds,
    forward: o.forward,
    params: o.svi,
  }));
}