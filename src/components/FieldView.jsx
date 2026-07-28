import { useState, useEffect, useRef, useCallback } from 'react';
import FieldSVG    from './FieldSVG.jsx';
import PlayerToken from './PlayerToken.jsx';
import { FIELD_LAYOUT, UI } from '../constants.js';

// Session 13: the pitch is now sized from the AVAILABLE HEIGHT (aspectRatio +
// flex) rather than `paddingBottom: 148%`, which is width-driven and overflowed
// the new pitch/rail split. Token size therefore has to measure the rendered
// box, not assume it from the container width.
function calcSize(w, scale) {
  const cap   = Math.round(124 * scale);
  const floor = Math.round(96 * scale);
  return Math.min(cap, Math.max(Math.min(floor, Math.round(w * 0.24)), Math.round(w * 0.21)));
}

export default function FieldView({
  assignment, highlight, swapFrom, onPlayerClick,
  upcomingSubs = [], orientation = 'vertical',
  subCountdown = null, scale = 1,
}) {
  const containerRef = useRef(null);
  const [tokenSize, setTokenSize] = useState(Math.round(96 * scale));

  const measure = useCallback(() => {
    if (containerRef.current) setTokenSize(calcSize(containerRef.current.offsetWidth, scale));
  }, [scale]);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure]);

  // Handle the 'Presentation Mode' flip
  const getCoordinates = (x, y) => {
    if (orientation === 'horizontal-right') return { left: `${y}%`, top: `${100 - x}%` };
    if (orientation === 'horizontal-left') return { left: `${100 - y}%`, top: `${x}%` };
    return { left: `${x}%`, top: `${y}%` }; // default vertical
  };

  const isVertical = orientation === 'vertical';

  return (
    <div ref={containerRef} style={{
      position: 'relative',
      flex: 1, minHeight: 0,
      aspectRatio: isVertical ? '100 / 148' : '148 / 100',
      width: 'auto', maxWidth: '100%', margin: '0 auto',
      // Flat fill — the old 5-stop gradient reduced token contrast in sun.
      background: UI.pitch,
      borderRadius: Math.round(16 * scale),
      overflow: 'hidden',
      border: `${Math.max(2, Math.round(3 * scale))}px solid ${UI.navy}`,
      boxSizing: 'border-box',
    }}>
      <FieldSVG orientation={orientation} />

      {FIELD_LAYOUT.map(({ pos, x, y }) => {
        const name    = assignment[pos];
        const subInfo = upcomingSubs.find(s => s.pos === pos) || null;

        let isSel = false;
        let isTgt = false;
        if (swapFrom) {
          if (swapFrom.type === 'pos' && swapFrom.pos === pos) isSel = true;
          else isTgt = true;
        }

        const coords = getCoordinates(x, y);

        return (
          <div
            key={pos}
            style={{
              position: 'absolute',
              ...coords,
              transform: 'translate(-50%, -50%)',
              zIndex: subInfo ? 12 : 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}
          >
            <PlayerToken
              pos={pos}
              name={name}
              isHL={!swapFrom && !!(highlight && highlight === name)}
              isSel={isSel}
              isTgt={isTgt}
              isNextChange={!!subInfo}
              onClick={name && onPlayerClick ? () => onPlayerClick(name, pos) : null}
              size={tokenSize}
            />

            {/* Outgoing player badge — replaces the old dashed ring + "IN: name".
                The incoming player is named in the bench rail instead, which
                keeps the pitch readable. */}
            {subInfo && (
              <div style={{
                position: 'absolute', bottom: Math.round(-13 * scale),
                background: UI.stop, color: '#fff',
                borderRadius: Math.round(7 * scale),
                padding: `${Math.round(2 * scale)}px ${Math.round(10 * scale)}px`,
                fontSize: Math.max(12, Math.round(17 * scale)),
                fontWeight: 900, whiteSpace: 'nowrap', zIndex: 30,
                fontVariantNumeric: 'tabular-nums',
              }}>
                ▼ OFF{subCountdown ? ` ${subCountdown}` : ''}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
