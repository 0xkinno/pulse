import { WalletConnectButton } from './WalletConnectButton';

export type Tab = 'surface' | 'trade' | 'risk' | 'vault' | 'keeper';

interface NavbarProps {
  activeTab: Tab;
  onTab: (t: Tab) => void;
  isLive: boolean;
  onHome: () => void;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'surface', label: 'Vol Surface', icon: '◈' },
  { id: 'trade',   label: 'Trade',       icon: '⬡' },
  { id: 'risk',    label: 'Risk',        icon: '◎' },
  { id: 'vault',   label: 'Vault',       icon: '▣' },
  { id: 'keeper',  label: 'Keeper',      icon: '◷' },
];

export function Navbar({ activeTab, onTab, isLive, onHome }: NavbarProps) {
  return (
    <nav className="terminal-nav">
      <div className="terminal-nav__left">
        <button className="terminal-nav__logo" onClick={onHome}>
          PULSE
        </button>
        <span className="terminal-nav__divider" />
        <div className="terminal-nav__tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`terminal-nav__tab${activeTab === t.id ? ' terminal-nav__tab--active' : ''}`}
              onClick={() => onTab(t.id)}
            >
              <span className="terminal-nav__tab-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="terminal-nav__right">
        <a
          href="https://tally.so/r/Xx102L"
          target="_blank"
          rel="noopener noreferrer"
          className="terminal-nav__faucet mono"
        >
          Get dUSDC ↗
        </a>
        <span className={`terminal-nav__live mono${isLive ? '' : ' terminal-nav__live--sim'}`}>
          <span className="pulse-dot pulse-dot--small" />
          {isLive ? 'Live · Testnet' : 'Simulated'}
        </span>
        <WalletConnectButton />
      </div>
    </nav>
  );
}