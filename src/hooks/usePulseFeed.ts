import { useEffect, useRef, useState } from 'react';
import {
  advanceSimClock,
  fetchOracles,
  fetchServerStatus,
  fetchVaultSummary,
  oraclesToSurfaceSlices,
  type OracleSummary,
  type VaultSummary,
} from '../lib/predictApi';
import {
  defaultKGrid,
  scanButterflyViolations,
  scanCalendarViolations,
  strikeToLogMoneyness,
  type ArbViolation,
  type SurfaceSlice,
} from '../lib/svi';
import { assessRisk, type RiskAssessment } from '../lib/riskGuardian';
import { RISK_THRESHOLDS } from '../lib/constants';

export interface PulseState {
  oracles: OracleSummary[];
  vault: VaultSummary | null;
  slices: SurfaceSlice[];
  violations: ArbViolation[];
  risk: RiskAssessment | null;
  isLive: boolean;
  lastTickAt: number;
  loading: boolean;
}

const POLL_INTERVAL_MS = 4000;
// Absolute ceiling on how long the UI is allowed to show a loading state.
// fetchOracles/fetchVaultSummary already resolve within their own timeouts and
// always return usable data (real or simulated) — this watchdog exists purely
// as a second line of defense so a future regression can never reproduce the
// "stuck on Calibrating forever" bug again.
const WATCHDOG_MS = 6000;

export function usePulseFeed() {
  const [state, setState] = useState<PulseState>({
    oracles: [],
    vault: null,
    slices: [],
    violations: [],
    risk: null,
    isLive: false,
    lastTickAt: Date.now(),
    loading: true,
  });

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      advanceSimClock();

      watchdog = setTimeout(() => {
        if (!mountedRef.current) return;
        // If a tick somehow never resolves, force loading off so the UI always
        // shows *something* rather than spinning indefinitely.
        setState((prev) => (prev.loading ? { ...prev, loading: false } : prev));
      }, WATCHDOG_MS);

      try {
        const [oracleRes, vaultRes, statusRes] = await Promise.all([
          fetchOracles(),
          fetchVaultSummary(),
          fetchServerStatus(),
        ]);

        if (!mountedRef.current) return;

        const slices = oraclesToSurfaceSlices(oracleRes.oracles);
        const kGrid = defaultKGrid();

        const butterflyViolations = slices.flatMap((s) =>
          scanButterflyViolations(s, kGrid, RISK_THRESHOLDS.butterflyArbToleranceBps),
        );
        const calendarViolations = scanCalendarViolations(
          slices,
          kGrid,
          RISK_THRESHOLDS.calendarArbToleranceBps,
        );

        const nearestOracle = oracleRes.oracles[0];
        const oracleAge = nearestOracle ? (Date.now() - nearestOracle.lastUpdateMs) / 1000 : 999;

        const risk = assessRisk({
          oracleAgeSeconds: Math.max(0, oracleAge),
          vaultUtilizationPct: vaultRes.vault.utilizationPct,
          liquidityDepthScore: Math.max(
            0,
            Math.min(1, 1 - vaultRes.vault.utilizationPct / 100 + 0.15),
          ),
          butterflyViolations,
          calendarViolations,
          oracleStatus: nearestOracle?.status ?? 'inactive',
        });

        setState({
          oracles: oracleRes.oracles,
          vault: vaultRes.vault,
          slices,
          violations: [...butterflyViolations, ...calendarViolations],
          risk,
          isLive: oracleRes.live && vaultRes.live && statusRes.live,
          lastTickAt: Date.now(),
          loading: false,
        });
      } catch {
        // Should be unreachable (fetchOracles/fetchVaultSummary never throw),
        // but if anything upstream changes and starts throwing, never leave
        // the UI stuck — fall through to false so the next tick can recover.
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, loading: false }));
        }
      } finally {
        clearTimeout(watchdog);
      }
    }

    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
      clearTimeout(watchdog);
    };
  }, []);

  return state;
}

export function logMoneynessGridForOracle(oracle: OracleSummary, strikes: number[]): number[] {
  return strikes.map((k) => strikeToLogMoneyness(k, oracle.forward));
}