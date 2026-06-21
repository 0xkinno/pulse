import type { VaultSummary } from '../lib/predictApi';

function fmtUsd(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function VaultPanel({ vault }: { vault: VaultSummary | null }) {
  if (!vault) {
    return (
      <div className="panel vault-panel">
        <div className="panel__header">
          <span className="panel__title">PLP Vault</span>
        </div>
        <div className="panel__loading">Loading vault state…</div>
      </div>
    );
  }

  const utilDanger = vault.utilizationPct > 78;

  return (
    <div className="panel vault-panel">
      <div className="panel__header">
        <span className="panel__title">PLP Vault</span>
        <span className="panel__eyebrow mono">dUSDC quote</span>
      </div>
      <div className="vault-panel__grid">
        <div className="vault-stat">
          <div className="vault-stat__label">Vault balance</div>
          <div className="vault-stat__value mono">${fmtUsd(vault.vaultBalance)}</div>
        </div>
        <div className="vault-stat">
          <div className="vault-stat__label">Total liability</div>
          <div className="vault-stat__value mono">${fmtUsd(vault.totalLiability)}</div>
        </div>
        <div className="vault-stat">
          <div className="vault-stat__label">Max payout cover</div>
          <div className="vault-stat__value mono">${fmtUsd(vault.maxPayout)}</div>
        </div>
        <div className="vault-stat">
          <div className="vault-stat__label">PLP share price</div>
          <div className="vault-stat__value mono">${vault.plpSharePrice.toFixed(4)}</div>
        </div>
      </div>
      <div className="vault-panel__util">
        <div className="vault-panel__util-top">
          <span>Vault utilization</span>
          <span className={`mono ${utilDanger ? 'text-amber' : ''}`}>{vault.utilizationPct.toFixed(1)}%</span>
        </div>
        <div className="vault-panel__util-bar">
          <div
            className="vault-panel__util-fill"
            style={{
              width: `${Math.min(100, vault.utilizationPct)}%`,
              background: utilDanger ? 'var(--pulse-amber)' : 'var(--pulse-cyan)',
            }}
          />
          <div className="vault-panel__util-cap" style={{ left: '78%' }} />
        </div>
        <div className="vault-panel__util-foot mono">Exposure cap at 78%</div>
      </div>
    </div>
  );
}
