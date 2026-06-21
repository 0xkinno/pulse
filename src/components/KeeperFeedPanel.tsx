import type { KeeperEvent } from '../hooks/useKeeperFeed';

function timeAgo(ts: number) {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}

export function KeeperFeedPanel({ events }: { events: KeeperEvent[] }) {
  return (
    <div className="panel keeper-panel">
      <div className="panel__header">
        <span className="panel__title">Settled-Redeem Keeper</span>
        <span className="panel__eyebrow mono">
          <span className="pulse-dot pulse-dot--small" /> running unattended
        </span>
      </div>
      <div className="keeper-panel__list">
        {events.length === 0 && <div className="panel__loading">Watching for settled positions…</div>}
        {events.map((e) => (
          <div className="keeper-row" key={e.id}>
            <div className="keeper-row__main">
              <span className="mono keeper-row__manager">{e.managerShort}</span>
              <span className="keeper-row__oracle">{e.oracleLabel}</span>
            </div>
            <div className="keeper-row__meta">
              <span className="mono keeper-row__payout">+${e.payout.toFixed(2)}</span>
              <span className="mono keeper-row__tip">tip ${e.tip.toFixed(2)}</span>
              <span className="keeper-row__time">{timeAgo(e.timestamp)}</span>
            </div>
            <div className="mono keeper-row__digest">{e.txDigestShort}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
