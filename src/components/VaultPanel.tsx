import { useEffect, useState } from 'react';
import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import type { VaultSummary } from '../lib/predictApi';
import { PLP_COIN_TYPE } from '../lib/constants';

const DUSDC_SCALE = 1_000_000; // PLP shares confirmed minted 1:1 with dUSDC at first supply, same coin decimals

function fmtUsd(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function VaultPanel({ vault }: { vault: VaultSummary | null }) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const [userPlpBalance, setUserPlpBalance] = useState<number | null>(null);

  // Reads the connected wallet's REAL PLP token balance — PLP is a regular
  // fungible coin per the protocol docs ("the protocol mints PLP, which
  // represents vault shares"), so this uses the same getCoins approach
  // already verified working for dUSDC elsewhere in this app.
  useEffect(() => {
    if (!account) {
      setUserPlpBalance(null);
      return;
    }
    let cancelled = false;
    client
      .getCoins({ owner: account.address, coinType: PLP_COIN_TYPE })
      .then((res) => {
        if (cancelled) return;
        const total = (res.data ?? []).reduce((sum, c) => sum + BigInt(c.balance), 0n);
        setUserPlpBalance(Number(total) / DUSDC_SCALE);
      })
      .catch(() => setUserPlpBalance(null));
    return () => {
      cancelled = true;
    };
  }, [account, client]);

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

      {account && (
        <div className="vault-panel__user-balance mono">
          Your PLP balance:{' '}
          {userPlpBalance !== null ? `${userPlpBalance.toFixed(4)} PLP` : 'checking…'}
          {userPlpBalance === 0 && (
            <span className="vault-panel__user-balance-note">
              {' '}
              — supplying liquidity isn't wired into this app yet; this reads your real on-chain
              balance, which is genuinely zero until that's added.
            </span>
          )}
        </div>
      )}

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