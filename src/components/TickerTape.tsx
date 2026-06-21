import type { OracleSummary } from '../lib/predictApi';

export function TickerTape({ oracles, isLive }: { oracles: OracleSummary[]; isLive: boolean }) {
  return (
    <div className="ticker-tape">
      <div className="ticker-tape__track">
        {oracles.map((o) => (
          <span key={o.oracleId} className="ticker-tape__item">
            <span className="ticker-tape__label">
              {o.underlying}/{o.expiryLabel}
            </span>
            <span className="mono ticker-tape__price">${o.spot.toFixed(0)}</span>
          </span>
        ))}
        <span className="ticker-tape__item">
          <span className={`ticker-tape__live ${isLive ? '' : 'ticker-tape__live--sim'}`}>
            {isLive ? 'LIVE · TESTNET' : 'SIMULATED FEED'}
          </span>
        </span>
      </div>
    </div>
  );
}
