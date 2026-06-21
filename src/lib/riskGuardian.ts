// Risk Guardian — deterministic, on-chain-mirrored risk scoring.
// Every score here is a pure function of observable state (oracle freshness,
// vault utilization, surface arbitrage scan results, liquidity depth).
// No model inference, no off-chain "trust me" — same philosophy DeepBook Predict's
// own vault exposure check uses, extended to surface a single legible score.

import { RISK_THRESHOLDS } from './constants';
import type { ArbViolation } from './svi';

export type RiskLevel = 'low' | 'moderate' | 'elevated' | 'high';

export interface RiskFactor {
  key: string;
  label: string;
  value: number; // 0-100, contribution score
  status: RiskLevel;
  detail: string;
}

export interface RiskAssessment {
  score: number; // 0-100 composite, higher = riskier
  level: RiskLevel;
  factors: RiskFactor[];
  blockers: string[]; // hard blocks, e.g. "oracle settled" or "exposure cap breached"
}

function levelFromScore(score: number): RiskLevel {
  if (score < 25) return 'low';
  if (score < 50) return 'moderate';
  if (score < 75) return 'elevated';
  return 'high';
}

export interface GuardianInputs {
  oracleAgeSeconds: number;
  vaultUtilizationPct: number; // current liability / vault balance, 0-100
  liquidityDepthScore: number; // 0-1 normalized
  butterflyViolations: ArbViolation[];
  calendarViolations: ArbViolation[];
  oracleStatus: 'inactive' | 'active' | 'pending_settlement' | 'settled';
}

export function assessRisk(inputs: GuardianInputs): RiskAssessment {
  const factors: RiskFactor[] = [];
  const blockers: string[] = [];

  // Factor 1: Oracle freshness — informational only. The real on-chain
  // mint check (assert_live_oracle) cares about lifecycle state, not tick
  // recency, so staleness alone never blocks a real transaction here —
  // it only raises the score and shows a plain-language warning.
  const stalenessRatio = inputs.oracleAgeSeconds / RISK_THRESHOLDS.maxOracleStalenessSec;
  const freshnessScore = Math.min(100, Math.max(0, stalenessRatio * 100));
  const staleHours = inputs.oracleAgeSeconds / 3600;
  factors.push({
    key: 'freshness',
    label: 'Oracle freshness',
    value: freshnessScore,
    status: levelFromScore(freshnessScore),
    detail:
      staleHours >= 1
        ? `Last update ${staleHours.toFixed(1)}h ago — testnet oracles can go quiet for hours; this does not block minting on-chain`
        : `Last update ${Math.round(inputs.oracleAgeSeconds)}s ago`,
  });

  // Factor 2: Vault utilization
  const utilScore = Math.min(
    100,
    (inputs.vaultUtilizationPct / RISK_THRESHOLDS.maxVaultUtilizationPct) * 100,
  );
  factors.push({
    key: 'utilization',
    label: 'Vault utilization',
    value: utilScore,
    status: levelFromScore(utilScore),
    detail: `${inputs.vaultUtilizationPct.toFixed(1)}% of max exposure used`,
  });
  if (inputs.vaultUtilizationPct >= RISK_THRESHOLDS.maxVaultUtilizationPct) {
    blockers.push('Vault exposure cap reached — new mints will revert on-chain');
  }

  // Factor 3: Liquidity depth
  const liquidityScore = Math.min(
    100,
    Math.max(0, (1 - inputs.liquidityDepthScore / RISK_THRESHOLDS.minLiquidityHealthy) * 100),
  );
  factors.push({
    key: 'liquidity',
    label: 'Liquidity depth',
    value: liquidityScore,
    status: levelFromScore(liquidityScore),
    detail: `Depth score ${inputs.liquidityDepthScore.toFixed(2)} (healthy ≥ ${RISK_THRESHOLDS.minLiquidityHealthy})`,
  });

  // Factor 4: Surface arbitrage integrity
  const totalViolations = inputs.butterflyViolations.length + inputs.calendarViolations.length;
  const worstSeverity = [...inputs.butterflyViolations, ...inputs.calendarViolations].reduce(
    (max, v) => Math.max(max, v.severityBps),
    0,
  );
  const arbScore = Math.min(100, totalViolations * 8 + worstSeverity * 1.5);
  factors.push({
    key: 'arb_integrity',
    label: 'Surface arb-free integrity',
    value: arbScore,
    status: levelFromScore(arbScore),
    detail:
      totalViolations === 0
        ? 'No butterfly or calendar violations detected'
        : `${totalViolations} violation(s), worst ${worstSeverity.toFixed(1)} bps`,
  });

  // Factor 5: Oracle lifecycle status
  let lifecycleScore = 0;
  if (inputs.oracleStatus === 'settled') {
    lifecycleScore = 100;
    blockers.push('Oracle settled — mints disabled, redeem only');
  } else if (inputs.oracleStatus === 'pending_settlement') {
    lifecycleScore = 60;
  } else if (inputs.oracleStatus === 'inactive') {
    lifecycleScore = 100;
    blockers.push('Oracle inactive — trading not yet available');
  }
  factors.push({
    key: 'lifecycle',
    label: 'Oracle lifecycle',
    value: lifecycleScore,
    status: levelFromScore(lifecycleScore),
    detail: `Status: ${inputs.oracleStatus.replace('_', ' ')}`,
  });

  const weights: Record<string, number> = {
    freshness: 0.2,
    utilization: 0.25,
    liquidity: 0.2,
    arb_integrity: 0.2,
    lifecycle: 0.15,
  };

  const score = factors.reduce((sum, f) => sum + f.value * (weights[f.key] ?? 0), 0);

  return {
    score: Math.round(score),
    level: levelFromScore(score),
    factors,
    blockers,
  };
}