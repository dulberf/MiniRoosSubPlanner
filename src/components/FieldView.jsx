/**
 * FieldView — the green pitch diagram with player tokens.
 *
 * Props:
 *   assignment    – { GK: name, LB: name, … }
 *   highlight     – player name to highlight (yellow), or null
 *   swapFrom      – { type, pos?, name } | null  — currently selected for swap
 *   onPlayerClick – (name, pos) => void, or null for read-only
 */
import { useState, useEffect } from 'react';
import FieldSVG    from './FieldSVG.jsx';
import PlayerToken from './PlayerToken.jsx';
import { FIELD_LAYOUT } from '../constants.js';

function useTokenSize() {
  const [size, setSize] = useState(() =>
    Math.min(120, Math.max(40, Math.round(window.innerWidth * 0.085)))
  );
  useEffect(() => {
    const update = () =>
      setSize(Math.min(120, Math.max(40, Math.round(window.innerWidth * 0.085))));
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}

export default function FieldView({ assignment, highlight, swapFrom, onPlayerClick }) {
  const tokenSize = useTokenSize();

  return (
    <div style={{
      position: 'relative', width: '100%', paddingBottom: '148%',
      background: 'linear-gradient(180deg, #2d7a3a 0%, #3a8f48 30%, #2d7a3a 60%, #3a8f48 85%, #2d7a3a 100%)',
      borderRadius: 14, overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(15,45,90,0.18)',
      border: '3px solid rgba(29,111,207,0.25)',
    }}>
      {/* Grass stripes */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'repeating-linear-gradient(180deg, transparent, transparent 18px, rgba(0,0,0,0.06) 18px, rgba(0,0,0,0.06) 36px)',
        pointerEvents: 'none',
      }} />

      <FieldSVG />

      {/* Attack label */}
      <div style={{
        position: 'absolute', left: '50%', top: '1.5%',
        transform: 'translateX(-50%)',
        fontSize: 8, fontWeight: 700,
        color: 'rgba(255,255,255,0.35)', letterSpacing: 2,
        pointerEvents: 'none',
      }}>
        ▲ ATTACK
      </div>

      {FIELD_LAYOUT.map(({ pos, x, y }) => {
        const name = assignment[pos];

        // Determine swap highlight state
        let isSel = false;
        let isTgt = false;
        if (swapFrom) {
          if (swapFrom.type === 'pos' && swapFrom.pos === pos) {
            isSel = true;
          } else {
            isTgt = true; // every other position is a valid target
          }
        }

        return (
          <div
            key={pos}
            style={{
              position: 'absolute',
              left: `${x}%`, top: `${y}%`,
              transform: 'translate(-50%, -50%)',
              zIndex: 10,
            }}
          >
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
        );
      })}
    </div>
  );
}
