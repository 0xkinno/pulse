import { useEffect, useRef, useState } from 'react';

export interface KeeperEvent {
  id: string;
  timestamp: number;
  managerShort: string;
  oracleLabel: string;
  payout: number;
  tip: number;
  txDigestShort: string;
}

const MANAGER_PREFIXES = ['0x4a2f', '0x91cd', '0x0e87', '0x6bf3', '0xa204', '0xd71e', '0x39a8'];
const ORACLE_LABELS = ['BTC-15m', 'BTC-1h', 'BTC-4h', 'BTC-1d'];

function randomHex(len: number) {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function makeEvent(): KeeperEvent {
  const payout = Math.round((50 + Math.random() * 2200) * 100) / 100;
  return {
    id: `${Date.now()}-${Math.random()}`,
    timestamp: Date.now(),
    managerShort: `${MANAGER_PREFIXES[Math.floor(Math.random() * MANAGER_PREFIXES.length)]}…${randomHex(4)}`,
    oracleLabel: ORACLE_LABELS[Math.floor(Math.random() * ORACLE_LABELS.length)],
    payout,
    tip: Math.round(payout * 0.015 * 100) / 100,
    txDigestShort: `${randomHex(6)}…${randomHex(4)}`,
  };
}

/** Simulates a Settled-Redeem Keeper watching for un-redeemed positions and claiming payouts. */
export function useKeeperFeed(maxEvents = 8) {
  const [events, setEvents] = useState<KeeperEvent[]>(() => [makeEvent(), makeEvent()]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function scheduleNext() {
      const delay = 3500 + Math.random() * 6000;
      timeoutRef.current = setTimeout(() => {
        setEvents((prev) => [makeEvent(), ...prev].slice(0, maxEvents));
        scheduleNext();
      }, delay);
    }
    scheduleNext();
    return () => clearTimeout(timeoutRef.current);
  }, [maxEvents]);

  return events;
}
