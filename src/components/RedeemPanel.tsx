// Lets the user close a position they previously minted (redeem) and pull
// the resulting payout back into their own wallet (withdraw).
//
// IMPORTANT — this panel used to let the user pick an oracle from the live,
// auto-refreshing oracle list (the same chips used for minting). That was a
// real bug: the live list is sorted by soonest-expiry and reshuffles which
// REAL oracle object occupies a given slot (e.g. "BTC-30m") every few
// seconds as new rolling sub-hour markets activate on the server. A position
// minted against "today's BTC-30m" could no longer match "BTC-30m" five
// minutes later, because that label now points at a DIFFERENT oracle. This
// is why redeem kept saying "you hold no position" even right after a real,
// successful mint.
//
// Fix: redeem now lists the user's own recorded positions (see
// positionLedger.ts, written at the exact moment of a successful mint) and
// lets them pick from THAT list — never from the live, reshuffling oracle
// list. The oracle/expiry/strike/direction used for redeem is always the
// exact one that was actually minted against.

import { useEffect, useState } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { QUOTE_ASSET_SYMBOL } from '../lib/constants';
import {
  buildPositionQueryTx,
  buildRedeemTx,
  buildWithdrawTx,
  decodeU64FromBcs,
} from '../lib/predictTx';
import { usePredictManager } from '../hooks/usePredictManager';
import { loadPositions, removePosition, type OpenPosition } from '../lib/positionLedger';

type Step = 'idle' | 'redeeming' | 'withdrawing' | 'success' | 'error';
const DUSDC_DECIMALS_SCALE = 1_000_000;

function timeUntil(expiryAbsoluteMs: number): string {
  const ms = expiryAbsoluteMs - Date.now();
  if (ms <= 0) return 'expired';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  return `${Math.round(mins / 60)}h left`;
}

