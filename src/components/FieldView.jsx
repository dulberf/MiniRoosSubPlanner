import { useState, useEffect, useRef, useCallback } from 'react';
import FieldSVG    from './FieldSVG.jsx';
import PlayerToken from './PlayerToken.jsx';
import { FIELD_LAYOUT } from '../constants.js';

function calcSize(w) {
  // Increased base token size by ~20% for fat-finger friendliness
  return Math.min(120, Math.max(50, Math.round(w * 0.24)));
}

export default function FieldView({ assignment, highlight, swapFrom, onPlayerClick, upcomingSubs = [], orientation = 'vertical' }) {
  const containerRef = useRef(null);
  const [tokenSize, setTokenSize] = useState(50);

  const measure = useCallback(() => {
    if (containerRef.current) setTokenSize(calcSize(containerRef.current.offsetWidth));
  }, []);

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

  return (
    <div ref={containerRef} style={{
      position: 'relative', width: '100%', 
      paddingBottom: orientation === 'vertical' ? '148%' : '65%', // Adjust aspect ratio for horizontal
      background: 'linear-gradient(180deg, #2d7a3a 0%, #3a8f48 30%, #2d7a3a 60%, #3a8f48 85%, #2d7a3a 100%)',
      borderRadius: 14, overflow: 'hidden',
      border: '4px solid #ffffff',
    }}>
      <FieldSVG />

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
              zIndex: 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}
          >
            {/* Dashed Red Border for outgoing player wrapper */}
            <div style={{
              padding: subInfo ? 4 : 0,
              border: subInfo ? '4px dashed #dc2626' : 'none',
              borderRadius: '50%',
              transition: 'all 0.2s ease',
            }}>
              <PlayerToken
                pos={pos}
                name={name}
                isHL={!swapFrom && !!(highlight && highlight === name)}
                isSel={isSel}
                isTgt={isTgt}
                onClick={name && onPlayerClick ? () => onPlayerClick(name, pos) : null}
                size={tokenSize}
              />
            </div>
            
            {/* Ghost Sub "▲ IN" Badge */}
            {subInfo && (
              <div style={{
                position: 'absolute', bottom: -12,
                background: '#059669', color: '#fff',
                border: '3px solid #fff', borderRadius: 12, 
                padding: '2px 10px',
                fontSize: Math.max(10, Math.round(tokenSize * 0.18)),
                fontWeight: 900, whiteSpace: 'nowrap', zIndex: 30,
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}>
                ▲ IN: {subInfo.on}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}