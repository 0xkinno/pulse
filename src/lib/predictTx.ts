// Real PTB builders against the DeepBook Predict testnet package.
// Verified directly against the Move source on the `predict-testnet-4-16`
// branch (packages/predict/sources/{predict.move, predict_manager.move,
// market_key/market_key.move}) — these are NOT guessed function names.
//
// Real on-chain flow, in order:
//   1. predict::create_manager()              — one-time, creates + shares a PredictManager
//   2. predict_manager (via manager.deposit)  — fund the manager with Quote coins
//   3. market_key::new(oracle_id, expiry, strike, is_up) — build the MarketKey value
//   4. predict::mint<Quote>(predict, manager, oracle, key, qty, clock, ctx)
//   5. predict::redeem<Quote> / redeem_permissionless<Quote> — to exit a position
//
// IMPORTANT — two DIFFERENT fixed-point scales are in play here, and
// conflating them was a real bug that cost real debugging time:
//   - dUSDC COIN decimals: CONFIRMED 1e6 (6 decimals) — verified directly
//     from a Suiscan activity log: a "1,000 DUSDC" transfer moved exactly
//     1,000,000,000 base units. Used for `quantity` (deposit/mint amounts).
//   - Predict protocol's STRIKE/TICK price-grid scale: CONFIRMED 1e9 —
//     verified directly from a live OracleSVI object's own
//     min_strike/tick_size fields (500000000000 / 1000000000). Used for
//     `strike` only. This has nothing to do with coin decimals — it's the
//     protocol's internal price grid, and just happens to be a different
//     power of ten.
//   `manager.deposit<T>` requires you already own a Coin<Quote> object with
//   enough balance. This module finds one via getCoins and splits off only
//   the requested amount — see buildDepositTx.
//   PredictManager is a SHARED object once created — its address must be
//   looked up after creation (from transaction effects) and reused on every
//   subsequent call. This module expects the caller to persist that address
//   (see usePredictManager.ts) rather than re-creating one every time.

import { Transaction } from '@mysten/sui/transactions';
import {
  PREDICT_PACKAGE_ID,
  PREDICT_OBJECT_ID,
  QUOTE_ASSET_TYPE,
} from './constants';

const SUI_CLOCK_OBJECT_ID = '0x6';

/** Step 1 — one-time per wallet. Creates and shares a new PredictManager. */
export function buildCreateManagerTx(): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::predict::create_manager`,
    arguments: [],
  });
  return tx;
}

/**
 * Step 2 — deposit Quote (dUSDC) coins into an existing PredictManager.
 * Splits `amount` off of `coinObjectId` first (in the same transaction) so
 * only the requested amount is deposited — the remainder stays in the
 * sender's wallet as a new coin object. Previously this deposited the
 * ENTIRE source coin regardless of the amount the user typed, which is why
 * a 1,000 DUSDC test coin got fully drained on a 10 DUSDC mint attempt.
 */
export function buildDepositTx(
  managerId: string,
  coinObjectId: string,
  amount: number,
): Transaction {
  const tx = new Transaction();
  const [splitCoin] = tx.splitCoins(tx.object(coinObjectId), [tx.pure.u64(amount)]);
  tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::predict_manager::deposit`,
    typeArguments: [QUOTE_ASSET_TYPE],
    arguments: [tx.object(managerId), splitCoin],
  });
  return tx;
}

/**
 * Step 3+4 combined — builds the MarketKey inline via market_key::new, then
 * calls predict::mint in the same transaction. This is the real mint call;
 * it replaces the placeholder `mint_binary` call that does not exist on-chain.
 */
