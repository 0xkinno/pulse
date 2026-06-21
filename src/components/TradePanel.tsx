import { useEffect, useState } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import type { OracleSummary } from '../lib/predictApi';
import type { RiskAssessment } from '../lib/riskGuardian';
import { QUOTE_ASSET_SYMBOL, QUOTE_ASSET_TYPE } from '../lib/constants';
import { buildDepositTx, buildMintTx } from '../lib/predictTx';
import { usePredictManager } from '../hooks/usePredictManager';
import { fetchOnChainOracle, strikeToOnChainUnits } from '../lib/onChainOracle';
import { recordPosition } from '../lib/positionLedger';
import { upProbability, formatProbabilityAsCents } from '../lib/probability';

type TxStatus = 'idle' | 'depositing' | 'minting' | 'success' | 'error';
const DUSDC_DECIMALS_SCALE = 1_000_000;

export function TradePanel({
  oracles,
  risk,
}: {
  oracles: OracleSummary[];
  risk: RiskAssessment | null;
}) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { managerId, status: managerStatus, error: managerError, createManager } =
    usePredictManager();

  const [selectedOracleId, setSelectedOracleId] = useState(oracles[0]?.oracleId ?? '');
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [amount, setAmount] = useState('100');
  const [confirmAck, setConfirmAck] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');
  const [txDigest, setTxDigest] = useState('');
  const [txError, setTxError] = useState('');
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [upCents, setUpCents] = useState<number | null>(null);

  // Sum every Coin<DUSDC> the wallet owns (getCoins, NOT getBalance — getCoins'
  // CoinStruct.balance shape is the one already verified working elsewhere in
  // this app; avoiding introducing a second, unverified balance read).
  useEffect(() => {
    if (!account) {
      setWalletBalance(null);
      return;
    }
    let cancelled = false;
    client
      .getCoins({ owner: account.address, coinType: QUOTE_ASSET_TYPE })
      .then((res) => {
        if (cancelled) return;
        const total = (res.data ?? []).reduce((sum, c) => sum + BigInt(c.balance), 0n);
        setWalletBalance(Number(total) / DUSDC_DECIMALS_SCALE);
      })
      .catch(() => setWalletBalance(null));
    return () => {
      cancelled = true;
    };
  }, [account, client, txStatus]); // refetch after a tx completes too

  // Display-only Up probability (the "63¢" Polymarket-style price), derived
  // from the same real on-chain oracle the mint flow reads — NOT used for
  // any transaction value, see lib/probability.ts.
  useEffect(() => {
    const oracle = oracles.find((o) => o.oracleId === selectedOracleId) ?? oracles[0];
    if (!oracle || oracle.oracleId.startsWith('sim-')) {
      setUpCents(null);
      return;
    }
    let cancelled = false;
    fetchOnChainOracle(client, oracle.oracleId).then((onChain) => {
      if (cancelled || !onChain) {
        setUpCents(null);
        return;
      }
      const atTheMoneyStrike = Math.round(onChain.forward);
      const prob = upProbability(atTheMoneyStrike, onChain.forward, onChain.svi);
      setUpCents(prob);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedOracleId, oracles, client]);

  const selectedOracle = oracles.find((o) => o.oracleId === selectedOracleId) ?? oracles[0];
  const blocked = (risk?.blockers.length ?? 0) > 0;
  const needsAck = (risk?.score ?? 0) >= 50 && !blocked;
  const isSimulatedOracle = selectedOracle?.oracleId.startsWith('sim-');
  const busy = txStatus === 'depositing' || txStatus === 'minting' || managerStatus === 'creating';
  const canSubmit =
    !!account && !blocked && !(needsAck && !confirmAck) && !busy && !isSimulatedOracle;

  function handleMaxClick() {
    if (walletBalance !== null) {
      setAmount(walletBalance.toString());
    }
  }

  async function handleMint() {
    if (!account || !selectedOracle) return;
    setTxStatus('idle');
    setTxError('');
    setTxDigest('');

    try {
      // Step 0 — read the REAL on-chain OracleSVI object before doing
      // anything else. The indexed server's /oracles list endpoint does NOT
      // include forward price or SVI params, so the "spot"/"forward" shown
      // elsewhere in this UI are partly estimated for display purposes only.
      // Minting against an estimated forward price is exactly what caused
      // every previous on-chain abort in pricing_config/oracle_config — this
      // read replaces that estimate with the real value the Move contract
      // itself will use, BEFORE any wallet signature is requested.
      const onChainOracle = await fetchOnChainOracle(client, selectedOracle.oracleId);
      if (!onChainOracle) {
        throw new Error(
          'Could not read this oracle directly from the blockchain — cannot safely mint without its real forward price and SVI parameters. Try a different oracle or reload.',
        );
      }
      if (!onChainOracle.active || onChainOracle.isSettled) {
        throw new Error('This oracle is not currently live (inactive or already settled).');
      }

      // Step 1 — ensure a PredictManager exists for this wallet.
      let activeManagerId = managerId;
      if (!activeManagerId) {
        activeManagerId = await createManager();
        if (!activeManagerId) {
          throw new Error(managerError || 'Could not create a PredictManager for this wallet.');
        }
      }

      // dUSDC's coin decimals are CONFIRMED 1e6 (6 decimals), not 1e9 — proven
      // directly from a Suiscan activity log capture: a "1,000 DUSDC" deposit
      // moved exactly 1,000,000,000 base units, i.e. 1 DUSDC = 1_000_000 base
      // units. This is a SEPARATE number from the Predict protocol's internal
      // strike/tick_size fixed-point scale below (which really is 1e9,
      // confirmed from a live OracleSVI object's min_strike/tick_size fields)
      // — coin decimals and the protocol's own price-grid scale just happen
      // to be unrelated numbers, conflating them was the bug.
      const quantity = Math.floor(parseFloat(amount || '0') * DUSDC_DECIMALS_SCALE);
      if (quantity <= 0) throw new Error('Enter a positive amount.');

      // Step 2 — fund the manager. Find a Coin<DUSDC> owned by the wallet
      // with enough balance, then deposit ONLY the requested amount (the
      // remainder is split off and stays in the wallet as a new coin).
      setTxStatus('depositing');
      const coins = await client.getCoins({
        owner: account.address,
        coinType: QUOTE_ASSET_TYPE,
      });
      const fundingCoin = coins.data?.find((c) => BigInt(c.balance) >= BigInt(quantity));
      if (!fundingCoin) {
        throw new Error(
          'No single dUSDC coin in this wallet covers that amount. Request more from the faucet, or enter a smaller amount.',
        );
      }

      const depositTx = buildDepositTx(activeManagerId, fundingCoin.coinObjectId, quantity);
      await signAndExecute({ transaction: depositTx });

      // Step 3 — mint the binary position against the real predict::mint entrypoint.
      // Strike is chosen at-the-money relative to the REAL on-chain forward
      // price (onChainOracle.forward), not the dashboard's estimated spot —
      // this keeps log-moneyness near zero, which is what compute_nd2 needs
      // to produce a sane in-range fair price instead of an extreme tail
      // value that aborts downstream in quote_spread_from_fair_price.
      setTxStatus('minting');
      const strikeOnChain = strikeToOnChainUnits(Math.round(onChainOracle.forward));
      const mintTx = buildMintTx({
        managerId: activeManagerId,
        oracleId: selectedOracle.oracleId,
        expiryAbsoluteMs: selectedOracle.expiryAbsoluteMs,
        strike: strikeOnChain,
        isUp: direction === 'up',
        quantity,
      });
      const mintResult = await signAndExecute({ transaction: mintTx });

      // Remember EXACTLY which oracle/expiry/strike this mint used — the
      // live oracle list reshuffles which real oracle sits in a given UI
      // slot (e.g. "BTC-30m") every few seconds as new rolling markets
      // activate, so redeem must check against this recorded identity, not
      // whatever oracle later happens to occupy the same slot.
      recordPosition(account.address, {
        oracleId: selectedOracle.oracleId,
        underlying: selectedOracle.underlying,
        expiryLabel: selectedOracle.expiryLabel,
        expiryAbsoluteMs: selectedOracle.expiryAbsoluteMs,
        strike: strikeOnChain,
        isUp: direction === 'up',
        quantity,
        mintedAtMs: Date.now(),
        txDigest: mintResult.digest,
      });

      setTxStatus('success');
      setTxDigest(mintResult.digest);
    } catch (e) {
      setTxStatus('error');
      setTxError(e instanceof Error ? e.message : 'Transaction failed or was rejected.');
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
          {upCents !== null && (
            <>
              {' '}
              · <span style={{ color: 'var(--pulse-cyan)' }}>Up {formatProbabilityAsCents(upCents)}</span>
              {' / '}
              <span style={{ color: 'var(--pulse-amber)' }}>
                Down {formatProbabilityAsCents(1 - upCents)}
              </span>
            </>
          )}
        </div>
      )}

      {isSimulatedOracle && (
        <div className="trade-panel__blocked mono">
          This oracle is from the simulated feed (testnet server unreachable) — minting against it
          is disabled. Real mints only run against live oracle data.
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
        {walletBalance !== null && (
          <span className="trade-panel__balance-hint mono"> · wallet: {walletBalance}</span>
        )}
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
            onClick={handleMaxClick}
            disabled={walletBalance === null}
          >
            Max
          </button>
        </div>
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

      {!managerId && account && managerStatus !== 'creating' && (
        <div className="trade-panel__note mono">
          First mint will create your on-chain PredictManager, then deposit dUSDC, then mint —
          three signatures in your wallet.
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

      {txStatus === 'error' && <div className="trade-panel__tx-error mono">{txError}</div>}

      <button className="trade-panel__submit" disabled={!canSubmit} onClick={handleMint}>
        {!account
          ? 'Connect wallet to trade'
          : managerStatus === 'creating'
          ? 'Creating your manager...'
          : txStatus === 'depositing'
          ? 'Depositing dUSDC...'
          : txStatus === 'minting'
          ? 'Minting position...'
          : blocked
          ? 'Blocked by Guardian'
          : isSimulatedOracle
          ? 'Live oracle required'
          : `Mint ${direction === 'up' ? 'Up' : 'Down'} position`}
      </button>

      <div className="trade-panel__note mono">Slush, Sui Wallet, or any Sui-compatible wallet</div>
    </div>
  );
}