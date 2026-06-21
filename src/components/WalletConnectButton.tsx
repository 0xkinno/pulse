import { useState } from 'react';
import { ConnectModal, useCurrentAccount, useDisconnectWallet } from '@mysten/dapp-kit';

function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletConnectButton() {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  if (account) {
    return (
      <div style={{ position: 'relative' }}>
        <button className="wallet-btn wallet-btn--connected" onClick={() => setMenuOpen((v) => !v)}>
          <span className="wallet-dot" />
          <span className="mono">{truncateAddress(account.address)}</span>
        </button>
        {menuOpen && (
          <div className="wallet-menu">
            <button
              className="wallet-menu__item"
              onClick={() => {
                disconnect();
                setMenuOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button className="wallet-btn" onClick={() => setOpen(true)}>
        Connect wallet
      </button>
      <ConnectModal trigger={<span />} open={open} onOpenChange={setOpen} />
    </>
  );
}
