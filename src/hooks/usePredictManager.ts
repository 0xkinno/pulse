// Tracks the connected wallet's PredictManager object across the session.
// PredictManager is a SHARED object created once via predict::create_manager
// — after creation, its address must be looked up from the transaction
// effects and reused for every future deposit/mint/redeem call. This hook
// persists that address in localStorage per-address so the user doesn't have
// to re-create a manager every time they reload the page.

import { useCallback, useEffect, useState } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { buildCreateManagerTx } from '../lib/predictTx';
import { PREDICT_PACKAGE_ID } from '../lib/constants';

function storageKey(address: string) {
  return `pulse:predict-manager:${address}`;
}

export type ManagerStatus = 'idle' | 'checking' | 'creating' | 'ready' | 'error';

export function usePredictManager() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [managerId, setManagerId] = useState<string | null>(null);
  const [status, setStatus] = useState<ManagerStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Restore a previously-created manager id for this address from storage.
  useEffect(() => {
    if (!account) {
      setManagerId(null);
      setStatus('idle');
      return;
    }
    const cached = window.localStorage.getItem(storageKey(account.address));
    setManagerId(cached);
    setStatus(cached ? 'ready' : 'idle');
  }, [account?.address]);

  const createManager = useCallback(async () => {
    if (!account) return null;
    setStatus('creating');
    setError(null);
    try {
      const tx = buildCreateManagerTx();
      const result = await signAndExecute({ transaction: tx });

      // Look up the transaction effects to find the newly-shared PredictManager.
      const full = await client.getTransactionBlock({
        digest: result.digest,
        options: { showEffects: true, showObjectChanges: true },
      });

      const created = full.objectChanges?.find(
        (c) =>
          c.type === 'created' &&
          'objectType' in c &&
          c.objectType.includes(`${PREDICT_PACKAGE_ID}::predict_manager::PredictManager`),
      );

      const newManagerId =
        created && 'objectId' in created ? created.objectId : null;

      if (!newManagerId) {
        throw new Error(
          'Manager created but its object id could not be found in transaction effects — check the explorer for this digest: ' +
            result.digest,
        );
      }

      window.localStorage.setItem(storageKey(account.address), newManagerId);
      setManagerId(newManagerId);
      setStatus('ready');
      return newManagerId;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create PredictManager');
      setStatus('error');
      return null;
    }
  }, [account, client, signAndExecute]);

  const forgetManager = useCallback(() => {
    if (!account) return;
    window.localStorage.removeItem(storageKey(account.address));
    setManagerId(null);
    setStatus('idle');
  }, [account]);

  return { managerId, status, error, createManager, forgetManager };
}