export function buildMintTx(params: {
  managerId: string;
  oracleId: string;
  expiryAbsoluteMs: number; // MUST be the exact on-chain OracleSVI.expiry value, not a recalculated countdown
  strike: number; // integer, same fixed-point units as the oracle's strike grid
  isUp: boolean;
  quantity: number;
}): Transaction {
  const tx = new Transaction();

  const key = tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::market_key::new`,
    arguments: [
      tx.pure.id(params.oracleId),
      tx.pure.u64(params.expiryAbsoluteMs),
      tx.pure.u64(params.strike),
      tx.pure.bool(params.isUp),
    ],
  });

  tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::predict::mint`,
    typeArguments: [QUOTE_ASSET_TYPE],
    arguments: [
      tx.object(PREDICT_OBJECT_ID),
      tx.object(params.managerId),
      tx.object(params.oracleId),
      key,
      tx.pure.u64(params.quantity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

/**
 * Withdraws `amount` of Quote from a PredictManager's internal balance back
 * to the owner's own wallet. Required as a separate step after redeem()
 * because redeem() deposits the payout INTO the manager's balance, not
 * directly to the wallet — withdraw() is what actually moves funds out.
 */
export function buildWithdrawTx(
  managerId: string,
  amount: number,
  recipientAddress: string,
): Transaction {
  const tx = new Transaction();
  const coin = tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::predict_manager::withdraw`,
    typeArguments: [QUOTE_ASSET_TYPE],
    arguments: [tx.object(managerId), tx.pure.u64(amount)],
  });
  tx.transferObjects([coin], tx.pure.address(recipientAddress));
  return tx;
}

/** Redeem an existing position back to the manager's own balance (owner-only). */
export function buildRedeemTx(params: {
  managerId: string;
  oracleId: string;
  expiryAbsoluteMs: number; // MUST be the exact on-chain OracleSVI.expiry value, not a recalculated countdown
  strike: number;
  isUp: boolean;
  quantity: number;
}): Transaction {
  const tx = new Transaction();

  const key = tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::market_key::new`,
    arguments: [
      tx.pure.id(params.oracleId),
      tx.pure.u64(params.expiryAbsoluteMs),
      tx.pure.u64(params.strike),
      tx.pure.bool(params.isUp),
    ],
  });

  tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::predict::redeem`,
    typeArguments: [QUOTE_ASSET_TYPE],
    arguments: [
      tx.object(PREDICT_OBJECT_ID),
      tx.object(params.managerId),
      tx.object(params.oracleId),
      key,
      tx.pure.u64(params.quantity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

/**
 * Permissionless redeem — anyone can call this on a SETTLED oracle to claim a
 * position's payout into the owning manager's balance (no signature from the
 * position owner required). This is the real call the Settled-Redeem Keeper
 * idea is built on — wiring this up for real (instead of the simulated feed)
 * is the next concrete milestone, not yet done in this codebase.
 */
export function buildRedeemPermissionlessTx(params: {
  managerId: string;
  oracleId: string;
  expiryAbsoluteMs: number; // MUST be the exact on-chain OracleSVI.expiry value, not a recalculated countdown
  strike: number;
  isUp: boolean;
  quantity: number;
}): Transaction {
  const tx = new Transaction();

  const key = tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::market_key::new`,
    arguments: [
      tx.pure.id(params.oracleId),
      tx.pure.u64(params.expiryAbsoluteMs),
      tx.pure.u64(params.strike),
      tx.pure.bool(params.isUp),
    ],
  });

  tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::predict::redeem_permissionless`,
    typeArguments: [QUOTE_ASSET_TYPE],
    arguments: [
      tx.object(PREDICT_OBJECT_ID),
      tx.object(params.managerId),
      tx.object(params.oracleId),
      key,
      tx.pure.u64(params.quantity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  return tx;
}

/**
 * Builds a transaction that calls predict_manager::position(manager, key) —
 * a real read-only function — wrapped for use with devInspectTransactionBlock
 * (a free, no-signature dry run). This lets the UI show the user's actual
 * held quantity for an exact oracle/strike/direction BEFORE they attempt a
 * redeem, instead of guessing a quantity and hitting EInsufficientPosition.
 */
export function buildPositionQueryTx(params: {
  managerId: string;
  oracleId: string;
  expiryAbsoluteMs: number;
  strike: number;
  isUp: boolean;
}): Transaction {
  const tx = new Transaction();
  const key = tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::market_key::new`,
    arguments: [
      tx.pure.id(params.oracleId),
      tx.pure.u64(params.expiryAbsoluteMs),
      tx.pure.u64(params.strike),
      tx.pure.bool(params.isUp),
    ],
  });
  tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::predict_manager::position`,
    arguments: [tx.object(params.managerId), key],
  });
  return tx;
}

/** Decodes a little-endian u64 from the raw BCS bytes devInspect returns. */
export function decodeU64FromBcs(bytes: number[]): number {
  let value = 0;
  for (let i = bytes.length - 1; i >= 0; i--) {
    value = value * 256 + bytes[i];
  }
  return value;
}

/**
 * Supplies dUSDC directly to the Predict vault and receives PLP shares.
 * Verified directly against predict::supply in predict.move — notably
 * simpler than mint/redeem: no PredictManager, no MarketKey, no oracle
 * involved at all, just the Predict object + a Coin<Quote> + the Clock.
 * Splits off only the requested amount from the source coin first, same
 * pattern as buildDepositTx, so the rest stays in the sender's wallet.
 */
export function buildSupplyTx(coinObjectId: string, amount: number, recipientAddress: string): Transaction {
  const tx = new Transaction();
  const [splitCoin] = tx.splitCoins(tx.object(coinObjectId), [tx.pure.u64(amount)]);
  const plpCoin = tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::predict::supply`,
    typeArguments: [QUOTE_ASSET_TYPE],
    arguments: [tx.object(PREDICT_OBJECT_ID), splitCoin, tx.object(SUI_CLOCK_OBJECT_ID)],
  });
  tx.transferObjects([plpCoin], tx.pure.address(recipientAddress));
  return tx;
}

/**
 * Burns PLP shares to withdraw the underlying dUSDC from the vault.
 * Verified directly against predict::withdraw in predict.move. Requires a
 * real Coin<PLP> object the sender owns — found via getCoins the same way
 * dUSDC coins are found elsewhere in this app.
 */
export function buildWithdrawLiquidityTx(
  plpCoinObjectId: string,
  recipientAddress: string,
): Transaction {
  const tx = new Transaction();
  const quoteCoin = tx.moveCall({
    target: `${PREDICT_PACKAGE_ID}::predict::withdraw`,
    typeArguments: [QUOTE_ASSET_TYPE],
    arguments: [tx.object(PREDICT_OBJECT_ID), tx.object(plpCoinObjectId), tx.object(SUI_CLOCK_OBJECT_ID)],
  });
  tx.transferObjects([quoteCoin], tx.pure.address(recipientAddress));
  return tx;
}