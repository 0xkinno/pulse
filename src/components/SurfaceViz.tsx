import { useEffect, useMemo, useRef, useState } from 'react';
import { impliedVolFromVariance, sviTotalVariance, type SurfaceSlice } from '../lib/svi';

interface SurfaceVizProps {
  slices: SurfaceSlice[];
  highlightViolations?: boolean;
  violationCount: number;
}

const K_STEPS = 28;
const K_RANGE = 0.55;
const WIDTH = 920;
const HEIGHT = 420;
const PAD_X = 60;
const PAD_Y = 50;

function buildGridPoints(slices: SurfaceSlice[]) {
  const kValues: number[] = [];
  for (let i = 0; i <= K_STEPS; i++) {
    kValues.push(-K_RANGE + (2 * K_RANGE * i) / K_STEPS);
  }

  return slices.map((slice, sliceIdx) => {
    const tYears = slice.expirySeconds / (365 * 24 * 3600);
    const points = kValues.map((k) => {
      const w = sviTotalVariance(k, slice.params);
      const iv = impliedVolFromVariance(w, tYears);
      return { k, iv };
    });
    return { slice, sliceIdx, points };
  });
}

/** Projects (k, expiryIndex, iv) into isometric-ish 2D screen space. */
function project(k: number, sliceIdx: number, sliceCount: number, iv: number, ivMax: number) {
  const xNorm = (k + K_RANGE) / (2 * K_RANGE); // 0..1
  const depthNorm = sliceCount <= 1 ? 0 : sliceIdx / (sliceCount - 1); // 0..1, front to back
  const ivNorm = ivMax > 0 ? iv / ivMax : 0;

  const depthShiftX = depthNorm * 70;
  const depthShiftY = depthNorm * 46;

  const x = PAD_X + xNorm * (WIDTH - PAD_X * 2 - 90) + depthShiftX;
  const y = HEIGHT - PAD_Y - ivNorm * (HEIGHT - PAD_Y * 2 - 60) - depthShiftY;

  return { x, y };
}

export function SurfaceViz({ slices, violationCount }: SurfaceVizProps) {
  const [pulsePhase, setPulsePhase] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let start: number | null = null;
    function frame(t: number) {
      if (start === null) start = t;
      setPulsePhase((t - start) / 1000);
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const ribbons = useMemo(() => buildGridPoints(slices), [slices]);

  const ivMax = useMemo(() => {
    let max = 0.01;
    ribbons.forEach((r) => r.points.forEach((p) => (max = Math.max(max, p.iv))));
    return max * 1.12;
  }, [ribbons]);

  const isDanger = violationCount > 0;
  const lineColor = isDanger ? 'var(--pulse-amber)' : 'var(--pulse-cyan)';
  const glowColor = isDanger ? 'var(--pulse-amber-glow)' : 'var(--pulse-glow)';

  return (
    <div className="surface-viz">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height="100%"
        role="img"
        aria-label="Live implied volatility surface across strikes and expiries"
      >
        <defs>
          <linearGradient id="ribbonFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.95" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.15" />
          </linearGradient>
          <filter id="ribbonGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1={PAD_X}
            y1={HEIGHT - PAD_Y - g * (HEIGHT - PAD_Y * 2 - 60)}
            x2={WIDTH - PAD_X}
            y2={HEIGHT - PAD_Y - g * (HEIGHT - PAD_Y * 2 - 60) - 46}
            stroke="rgba(93,173,255,0.07)"
            strokeWidth="1"
          />
        ))}

        {ribbons.slice(0, -1).map((ribbon, ri) => {
          const next = ribbons[ri + 1];
          return ribbon.points.map((pt, pi) => {
            if (pi % 4 !== 0) return null;
            const nextPt = next.points[pi];
            const a = project(pt.k, ribbon.sliceIdx, ribbons.length, pt.iv, ivMax);
            const b = project(nextPt.k, next.sliceIdx, ribbons.length, nextPt.iv, ivMax);
            return (
              <line
                key={`cross-${ri}-${pi}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="rgba(93,173,255,0.10)"
                strokeWidth="1"
              />
            );
          });
        })}

        {[...ribbons].reverse().map((ribbon) => {
          const pathD = ribbon.points
            .map((pt, i) => {
              const { x, y } = project(pt.k, ribbon.sliceIdx, ribbons.length, pt.iv, ivMax);
              return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(' ');

          const pulseOpacity = 0.55 + 0.25 * Math.sin(pulsePhase * 1.6 + ribbon.sliceIdx * 1.1);

          return (
            <g key={ribbon.slice.expiryLabel}>
              <path
                d={pathD}
                fill="none"
                stroke="url(#ribbonFade)"
                strokeWidth={2.4}
                filter="url(#ribbonGlow)"
                opacity={pulseOpacity}
              />
              {(() => {
                const last = ribbon.points[ribbon.points.length - 1];
                const { x, y } = project(last.k, ribbon.sliceIdx, ribbons.length, last.iv, ivMax);
                return (
                  <text x={x + 10} y={y + 4} className="mono" fontSize="11" fill="var(--pulse-text-secondary)">
                    {ribbon.slice.expiryLabel}
                  </text>
                );
              })()}
            </g>
          );
        })}

        <text x={PAD_X} y={HEIGHT - 14} className="mono" fontSize="10" fill="var(--pulse-text-dim)">
          ITM ← log-moneyness (k) → OTM
        </text>
        <text
          x={14}
          y={PAD_Y - 10}
          className="mono"
          fontSize="10"
          fill="var(--pulse-text-dim)"
          transform={`rotate(-90 14 ${PAD_Y - 10})`}
        >
          implied vol
        </text>
      </svg>

      <div className={`surface-viz__badge ${isDanger ? 'surface-viz__badge--danger' : ''}`}>
        <span className="pulse-dot" style={{ background: lineColor, boxShadow: `0 0 12px ${glowColor}` }} />
        {isDanger ? `${violationCount} arb violation${violationCount > 1 ? 's' : ''} flagged` : 'Surface arb-free'}
      </div>
    </div>
  );
}
