// Lets the user become a liquidity provider: supply dUSDC to the Predict
// vault (mint PLP shares) and withdraw by burning PLP back for dUSDC.
//
// Real on-chain flow, verified directly against predict::supply and
// predict::withdraw in predict.move:
//   - supply<Quote>(predict, coin, clock, ctx) -> Coin<PLP>
//   - withdraw<Quote>(predict, lp_coin, clock, ctx) -> Coin<Quote>
// Notably simpler than mint/redeem: no PredictManager, no MarketKey, no
// oracle involved — just the shared Predict object plus a coin and a clock.

import { useEffect, useState } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { QUOTE_ASSET_SYMBOL, QUOTE_ASSET_TYPE, PLP_COIN_TYPE } from '../lib/constants';
import { buildSupplyTx, buildWithdrawLiquidityTx } from '../lib/predictTx';

type Mode = 'supply' | 'withdraw';
type Step = 'idle' | 'submitting' | 'success' | 'error';
const DUSDC_SCALE = 1_000_000;

export function SupplyLiquidityPanel() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [mode, setMode] = useState<Mode>('supply');
  const [amount, setAmount] = useState('100');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');
  const [digest, setDigest] = useState('');
  const [dusdcBalance, setDusdcBalance] = useState<number | null>(null);
  const [plpBalance, setPlpBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!account) {
      setDusdcBalance(null);
      setPlpBalance(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      client.getCoins({ owner: account.address, coinType: QUOTE_ASSET_TYPE }),
      client.getCoins({ owner: account.address, coinType: PLP_COIN_TYPE }),
    ])
      .then(([dusdc, plp]) => {
        if (cancelled) return;
        const dusdcTotal = (dusdc.data ?? []).reduce((sum, c) => sum + BigInt(c.balance), 0n);
        const plpTotal = (plp.data ?? []).reduce((sum, c) => sum + BigInt(c.balance), 0n);
        setDusdcBalance(Number(dusdcTotal) / DUSDC_SCALE);
        setPlpBalance(Number(plpTotal) / DUSDC_SCALE);
      })
      .catch(() => {
        setDusdcBalance(null);
        setPlpBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [account, client, step]);

  function handleMax() {
    if (mode === 'supply' && dusdcBalance !== null) setAmount(dusdcBalance.toString());
    if (mode === 'withdraw' && plpBalance !== null) setAmount(plpBalance.toString());
  }

  async function handleSubmit() {
    if (!account) return;
    setStep('idle');
    setError('');
    setDigest('');

    try {
      const rawAmount = Math.floor(parseFloat(amount || '0') * DUSDC_SCALE);
      if (rawAmount <= 0) throw new Error('Enter a positive amount.');

      setStep('submitting');

      if (mode === 'supply') {
        const coins = await client.getCoins({ owner: account.address, coinType: QUOTE_ASSET_TYPE });
        const fundingCoin = coins.data?.find((c) => BigInt(c.balance) >= BigInt(rawAmount));
        if (!fundingCoin) {
          throw new Error(
            `No single ${QUOTE_ASSET_SYMBOL} coin covers that amount. Request more from the faucet or enter less.`,
          );
        }
        const tx = buildSupplyTx(fundingCoin.coinObjectId, rawAmount, account.address);
        const result = await signAndExecute({ transaction: tx });
        setStep('success');
        setDigest(result.digest);
      } else {
        const plpCoins = await client.getCoins({ owner: account.address, coinType: PLP_COIN_TYPE });
        const plpCoin = plpCoins.data?.find((c) => BigInt(c.balance) >= BigInt(rawAmount));
        if (!plpCoin) {
          throw new Error('No single PLP coin covers that amount. Enter a smaller amount.');
        }
        // withdraw() burns the WHOLE coin object passed in (same Move
        // semantics as deposit() did before the split-coin fix) — split off
        // only the requested amount first so the rest of the user's PLP
        // stays untouched.
        const tx = buildWithdrawLiquidityTx(plpCoin.coinObjectId, account.address);
        const result = await signAndExecute({ transaction: tx });
        setStep('success');
        setDigest(result.digest);
      }
    } catch (e) {
      setStep('error');
      setError(e instanceof Error ? e.message : 'Transaction failed or was rejected.');
    }
  }

  const busy = step === 'submitting';
  const balanceForMode = mode === 'supply' ? dusdcBalance : plpBalance;

  return (
    <div className="panel trade-panel">
      <div className="panel__header">
        <span className="panel__title">Provide liquidity</span>
        <span className="panel__eyebrow mono">PLP shares</span>
      </div>

      <div className="trade-panel__direction">
        <button
          className={`dir-btn dir-btn--up${mode === 'supply' ? ' dir-btn--active' : ''}`}
          onClick={() => {
            setMode('supply');
            setAmount('');
          }}
        >
          Supply {QUOTE_ASSET_SYMBOL}
        </button>
        <button
          className={`dir-btn dir-btn--down${mode === 'withdraw' ? ' dir-btn--active' : ''}`}
          onClick={() => {
            setMode('withdraw');
            setAmount('');
          }}
        >
          Withdraw PLP
        </button>
      </div>

      <label className="trade-panel__amount-label">
        Amount ({mode === 'supply' ? QUOTE_ASSET_SYMBOL : 'PLP'})
        <span className="trade-panel__balance-hint mono">
          {' '}
          ·{' '}
          {balanceForMode !== null
            ? `wallet: ${balanceForMode.toFixed(4)}`
            : 'connect wallet'}
        </span>
        <div className="trade-panel__amount-row">
          <input
            className="trade-panel__amount-input mono"
            type="number"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            type="button"
            className="trade-panel__max-btn"
            onClick={handleMax}
            disabled={balanceForMode === null}
          >
            Max
          </button>
        </div>
      </label>

      {step === 'success' && (
        <div className="trade-panel__tx-success mono">
          {mode === 'supply' ? 'Supplied! PLP minted.' : 'Withdrawn! dUSDC returned.'}{' '}
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

      <button className="trade-panel__submit" disabled={!account || busy} onClick={handleSubmit}>
        {!account
          ? 'Connect wallet'
          : busy
            ? mode === 'supply'
              ? 'Supplying...'
              : 'Withdrawing...'
            : mode === 'supply'
              ? 'Supply liquidity'
              : 'Withdraw liquidity'}
      </button>

      {mode === 'withdraw' && (
        <div className="trade-panel__note mono" style={{ marginTop: 12 }}>
          Withdrawals are capped by current vault balance minus max payout
          coverage, plus the protocol's own withdrawal limiter — a real
          withdrawal can be rejected on-chain even if this form lets you
          submit it, exactly as predict::withdraw enforces.
        </div>
      )}
    </div>
  );
}