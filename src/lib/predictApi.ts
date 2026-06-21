import { PREDICT_OBJECT_ID, PREDICT_SERVER_URL } from './constants';
import type { SurfaceSlice } from './svi';

// ---- Server response shapes (best-effort typing against documented endpoints) ----

export interface OracleSummary {
  oracleId: string;
  underlying: string;
  expiryLabel: string;
  expirySeconds: number;
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

/**
 * Fetches a path against the live server. Hardened against every failure mode
 * that previously caused the surface to get stuck on an empty/loading state:
 *   - network error / CORS block        -> caught, falls back
 *   - timeout                            -> aborted, falls back
 *   - non-2xx response                   -> caught, falls back
 *   - malformed / unexpected JSON shape  -> caught by caller's normalizer, falls back
 *   - response resolves but is empty     -> caller's normalizer falls back
 * This function NEVER throws and NEVER hangs past `timeoutMs`.
 */
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

// ---- Deterministic simulated feed (used whenever the live testnet server is unreachable,
// returns an unexpected shape, or returns an empty result) ----
// This is clearly labeled as simulated everywhere it surfaces in the UI — see the `live` flag.

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

/**
 * Pulls every plausible shape the indexed server might return for the oracle list
 * out of an unknown JSON payload. The live testnet server's exact response
 * envelope isn't pinned down (docs show the endpoint, not a strict schema), so this
 * normalizer is deliberately permissive rather than assuming one shape and silently
 * returning an empty array — which was the root cause of the surface getting stuck
 * on "0 expiries" indefinitely.
 */
function extractOracleArray(payload: unknown): OracleSummary[] {
  if (Array.isArray(payload)) return payload as OracleSummary[];
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['oracles', 'data', 'items', 'results']) {
      const candidate = obj[key];
      if (Array.isArray(candidate)) return candidate as OracleSummary[];
    }
  }
  return [];
}

export async function fetchOracles(): Promise<{ oracles: OracleSummary[]; live: boolean }> {
  const { data, live } = await safeFetch<unknown>(
    `/predicts/${PREDICT_OBJECT_ID}/oracles`,
    null,
  );

  if (live) {
    const normalized = extractOracleArray(data);
    if (normalized.length > 0) {
      return { oracles: normalized, live: true };
    }
    // Live request succeeded but returned no usable oracle data (empty array,
    // unexpected envelope, etc.) — fall back to the simulated feed rather than
    // rendering an empty surface forever.
  }

  return { oracles: simulatedOracles(), live: false };
}

export async function fetchVaultSummary(): Promise<{ vault: VaultSummary; live: boolean }> {
  const { data, live } = await safeFetch<Partial<VaultSummary> | null>(
    `/predicts/${PREDICT_OBJECT_ID}/vault/summary`,
    null,
  );

  if (live && data && typeof data.vaultBalance === 'number') {
    return { vault: data as VaultSummary, live: true };
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