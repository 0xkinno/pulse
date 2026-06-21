// Time-travel slider data source for the SVI surface.
//
// IMPORTANT — rather than depend on the indexed server's /oracles/:id/svi
// history endpoint (whose exact response shape was never directly verified
// — the same category of unverified-shape risk that caused real bugs
// earlier in this project), this keeps a ROLLING CLIENT-SIDE HISTORY of the
// surface snapshots usePulseFeed already polls every 4 seconds. This means
// the time-travel slider works immediately with zero new network
// dependencies, using only data already proven to load correctly.
//
// Tradeoff, stated plainly: history only goes as far back as this browser
// tab has been open polling the feed — it is NOT a query against the
// server's full historical record. That's an honest, smaller, but
// guaranteed-correct feature instead of a bigger feature built on an
// unverified endpoint shape.

import { useEffect, useRef, useState } from 'react';
import type { SurfaceSlice } from '../lib/svi';

export interface SurfaceSnapshot {
  timestampMs: number;
  slices: SurfaceSlice[];
}

const MAX_SNAPSHOTS = 60; // ~4 minutes of history at the existing 4s poll interval

export function useSurfaceHistory(currentSlices: SurfaceSlice[]) {
  const [history, setHistory] = useState<SurfaceSnapshot[]>([]);
  const lastSlicesRef = useRef<string>('');

  useEffect(() => {
    if (currentSlices.length === 0) return;
    const fingerprint = JSON.stringify(currentSlices);
    if (fingerprint === lastSlicesRef.current) return; // avoid duplicate snapshots on identical ticks
    lastSlicesRef.current = fingerprint;

    setHistory((prev) => {
      const next = [...prev, { timestampMs: Date.now(), slices: currentSlices }];
      return next.slice(-MAX_SNAPSHOTS);
    });
  }, [currentSlices]);

  return history;
}