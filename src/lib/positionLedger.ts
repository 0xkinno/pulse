// Records exactly which oracle a position was minted against, keyed by
// wallet address, in localStorage. This exists because the live oracle list
// (sorted by soonest-expiry) reassigns which REAL oracle object sits in a
// given UI slot ("BTC-30m" etc.) every few seconds as the server activates
// new rolling sub-hour markets — minting against "the oracle currently shown
// as BTC-30m" and later trying to redeem against "whatever is currently
// shown as BTC-30m" silently checks two DIFFERENT on-chain oracle objects.
// That mismatch is what caused "you hold no position" even after a real,
// successful mint — the position was real, the redeem was just checking the
// wrong oracle.
//
// This ledger makes the oracle identity sticky: once you mint, the exact
// oracle_id/expiry/strike/direction you used is remembered, independent of
// whatever later reshuffles into that same list position.

export interface OpenPosition {
    oracleId: string;
    underlying: string;
    expiryLabel: string; // label AT MINT TIME, for display only — not used for any on-chain call
    expiryAbsoluteMs: number;
    strike: number; // on-chain units (already scaled)
    isUp: boolean;
    quantity: number; // on-chain units (already scaled)
    mintedAtMs: number;
    txDigest: string;
  }
  
  function storageKey(address: string) {
    return `pulse:positions:${address}`;
  }
  
  export function recordPosition(address: string, position: OpenPosition) {
    const existing = loadPositions(address);
    existing.push(position);
    window.localStorage.setItem(storageKey(address), JSON.stringify(existing));
  }
  
  export function loadPositions(address: string): OpenPosition[] {
    try {
      const raw = window.localStorage.getItem(storageKey(address));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  
  export function removePosition(address: string, txDigest: string) {
    const existing = loadPositions(address).filter((p) => p.txDigest !== txDigest);
    window.localStorage.setItem(storageKey(address), JSON.stringify(existing));
  }