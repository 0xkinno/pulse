interface LandingPageProps {
    onEnter: () => void;
  }
  
  export function LandingPage({ onEnter }: LandingPageProps) {
    return (
      <div className="landing">
        <div className="landing__bg-grid" />
        <div className="landing__bg-glow" />
  
        <nav className="landing__nav">
          <span className="pulse-logo">PULSE</span>
          <div className="landing__nav-right">
            <span className="mono" style={{ fontSize: 12, color: 'var(--pulse-text-tertiary)' }}>
              DeepBook Predict · Sui Overflow 2026
            </span>
            <button className="wallet-btn" onClick={onEnter}>
              Launch Terminal →
            </button>
          </div>
        </nav>
  
        <div className="landing__hero">
          <div className="landing__badge mono">
            <span className="pulse-dot" style={{ marginRight: 8 }} />
            Live on Sui Testnet
          </div>
          <h1 className="landing__h1">
            The Risk-Aware<br />
            <span className="text-gradient">Prediction Terminal</span><br />
            for DeepBook.
          </h1>
          <p className="landing__sub">
            PULSE renders DeepBook Predict live SVI volatility surface,
            runs deterministic arbitrage and exposure checks before every mint,
            and keeps settlement honest with an always-on redeem keeper.
          </p>
          <div className="landing__cta-row">
            <button className="landing__cta-primary" onClick={onEnter}>
              Open Terminal
            </button>
            <a
              className="landing__cta-secondary"
              href="https://tally.so/r/Xx102L"
              target="_blank"
              rel="noopener noreferrer"
            >
              Get testnet dUSDC →
            </a>
          </div>
        </div>
  
        <div className="landing__features">
          <div className="landing__feature">
            <div className="landing__feature-icon">◈</div>
            <div className="landing__feature-title">Live SVI Surface</div>
            <div className="landing__feature-desc">
              Every oracle a, b, rho, m, sigma params computed into a real
              implied-vol surface in your browser. Butterfly and calendar
              arbitrage flagged in real time.
            </div>
          </div>
          <div className="landing__feature">
            <div className="landing__feature-icon">⬡</div>
            <div className="landing__feature-title">Risk Guardian</div>
            <div className="landing__feature-desc">
              Five deterministic factors — oracle freshness, vault utilization,
              liquidity, arb integrity, lifecycle — compose into one score.
              Hard blockers stated before you sign anything.
            </div>
          </div>
          <div className="landing__feature">
            <div className="landing__feature-icon">◎</div>
            <div className="landing__feature-title">Settled-Redeem Keeper</div>
            <div className="landing__feature-desc">
              An always-on keeper watches for settled positions and claims
              payouts. The live feed proves the system keeps running without
              anyone watching.
            </div>
          </div>
        </div>
  
        <footer className="landing__footer mono">
          Built for Sui Overflow 2026 · DeepBook track ·{' '}
          <a
            href="https://github.com/0xkinno/pulse"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--pulse-cyan)', textDecoration: 'none' }}
          >
            GitHub
          </a>
        </footer>
      </div>
    );
  }
  