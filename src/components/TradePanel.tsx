import { useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import type { OracleSummary } from '../lib/predictApi';
import type { RiskAssessment } from '../lib/riskGuardian';
import { QUOTE_ASSET_SYMBOL } from '../lib/constants';

export function TradePanel({ oracles, risk }: { oracles: OracleSummary[]; risk: RiskAssessment | null }) {
  const account = useCurrentAccount();
  const [selectedOracleId, setSelectedOracleId] = useState(oracles[0]?.oracleId);
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [amount, setAmount] = useState('100');
  const [confirmAck, setConfirmAck] = useState(false);

  const selectedOracle = oracles.find((o) => o.oracleId === selectedOracleId) ?? oracles[0];
  const blocked = (risk?.blockers.length ?? 0) > 0;
  const needsAck = (risk?.score ?? 0) >= 50 && !blocked;

  function handleMint() {
    if (!account) return;
    if (blocked) return;
    if (needsAck && !confirmAck) return;
    // PTB construction against PREDICT_PACKAGE_ID::predict::mint would be wired here,
    // gated by the same risk assessment shown in the Guardian panel above.
  }

  return (
    <div className="panel trade-panel">
      <div className="panel__header">
        <span className="panel__title">Mint position</span>
        <span className="panel__eyebrow mono">{QUOTE_ASSET_SYMBOL}</span>
      </div>
      <div className="trade-panel__oracle-select">
        {oracles.map((o) => (
          <button
            key={o.oracleId}
            className={`oracle-chip ${o.oracleId === selectedOracleId ? 'oracle-chip--active' : ''}`}
            onClick={() => setSelectedOracleId(o.oracleId)}
          >
            {o.underlying}-{o.expiryLabel}
          </button>
        ))}
      </div>
      {selectedOracle && (
        <div className="trade-panel__spot mono">
          spot ${selectedOracle.spot.toFixed(2)} · forward ${selectedOracle.forward.toFixed(2)}
        </div>
      )}
      <div className="trade-panel__direction">
        <button
          className={`dir-btn dir-btn--up ${direction === 'up' ? 'dir-btn--active' : ''}`}
          onClick={() => setDirection('up')}
        >
          ▲ Up
        </button>
        <button
          className={`dir-btn dir-btn--down ${direction === 'down' ? 'dir-btn--active' : ''}`}
          onClick={() => setDirection('down')}
        >
          ▼ Down
        </button>
      </div>
      <label className="trade-panel__amount-label">
        Amount ({QUOTE_ASSET_SYMBOL})
        <input
          className="trade-panel__amount-input mono"
          type="number"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      {needsAck && (
        <label className="trade-panel__ack">
          <input type="checkbox" checked={confirmAck} onChange={(e) => setConfirmAck(e.target.checked)} />
          I acknowledge this mint carries {risk?.level} risk and confirm I want to proceed
        </label>
      )}
      {blocked && (
        <div className="trade-panel__blocked mono">
          Mint blocked by Risk Guardian — resolve blockers above before trading
        </div>
      )}
      <button
        className="trade-panel__submit"
        disabled={!account || blocked || (needsAck && !confirmAck)}
        onClick={handleMint}
      >
        {!account ? 'Connect wallet to trade' : blocked ? 'Blocked by Guardian' : `Mint ${direction === 'up' ? 'Up' : 'Down'} position`}
      </button>
    </div>
  );
}
