/**
 * SwapPanel — the interactive list-based swap UI shown below the field.
 * Displays all ON FIELD positions + BENCH players; tapping two selects a swap.
 *
 * Props:
 *   assignment   – { GK, LB, … } for the current segment
 *   bench        – string[]  bench player names
 *   gkFullGame   – boolean   if true, GK row is locked (can't swap GK)
 *   onSwap       – ({ from, to }) => void
 */
import { useState } from 'react';
import { POSITIONS, POS_BG, POS_TEXT, POS_BORDER } from '../constants.js';

export default function SwapPanel({ assignment, bench, gkFullGame, onSwap }) {
  const [selected, setSelected] = useState(null);

  const handlePosition = (pos) => {
    if (pos === 'GK' && gkFullGame) return; // locked
    if (!selected) {
      setSelected({ type: 'pos', pos, name: assignment[pos] });
      return;
    }
    if (selected.type === 'pos' && selected.pos === pos) {
      setSelected(null); // deselect
      return;
    }
    onSwap({ from: selected, to: { type: 'pos', pos, name: assignment[pos] } });
    setSelected(null);
  };

  const handleBench = (name) => {
    if (!selected) {
      setSelected({ type: 'bench', name });
      return;
    }
    if (selected.type === 'bench' && selected.name === name) {
      setSelected(null); // deselect
      return;
    }
    if (selected.type === 'bench') {
      // bench-to-bench swap: just re-select the new one
      setSelected({ type: 'bench', name });
      return;
    }
    onSwap({ from: selected, to: { type: 'bench', name } });
    setSelected(null);
  };

  const isSelPos   = pos  => selected?.type === 'pos'   && selected.pos  === pos;
  const isSelBench = name => selected?.type === 'bench' && selected.name === name;
  const isTarget   = pos  => !!selected && !(pos === 'GK' && gkFullGame) &&
                             !(selected.type === 'pos' && selected.pos === pos);

  return (
    <div>
      {/* Status bar */}
      <div style={{
        marginBottom: 10, padding: '8px 12px', borderRadius: 8,
        background: selected ? '#ddeeff' : '#f5f9ff',
        border: `1px solid ${selected ? '#1d6fcf' : '#c7daf7'}`,
        fontSize: 12, color: selected ? '#1d6fcf' : '#4a6b8a',
        display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s',
      }}>
        {selected ? (
          <>
            <span style={{ fontSize: 15 }}>👆</span>
            <span>
              <strong style={{ color: '#1d6fcf' }}>
                {selected.type === 'pos'
                  ? `${selected.pos} — ${selected.name || 'empty'}`
                  : `${selected.name} (bench)`}
              </strong>
              {' '}selected — tap another spot to swap
            </span>
            <button
              onClick={() => setSelected(null)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none',
                       color: '#4a6b8a', cursor: 'pointer', fontSize: 15, padding: 0 }}
            >✕</button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 15 }}>✏️</span>
            <span>Tap any player or position to start a swap</span>
          </>
        )}
      </div>

      {/* Grid: ON FIELD list + BENCH list */}
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, alignItems: 'start' }}>

        {/* ON FIELD */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#4a6b8a',
                        letterSpacing: 1, marginBottom: 8 }}>ON FIELD</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {POSITIONS.map(pos => {
              const name    = assignment[pos];
              const locked  = pos === 'GK' && gkFullGame;
              const sel     = isSelPos(pos);
              const tgt     = isTarget(pos);
              const bg      = POS_BG[pos]     || '#4a6b8a';
              const fg      = POS_TEXT[pos]   || '#fff';
              const bdr     = POS_BORDER[pos] || '#c7daf7';

              return (
                <div
                  key={pos}
                  onClick={() => !locked && handlePosition(pos)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    background: sel ? '#ddeeff' : tgt ? '#d6f0e8' : '#ffffff',
                    border: `2px solid ${sel ? '#1d6fcf' : tgt ? '#059669' : '#c7daf7'}`,
                    borderRadius: 8, padding: '6px 9px',
                    cursor: locked ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s', opacity: locked ? 0.5 : 1,
                  }}
                >
                  {/* Position badge */}
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: bg, border: `1.5px solid ${bdr}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 8, fontWeight: 800, color: fg,
                  }}>
                    {pos}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600,
                                 color: sel ? '#1558b0' : tgt ? '#065f46' : '#0f2d5a',
                                 flex: 1, minWidth: 0,
                                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name || '—'}
                  </span>
                  {locked && (
                    <span style={{ fontSize: 9, color: '#7a96b0' }}>🔒</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* BENCH */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#4a6b8a',
                        letterSpacing: 1, marginBottom: 8 }}>BENCH</div>
          {bench.length === 0 ? (
            <div style={{ fontSize: 12, color: '#7a96b0', padding: '6px 0' }}>
              No bench this game
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {bench.map(name => {
                const sel = isSelBench(name);
                const tgt = !!selected && !sel;
                return (
                  <div
                    key={name}
                    onClick={() => handleBench(name)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      background: sel ? '#ddeeff' : tgt ? '#d6f0e8' : '#fef3c7',
                      border: `2px solid ${sel ? '#1d6fcf' : tgt ? '#059669' : '#fcd34d'}`,
                      borderRadius: 8, padding: '6px 9px', cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                      background: '#fde68a', border: '1.5px solid #f59e0b',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 800, color: '#92400e',
                    }}>
                      SUB
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600,
                                   color: sel ? '#1558b0' : '#92400e', flex: 1 }}>
                      {name}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
