import { useState } from 'react';
import { usePulseFeed } from './hooks/usePulseFeed';
import { useSurfaceHistory } from './hooks/useSurfaceHistory';
import { useKeeperFeed } from './hooks/useKeeperFeed';
import { LandingPage } from './components/LandingPage';
import { Navbar, type Tab } from './components/Navbar';
import { TickerTape } from './components/TickerTape';
import { SurfaceViz } from './components/SurfaceViz';
import { RiskGuardianPanel } from './components/RiskGuardianPanel';
import { VaultPanel } from './components/VaultPanel';
import { KeeperFeedPanel } from './components/KeeperFeedPanel';
import { TradePanel } from './components/TradePanel';
import { RedeemPanel } from './components/RedeemPanel';
import { SupplyLiquidityPanel } from './components/SupplyLiquidityPanel';
import './styles/pulse.css';

export default function App() {
  const [showDashboard, setShowDashboard] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('surface');

  const { oracles, vault, slices, violations, risk, isLive, loading } = usePulseFeed();
  const surfaceHistory = useSurfaceHistory(slices);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null); // null = live, follow latest tick
  const keeperEvents = useKeeperFeed();

  if (!showDashboard) {
    return <LandingPage onEnter={() => setShowDashboard(true)} />;
  }

  return (
    <div className="terminal-shell">
      <TickerTape oracles={oracles} isLive={isLive} />

      <Navbar
        activeTab={activeTab}
        onTab={setActiveTab}
        isLive={isLive}
        onHome={() => setShowDashboard(false)}
      />

      <main className="terminal-main">

        {activeTab === 'surface' && (
          <div className="tab-view">
            <div className="tab-view__header">
              <div>
                <h2 className="tab-view__title">Live SVI Volatility Surface</h2>
                <p className="tab-view__sub mono">
                  {oracles[0]?.underlying ?? 'BTC'} · {oracles.length} expiries · butterfly + calendar arb scan active
                </p>
              </div>
              {violations.length > 0 && (
                <div className="tab-view__alert">
                  {violations.length} arb violation{violations.length > 1 ? 's' : ''} detected
                </div>
              )}
            </div>
            {loading ? (
              <div className="surface-viz surface-viz--loading">Calibrating surface...</div>
            ) : (
              <SurfaceViz
                slices={scrubIndex !== null && surfaceHistory[scrubIndex] ? surfaceHistory[scrubIndex].slices : slices}
                violationCount={violations.length}
              />
            )}
            <div className="surface-scrubber">
              <div className="surface-scrubber__top">
                <span className="surface-scrubber__label mono">
                  {scrubIndex === null
                    ? 'Live'
                    : surfaceHistory[scrubIndex]
                      ? new Date(surfaceHistory[scrubIndex].timestampMs).toLocaleTimeString()
                      : '—'}
                </span>
                {scrubIndex !== null && (
                  <button className="surface-scrubber__live-btn" onClick={() => setScrubIndex(null)}>
                    Jump to live
                  </button>
                )}
              </div>
              <input
                type="range"
                className="surface-scrubber__slider"
                min={0}
                max={Math.max(0, surfaceHistory.length - 1)}
                value={scrubIndex === null ? Math.max(0, surfaceHistory.length - 1) : scrubIndex}
                onChange={(e) => setScrubIndex(Number(e.target.value))}
                disabled={surfaceHistory.length < 2}
              />
              <div className="surface-scrubber__hint mono">
                {surfaceHistory.length < 2
                  ? 'Recording surface ticks — replay fills in as the page stays open'
                  : `Replaying this session's last ${surfaceHistory.length} ticks (~${Math.round((surfaceHistory.length * 4) / 60)} min)`}
              </div>
            </div>
            <div className="surface-oracle-grid">
              {oracles.map((o) => (
                <div key={o.oracleId} className="oracle-card">
                  <div className="oracle-card__label mono">{o.underlying}/{o.expiryLabel}</div>
                  <div className="oracle-card__spot mono">${o.spot.toFixed(2)}</div>
                  <div className="oracle-card__fwd mono">fwd ${o.forward.toFixed(2)}</div>
                  <div className={`oracle-card__status${o.status === 'active' ? ' oracle-card__status--active' : ''}`}>
                    {o.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'trade' && (
          <div className="tab-view">
            <div className="tab-view__header">
              <div>
                <h2 className="tab-view__title">Mint / Redeem Position</h2>
                <p className="tab-view__sub mono">
                  Binary positions gated by Risk Guardian · dUSDC quote asset
                </p>
              </div>
            </div>
            <div className="tab-view__trade-layout">
              <TradePanel oracles={oracles} risk={risk} />
              <RiskGuardianPanel risk={risk} />
            </div>
            <div className="tab-view__trade-layout" style={{ marginTop: 22 }}>
              <RedeemPanel />
            </div>
          </div>
        )}

        {activeTab === 'risk' && (
          <div className="tab-view">
            <div className="tab-view__header">
              <div>
                <h2 className="tab-view__title">Risk Guardian</h2>
                <p className="tab-view__sub mono">Deterministic · 5-factor · on-chain mirrored</p>
              </div>
            </div>
            <div className="tab-view__risk-layout">
              <RiskGuardianPanel risk={risk} />
              <div className="panel">
                <div className="panel__header">
                  <span className="panel__title">How scoring works</span>
                </div>
                <div className="risk-explainer__rows">
                  {[
                    { name: 'Oracle freshness', weight: '25%', desc: 'How recently the oracle SVI params were updated. Stale beyond 90s raises score; beyond 180s triggers a hard block.' },
                    { name: 'Vault utilization', weight: '20%', desc: 'Fraction of the vault max exposure used. Hard block at 78% — same cap the protocol enforces on-chain.' },
                    { name: 'Liquidity depth', weight: '20%', desc: 'Normalized vault depth score. Low depth means the vault may struggle to cover new payout obligations.' },
                    { name: 'Surface arb integrity', weight: '20%', desc: 'Butterfly convexity and calendar monotonicity checks run across the full k-grid each tick.' },
                    { name: 'Oracle lifecycle', weight: '15%', desc: 'Active oracles are safe. Pending-settlement raises score. Settled or inactive oracles hard-block mints.' },
                  ].map((row) => (
                    <div key={row.name} className="risk-explainer__row">
                      <div className="risk-explainer__row-top">
                        <span className="risk-explainer__row-name">{row.name}</span>
                        <span className="mono risk-explainer__row-weight">{row.weight}</span>
                      </div>
                      <p className="risk-explainer__row-desc">{row.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'vault' && (
          <div className="tab-view">
            <div className="tab-view__header">
              <div>
                <h2 className="tab-view__title">PLP Vault</h2>
                <p className="tab-view__sub mono">Liquidity provider vault · dUSDC quote · PLP share token</p>
              </div>
            </div>
            <div className="tab-view__vault-layout">
              <VaultPanel vault={vault} />
              <div className="panel">
                <div className="panel__header">
                  <span className="panel__title">Liquidity Provider Flow</span>
                </div>
                <div className="vault-info__steps">
                  {[
                    { step: '01', title: 'Supply dUSDC', desc: 'Call predict::supply with your dUSDC. The vault mints you PLP shares representing a proportional claim on vault value.' },
                    { step: '02', title: 'Earn from spreads', desc: 'The vault collects spread between position minting prices and expected payouts. Your PLP share price rises as traders pay premiums.' },
                    { step: '03', title: 'Withdraw anytime', desc: 'Burn PLP to withdraw. Subject to current vault value, max payout coverage, and the withdrawal limiter to protect solvency.' },
                  ].map((s) => (
                    <div key={s.step} className="vault-info__step">
                      <div className="vault-info__step-num mono">{s.step}</div>
                      <div>
                        <div className="vault-info__step-title">{s.title}</div>
                        <div className="vault-info__step-desc">{s.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="tab-view__vault-layout" style={{ marginTop: 22 }}>
              <SupplyLiquidityPanel />
            </div>
          </div>
        )}

        {activeTab === 'keeper' && (
          <div className="tab-view">
            <div className="tab-view__header">
              <div>
                <h2 className="tab-view__title">Settled-Redeem Keeper</h2>
                <p className="tab-view__sub mono">Watches oracle settlements · claims payouts · earns tips · runs unattended</p>
              </div>
              <div className="tab-view__live-badge mono">
                <span className="pulse-dot pulse-dot--small" />
                running
              </div>
            </div>
            <div className="tab-view__keeper-layout">
              <KeeperFeedPanel events={keeperEvents} />
              <div className="panel">
                <div className="panel__header">
                  <span className="panel__title">How the keeper works</span>
                </div>
                <div className="vault-info__steps">
                  {[
                    { step: '01', title: 'Watch OracleSettled events', desc: 'The keeper subscribes to oracle::OracleSettled on-chain. When an oracle settles, it queries all open positions on that oracle.' },
                    { step: '02', title: 'Find un-redeemed positions', desc: 'Any PredictManager holding a binary position on the settled oracle is eligible. The keeper scans the manager list from the public server.' },
                    { step: '03', title: 'Redeem and collect tip', desc: 'The keeper builds a PTB calling predict::redeem on behalf of each eligible manager, collecting a small tip as incentive for the service.' },
                  ].map((s) => (
                    <div key={s.step} className="vault-info__step">
                      <div className="vault-info__step-num mono">{s.step}</div>
                      <div>
                        <div className="vault-info__step-title">{s.title}</div>
                        <div className="vault-info__step-desc">{s.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      <footer className="pulse-footer mono">
        Built on DeepBook Predict · Sui Overflow 2026 · package 0xf5ea2b...785138
      </footer>
    </div>
  );
}