export function RedeemPanel() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { managerId } = usePredictManager();

  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [selectedDigest, setSelectedDigest] = useState<string | null>(null);
  const [quantityInput, setQuantityInput] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');
  const [digest, setDigest] = useState('');
  const [heldQuantity, setHeldQuantity] = useState<number | null>(null);
  const [positionLoading, setPositionLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  function handleRefresh() {
    if (account) setPositions(loadPositions(account.address));
    setRefreshKey((k) => k + 1);
  }

  // Load this wallet's recorded positions (written at mint time) rather than
  // anything from the live, reshuffling oracle list.
  useEffect(() => {
    if (!account) {
      setPositions([]);
      return;
    }
    setPositions(loadPositions(account.address));
  }, [account, step]); // refresh after a redeem completes too

  const selected = positions.find((p) => p.txDigest === selectedDigest) ?? positions[0];

  useEffect(() => {
    if (selected && quantityInput === '') {
      setQuantityInput((selected.quantity / DUSDC_DECIMALS_SCALE).toString());
    }
  }, [selected, quantityInput]);

  // Query the REAL held quantity for the exact recorded position — using
  // its own stored oracleId/expiry/strike/direction, never the live list.
  useEffect(() => {
    if (!account || !managerId || !selected) {
      setHeldQuantity(null);
      return;
    }
    let cancelled = false;
    setPositionLoading(true);
    (async () => {
      try {
        const tx = buildPositionQueryTx({
          managerId,
          oracleId: selected.oracleId,
          expiryAbsoluteMs: selected.expiryAbsoluteMs,
          strike: selected.strike,
          isUp: selected.isUp,
        });
        const result = await client.devInspectTransactionBlock({
          sender: account.address,
          transactionBlock: tx,
        });
        const returnVal = result.results?.[1]?.returnValues?.[0];
        if (!cancelled && returnVal) {
          setHeldQuantity(decodeU64FromBcs(returnVal[0]) / DUSDC_DECIMALS_SCALE);
        } else if (!cancelled) {
          setHeldQuantity(0);
        }
      } catch {
        if (!cancelled) setHeldQuantity(null);
      } finally {
        if (!cancelled) setPositionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, managerId, selected, client, refreshKey]);

  function handleMaxClick() {
    if (heldQuantity !== null && heldQuantity > 0) {
      setQuantityInput(heldQuantity.toString());
    }
  }

  async function handleRedeemAndWithdraw() {
    if (!account || !selected || !managerId) return;
    setStep('idle');
    setError('');
    setDigest('');

    try {
      const quantity = Math.floor(parseFloat(quantityInput || '0') * DUSDC_DECIMALS_SCALE);
      if (quantity <= 0) throw new Error('Enter a positive quantity to redeem.');
      if (heldQuantity !== null && quantity > heldQuantity * DUSDC_DECIMALS_SCALE) {
        throw new Error(
          `You only hold ${heldQuantity} ${QUOTE_ASSET_SYMBOL} of this position — use Max or enter a smaller amount.`,
        );
      }

      setStep('redeeming');
      const redeemTx = buildRedeemTx({
        managerId,
        oracleId: selected.oracleId,
        expiryAbsoluteMs: selected.expiryAbsoluteMs,
        strike: selected.strike,
        isUp: selected.isUp,
        quantity,
      });
      await signAndExecute({ transaction: redeemTx });

      setStep('withdrawing');
      const withdrawTx = buildWithdrawTx(managerId, quantity, account.address);
      const withdrawResult = await signAndExecute({ transaction: withdrawTx });

      setStep('success');
      setDigest(withdrawResult.digest);

      // Fully redeemed — drop it from the ledger so it stops showing as open.
      const remaining = (heldQuantity ?? 0) * DUSDC_DECIMALS_SCALE - quantity;
      if (remaining <= 0) {
        removePosition(account.address, selected.txDigest);
      }
    } catch (e) {
      setStep('error');
      setError(e instanceof Error ? e.message : 'Redeem/withdraw failed or was rejected.');
    }
  }

  const busy = step === 'redeeming' || step === 'withdrawing';
  const noPosition = heldQuantity === 0;

  if (positions.length === 0) {
    return (
      <div className="panel trade-panel">
        <div className="panel__header">
          <span className="panel__title">Redeem position</span>
          <span className="panel__eyebrow mono">{QUOTE_ASSET_SYMBOL}</span>
        </div>
        <div className="trade-panel__note mono">
          No recorded open positions for this wallet yet. Mint one on the left
          — positions you mint here are remembered exactly (oracle, expiry,
          strike, direction), so redeem always checks the right market even
          as the live oracle list rolls forward to new expiries.
        </div>
      </div>
    );
  }

  return (
    <div className="panel trade-panel">
      <div className="panel__header">
        <span className="panel__title">Redeem position</span>
        <span className="panel__eyebrow mono">{QUOTE_ASSET_SYMBOL}</span>
      </div>

      <p className="trade-panel__note mono" style={{ marginBottom: 16 }}>
        Pick one of your own recorded positions below — not the live oracle
        list, which rolls forward to new expiries every few seconds. Redeem
        confirms first; withdraw only runs after that succeeds.
      </p>

      <div className="trade-panel__oracle-select-row">
        <div className="trade-panel__oracle-select">
          {positions.map((p) => (
            <button
              key={p.txDigest}
              className={`oracle-chip${p.txDigest === selected?.txDigest ? ' oracle-chip--active' : ''}`}
              onClick={() => {
                setSelectedDigest(p.txDigest);
                setQuantityInput('');
              }}
            >
              {p.underlying}-{p.expiryLabel} {p.isUp ? '▲' : '▼'} ({timeUntil(p.expiryAbsoluteMs)})
            </button>
          ))}
        </div>
        <button
          type="button"
          className="trade-panel__refresh-btn"
          onClick={handleRefresh}
          disabled={positionLoading}
          title="Refresh positions and holdings"
          aria-label="Refresh positions and holdings"
        >
          ↻
        </button>
      </div>

      {selected && (
        <div className="trade-panel__spot mono">
          minted {(selected.quantity / DUSDC_DECIMALS_SCALE).toFixed(2)} {QUOTE_ASSET_SYMBOL} ·{' '}
          {selected.isUp ? 'Up' : 'Down'} ·{' '}
          <a
            href={`https://suiscan.xyz/testnet/tx/${selected.txDigest}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--pulse-cyan-soft)' }}
          >
            original mint tx
          </a>
        </div>
      )}

      <label className="trade-panel__amount-label">
        Quantity to redeem
        <span className="trade-panel__balance-hint mono">
          {' '}
          ·{' '}
          {positionLoading
            ? 'checking holdings…'
            : heldQuantity !== null
              ? `you hold: ${heldQuantity} ${QUOTE_ASSET_SYMBOL}`
              : 'holdings unknown'}
        </span>
        <div className="trade-panel__amount-row">
          <input
            className="trade-panel__amount-input mono"
            type="number"
            min="0"
            value={quantityInput}
            onChange={(e) => setQuantityInput(e.target.value)}
          />
          <button
            type="button"
            className="trade-panel__max-btn"
            onClick={handleMaxClick}
            disabled={!heldQuantity}
          >
            Max
          </button>
        </div>
      </label>

      {noPosition && (
        <div className="trade-panel__blocked mono">
          On-chain holdings for this exact position read as zero right now —
          it may already be fully redeemed, or settlement changed its value.
        </div>
      )}

      {step === 'success' && (
        <div className="trade-panel__tx-success mono">
          Redeemed and withdrawn!{' '}
          <a
            href={`https://suiscan.xyz/testnet/tx/${digest}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--pulse-cyan)' }}
          >
            View on Suiscan
          </a>
        </div>
      )}

      {step === 'error' && <div className="trade-panel__tx-error mono">{error}</div>}

      <button
        className="trade-panel__submit"
        disabled={!account || !managerId || !selected || busy || noPosition}
        onClick={handleRedeemAndWithdraw}
      >
        {!account
          ? 'Connect wallet'
          : !managerId
            ? 'No PredictManager yet'
            : step === 'redeeming'
              ? 'Redeeming position...'
              : step === 'withdrawing'
                ? 'Withdrawing to wallet...'
                : 'Redeem & withdraw'}
      </button>
    </div>
  );
}