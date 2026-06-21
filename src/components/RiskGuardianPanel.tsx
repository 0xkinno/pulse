import type { RiskAssessment } from '../lib/riskGuardian';

const LEVEL_COLOR: Record<string, string> = {
  low: 'var(--pulse-cyan)',
  moderate: '#8fe0ff',
  elevated: 'var(--pulse-amber)',
  high: 'var(--pulse-red)',
};

export function RiskGuardianPanel({ risk }: { risk: RiskAssessment | null }) {
  if (!risk) {
    return (
      <div className="panel risk-panel">
        <div className="panel__header">
          <span className="panel__title">Risk Guardian</span>
        </div>
        <div className="panel__loading">Calibrating…</div>
      </div>
    );
  }

  const color = LEVEL_COLOR[risk.level];

  return (
    <div className="panel risk-panel">
      <div className="panel__header">
        <span className="panel__title">Risk Guardian</span>
        <span className="panel__eyebrow mono">deterministic · on-chain mirrored</span>
      </div>
      <div className="risk-panel__score-row">
        <div className="risk-panel__gauge" style={{ '--gauge-color': color } as React.CSSProperties}>
          <svg viewBox="0 0 120 70" width="120" height="70">
            <path
              d="M 10 65 A 50 50 0 0 1 110 65"
              fill="none"
              stroke="rgba(93,173,255,0.12)"
              strokeWidth="9"
              strokeLinecap="round"
            />
            <path
              d="M 10 65 A 50 50 0 0 1 110 65"
              fill="none"
              stroke={color}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${(risk.score / 100) * 157} 157`}
              style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke-dasharray 0.6s ease' }}
            />
          </svg>
          <div className="risk-panel__score-num mono" style={{ color }}>
            {risk.score}
          </div>
        </div>
        <div className="risk-panel__level-info">
          <div className="risk-panel__level-label" style={{ color }}>
            {risk.level.toUpperCase()} RISK
          </div>
          <div className="risk-panel__level-sub">
            {risk.blockers.length > 0
              ? `${risk.blockers.length} blocker${risk.blockers.length > 1 ? 's' : ''} active`
              : 'No active blockers'}
          </div>
        </div>
      </div>
      <div className="risk-panel__factors">
        {risk.factors.map((f) => (
          <div className="risk-factor" key={f.key}>
            <div className="risk-factor__top">
              <span className="risk-factor__label">{f.label}</span>
              <span className="risk-factor__value mono" style={{ color: LEVEL_COLOR[f.status] }}>
                {Math.round(f.value)}
              </span>
            </div>
            <div className="risk-factor__bar">
              <div
                className="risk-factor__bar-fill"
                style={{ width: `${Math.min(100, f.value)}%`, background: LEVEL_COLOR[f.status] }}
              />
            </div>
            <div className="risk-factor__detail">{f.detail}</div>
          </div>
        ))}
      </div>
      {risk.blockers.length > 0 && (
        <div className="risk-panel__blockers">
          {risk.blockers.map((b, i) => (
            <div key={i} className="risk-blocker">
              <span className="risk-blocker__dot" />
              {b}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
