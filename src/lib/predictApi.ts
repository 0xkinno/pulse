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

// ---- Deterministic simulated feed (used whenever the live testnet server is unreachable) ----
// This is clearly labeled as simulated everywhere it surfaces in the UI — see `live` flag.

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

export async function fetchOracles(): Promise<{ oracles: OracleSummary[]; live: boolean }> {
  const { data, live } = await safeFetch<{ oracles?: OracleSummary[] } | OracleSummary[]>(
    `/predicts/${PREDICT_OBJECT_ID}/oracles`,
    simulatedOracles(),
  );
  if (!live) return { oracles: data as OracleSummary[], live: false };
  const normalized = Array.isArray(data) ? data : (data as { oracles?: OracleSummary[] }).oracles ?? [];
  return { oracles: normalized.length ? normalized : simulatedOracles(), live: normalized.length > 0 };
}

export async function fetchVaultSummary(): Promise<{ vault: VaultSummary; live: boolean }> {
  const { data, live } = await safeFetch<VaultSummary>(
    `/predicts/${PREDICT_OBJECT_ID}/vault/summary`,
    simulatedVault(),
  );
  return { vault: data, live };
}

export async function fetchServerStatus(): Promise<{ ok: boolean; live: boolean }> {
  const { live } = await safeFetch<{ ok: boolean }>('/status', { ok: false });
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
