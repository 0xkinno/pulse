import { useState } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import type { OracleSummary } from '../lib/predictApi';
import type { RiskAssessment } from '../lib/riskGuardian';
import { PREDICT_PACKAGE_ID, PREDICT_OBJECT_ID, QUOTE_ASSET_SYMBOL } from '../lib/constants';

type TxStatus = 'idle' | 'signing' | 'success' | 'error';

export function TradePanel({
  oracles,
  risk,
}: {
  oracles: OracleSummary[];
  risk: RiskAssessment | null;
}) {
  const account = useCurrentAccount();
  const { mutate: signAndExecute } = useSignAndExecuteTransaction();

  const [selectedOracleId, setSelectedOracleId] = useState(oracles[0]?.oracleId ?? '');
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [amount, setAmount] = useState('100');
  const [confirmAck, setConfirmAck] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');
  const [txDigest, setTxDigest] = useState('');
  const [txError, setTxError] = useState('');

  const selectedOracle = oracles.find((o) => o.oracleId === selectedOracleId) ?? oracles[0];
  const blocked = (risk?.blockers.length ?? 0) > 0;
  const needsAck = (risk?.score ?? 0) >= 50 && !blocked;
  const canSubmit = !!account && !blocked && !(needsAck && !confirmAck) && txStatus !== 'signing';

  function handleMint() {
    if (!canSubmit) return;
    setTxStatus('signing');
    setTxError('');
    setTxDigest('');

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${PREDICT_PACKAGE_ID}::predict::mint_binary`,
        arguments: [
          tx.object(PREDICT_OBJECT_ID),
          tx.pure.bool(direction === 'up'),
          tx.pure.u64(Math.floor(parseFloat(amount || '0') * 1_000_000)),
        ],
      });

      signAndExecute(
        { transaction: tx },
        {
          onSuccess: (result) => {
            setTxStatus('success');
            setTxDigest(result.digest);
          },
          onError: (err) => {
            setTxStatus('error');
            setTxError(err.message ?? 'Transaction failed or rejected');
          },
        }
      );
    } catch (e) {
      setTxStatus('error');
      setTxError(e instanceof Error ? e.message : 'Failed to build transaction');
    }
  }

  return (
    <div className="panel trade-panel">
      <div className="panel__header">
        <span className="panel__title">Mint position</span>
        <span className="panel__eyebrow mono">{QUOTE_ASSET_SYMBOL}</span>
      </div>

      <a
        href="https://tally.so/r/Xx102L"
        target="_blank"
        rel="noopener noreferrer"
        className="trade-panel__faucet-link mono"
      >
        Need testnet dUSDC? Request from faucet
      </a>

      <div className="trade-panel__oracle-select">
        {oracles.map((o) => (
          <button
            key={o.oracleId}
            className={`oracle-chip${o.oracleId === selectedOracleId ? ' oracle-chip--active' : ''}`}
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
          className={`dir-btn dir-btn--up${direction === 'up' ? ' dir-btn--active' : ''}`}
          onClick={() => setDirection('up')}
        >
          ▲ Up
        </button>
        <button
          className={`dir-btn dir-btn--down${direction === 'down' ? ' dir-btn--active' : ''}`}
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
          <input
            type="checkbox"
            checked={confirmAck}
            onChange={(e) => setConfirmAck(e.target.checked)}
          />
          I acknowledge this mint carries {risk?.level} risk and want to proceed
        </label>
      )}

      {blocked && (
        <div className="trade-panel__blocked mono">
          Mint blocked by Risk Guardian — resolve blockers before trading
        </div>
      )}

      {txStatus === 'success' && (
        <div className="trade-panel__tx-success mono">
          Transaction submitted!{' '}
          <a
            href={`https://suiscan.xyz/testnet/tx/${txDigest}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--pulse-cyan)' }}
          >
            View on Suiscan
          </a>
        </div>
      )}

      {txStatus === 'error' && (
        <div className="trade-panel__tx-error mono">
          {txError}
        </div>
      )}

      <button
        className="trade-panel__submit"
        disabled={!canSubmit}
        onClick={handleMint}
      >
        {!account
          ? 'Connect wallet to trade'
          : txStatus === 'signing'
          ? 'Waiting for wallet...'
          : blocked
          ? 'Blocked by Guardian'
          : `Mint ${direction === 'up' ? 'Up' : 'Down'} position`}
      </button>

      <div className="trade-panel__note mono">
        Slush, Sui Wallet, or any Sui-compatible wallet
      </div>
    </div>
  );
}
