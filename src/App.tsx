import { usePulseFeed } from './hooks/usePulseFeed';
import { useKeeperFeed } from './hooks/useKeeperFeed';
import { TickerTape } from './components/TickerTape';
import { SurfaceViz } from './components/SurfaceViz';
import { RiskGuardianPanel } from './components/RiskGuardianPanel';
import { VaultPanel } from './components/VaultPanel';
import { KeeperFeedPanel } from './components/KeeperFeedPanel';
import { TradePanel } from './components/TradePanel';
import { WalletConnectButton } from './components/WalletConnectButton';
import './styles/pulse.css';

export default function App() {
  const { oracles, vault, slices, violations, risk, isLive, loading } = usePulseFeed();
  const keeperEvents = useKeeperFeed();

  return (
    <div className="pulse-app">
      <TickerTape oracles={oracles} isLive={isLive} />
      <header className="pulse-header">
        <div className="pulse-header__brand">
          <span className="pulse-logo">PULSE</span>
          <span className="pulse-tagline mono">Predict Risk Intelligence Terminal</span>
        </div>
        <div className="pulse-header__right">
          <span className="pulse-header__network mono">
            <span className="pulse-dot pulse-dot--small" /> Sui Testnet
          </span>
          <WalletConnectButton />
        </div>
      </header>
      <main className="pulse-main">
        <section className="pulse-stage">
          <div className="pulse-stage__heading">
            <h1>
              Every strike. Every expiry.
              <br />
              <span className="text-gradient">One surface you can trust.</span>
            </h1>
            <p className="pulse-stage__sub">
              PULSE streams DeepBook Predict's live SVI volatility surface, runs deterministic
              arbitrage and exposure checks before every trade, and keeps settlement honest with
              an always-on redeem keeper.
            </p>
          </div>
          {loading ? (
            <div className="surface-viz surface-viz--loading">Calibrating surface…</div>
          ) : (
            <SurfaceViz slices={slices} violationCount={violations.length} />
          )}
        </section>
        <section className="pulse-grid">
          <div className="pulse-grid__col pulse-grid__col--main">
            <TradePanel oracles={oracles} risk={risk} />
            <KeeperFeedPanel events={keeperEvents} />
          </div>
          <div className="pulse-grid__col pulse-grid__col--side">
            <RiskGuardianPanel risk={risk} />
            <VaultPanel vault={vault} />
          </div>
        </section>
      </main>
      <footer className="pulse-footer mono">
        Built on DeepBook Predict · Sui Overflow 2026 · package 0xf5ea2b…785138
      </footer>
    </div>
  );
}
