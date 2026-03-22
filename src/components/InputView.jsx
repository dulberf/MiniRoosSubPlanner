/**
 * InputView — the setup screen where the coach enters player names and
 * configures the game before generating a team sheet.
 *
 * Props:
 *   playersText      – string  textarea value
 *   setPlayersText   – setter
 *   lockGK           – boolean
 *   setLockGK        – setter
 *   onGenerate       – () => void
 *   onReorder        – () => void
 *   onGoSeason       – () => void
 *   seasonGameCount  – number
 *   onImport         – (event) => void
 *   importMsg        – { type, msg } | null
 */
import { useMemo } from 'react';
import Toggle from './Toggle.jsx';
import { getSegmentConfig } from '../scheduler.js';
import { POS_LABEL } from '../constants.js';

export default function InputView({
  playersText, setPlayersText,
  lockGK, setLockGK,
  onGenerate, onReorder, onGoSeason,
  seasonGameCount,
  onImport, importMsg,
}) {
  const players  = useMemo(() =>
    playersText.split('\n').map(l => l.trim()).filter(Boolean),
    [playersText]
  );
  const count    = players.length;
  const benchSz  = count - 9;
  const config   = getSegmentConfig(count);
  const isValid  = count >= 9 && count <= 12;

  // Sub window times
  const subTimes = useMemo(() => {
    if (!config || benchSz === 0) return [];
    const times = [];
    let t = 0;
    config.durs.forEach((d, i) => {
      if (i > 0) times.push(t === 25 ? 'HT(25)' : `${t}min`);
      t += d;
    });
    return times;
  }, [config, benchSz]);

  // Player count badge
  const badge = count < 9  ? { text: `${count} · need ${9 - count} more`, bg: '#fee2e2', fg: '#b91c1c', border: '#f87171' }
              : count > 12 ? { text: `${count} · max 12`,                   bg: '#fef3c7', fg: '#b45309', border: '#92400e' }
              : { text: `${count} players${benchSz > 0 ? ` · ${benchSz} bench` : ' · full squad'} ✓`,
                  bg: '#ecfdf5', fg: '#065f46', border: '#059669' };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 50% 0%, #d6e8ff 0%, #f0f6ff 70%)',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 440, background: '#ffffff',
                    borderRadius: 24, overflow: 'hidden',
                    boxShadow: '0 32px 80px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)' }}>

        {/* Header */}
        <div style={{ background: 'linear-gradient(160deg, #1d6fcf 0%, #1558b0 60%, #1d6fcf 100%)',
                      padding: '30px 28px 22px', textAlign: 'center' }}>
          <div style={{ fontSize: 42, marginBottom: 6 }}>⚽</div>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800, color: '#fff', letterSpacing: -0.5 }}>
            Team Sheet Planner
          </h1>
          <p style={{ margin: '6px 0 0', color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
            9v9 · 2 × 25 min · Every player gets a rest
          </p>
        </div>

        <div style={{ padding: 24 }}>
          {/* Player count badge + label */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#4a6b8a', letterSpacing: 1 }}>
              PLAYERS — ONE PER LINE
            </label>
            <div style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px',
                          borderRadius: 999, background: badge.bg, color: badge.fg,
                          border: `1px solid ${badge.border}` }}>
              {badge.text}
            </div>
          </div>

          {/* Textarea */}
          <textarea
            value={playersText}
            onChange={e => setPlayersText(e.target.value)}
            placeholder="One name per line..."
            rows={12}
            style={{ width: '100%', boxSizing: 'border-box', background: '#ffffff',
                     border: '1.5px solid #c7daf7', borderRadius: 12,
                     padding: '14px 16px', color: '#0f2d5a', fontSize: 15,
                     lineHeight: 2.1, fontFamily: 'inherit', resize: 'vertical', outline: 'none' }}
          />

          <div style={{ height: 12 }} />

          {/* GK toggle */}
          <Toggle
            value={lockGK}
            onChange={() => setLockGK(v => !v)}
            label="🧤 GK plays full game"
            sublabel={lockGK
              ? 'First player stays in goal all 50 min — does NOT rotate to bench'
              : 'GK rotates to bench at half time, another player takes over in goal'}
          />

          {/* Game plan preview (shown when squad size is valid) */}
          {isValid && (
            <div style={{ marginTop: 12, background: '#ffffff', border: '1px solid #c7daf7',
                          borderRadius: 12, padding: '12px 14px', fontSize: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#4a6b8a',
                            letterSpacing: 1, marginBottom: 10 }}>GAME PLAN PREVIEW</div>
              {[
                ['📐', 'Formation',  'GK · LB CB RB · LM CM RM · LF RF'],
                ['🔄', 'Sub windows', benchSz === 0
                  ? 'No subs needed'
                  : subTimes.join('  ·  ')],
                ['⏱',  'Segments',   benchSz === 0
                  ? 'Full game, no breaks'
                  : `${config.durs.length} periods (${config.durs.join(', ')} min)`],
                ['🧤', 'GK',         lockGK
                  ? 'Full 50 min in goal'
                  : 'Rotates to bench at half time'],
                ['⚖️', 'Field time', benchSz === 0
                  ? 'All play 50 min'
                  : lockGK
                  ? `GK: 50 min · Others: ~${Math.round(400 / (count - 1))} min`
                  : `~${Math.round(450 / count)} min each · all get a bench rest`],
              ].map(([icon, label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between',
                                          padding: '3px 0', borderBottom: '1px solid #e2ecfc', gap: 8 }}>
                  <span style={{ color: '#4a6b8a', flexShrink: 0 }}>{icon} {label}</span>
                  <span style={{ color: '#4a6b8a', fontWeight: 600, textAlign: 'right' }}>{value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Season-smart reorder button */}
          {seasonGameCount > 0 && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10,
                          background: '#ffffff', border: '1px solid #ddeeff',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#1d6fcf' }}>
                  🔀 Season-smart order
                </div>
                <div style={{ fontSize: 10, color: '#4a6b8a', marginTop: 1 }}>
                  Reorder players so GK &amp; positions rotate fairly based on {seasonGameCount} saved game{seasonGameCount !== 1 ? 's' : ''}
                </div>
              </div>
              <button onClick={onReorder}
                style={{ padding: '8px 14px', background: '#ddeeff', border: '1px solid #1d6fcf',
                         borderRadius: 8, cursor: 'pointer', color: '#1d6fcf',
                         fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
                🔀 Reorder
              </button>
            </div>
          )}

          {/* Import message */}
          {importMsg && (
            <div style={{ marginBottom: 8, padding: '10px 14px', borderRadius: 10,
                          background: importMsg.type === 'err' ? '#fee2e2' : '#ecfdf5',
                          border: `1px solid ${importMsg.type === 'err' ? '#f87171' : '#059669'}`,
                          color: importMsg.type === 'err' ? '#b91c1c' : '#059669',
                          fontSize: 13, fontWeight: 700, textAlign: 'center' }}>
              {importMsg.msg}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              onClick={onGenerate}
              disabled={!isValid}
              style={{ flex: 1, padding: 15,
                       background: isValid ? 'linear-gradient(135deg, #1558b0, #1d6fcf)' : '#ddeeff',
                       border: isValid ? 'none' : '1px solid #c7daf7',
                       borderRadius: 12, cursor: isValid ? 'pointer' : 'not-allowed',
                       color: isValid ? '#fff' : '#7a96b0', fontSize: 16, fontWeight: 700,
                       boxShadow: isValid ? '0 4px 20px rgba(21,88,176,0.3)' : 'none',
                       transition: 'all 0.2s' }}>
              {isValid ? 'Generate Team Sheet →' : `Add ${9 - count} more player${9 - count !== 1 ? 's' : ''} to continue`}
            </button>

            {seasonGameCount > 0 && (
              <button onClick={onGoSeason}
                style={{ padding: '15px 14px', background: '#ffffff',
                         border: '1px solid #059669', borderRadius: 12,
                         cursor: 'pointer', color: '#059669', fontSize: 13, fontWeight: 700 }}>
                📅 {seasonGameCount}
              </button>
            )}

            <label style={{ padding: '15px 14px', background: '#ffffff',
                            border: '1px solid #1d6fcf', borderRadius: 12,
                            cursor: 'pointer', color: '#1d6fcf', fontSize: 13,
                            fontWeight: 700, display: 'flex', alignItems: 'center' }}>
              📥
              <input type="file" accept=".json" onChange={onImport} style={{ display: 'none' }} />
            </label>
          </div>

          {/* Position guide */}
          <div style={{ marginTop: 16, background: '#f5f9ff', borderRadius: 12,
                        padding: '12px 14px', border: '1px solid #e2ecfc' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#4a6b8a',
                          letterSpacing: 1, marginBottom: 8 }}>POSITION GUIDE</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {Object.entries(POS_LABEL).map(([pos, label]) => (
                <div key={pos} style={{ fontSize: 11, color: '#4a6b8a' }}>
                  <span style={{ fontWeight: 700, color: '#0f2d5a' }}>{pos}</span> — {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
