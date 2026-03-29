import { useMemo, useState } from 'react';
import Toggle from './Toggle.jsx';
import { getSegmentConfig } from '../scheduler.js';
import { POS_LABEL, DEFAULT_PLAYERS } from '../constants.js';

export default function InputView({
  playersText, setPlayersText,
  lockGK, setLockGK,
  onGenerate, onReorder, onGoSeason,
  seasonGameCount,
  onImport, importMsg,
}) {
  const [showRawText, setShowRawText] = useState(false);

  // Parse current active players
  const activePlayers = useMemo(() =>
    playersText.split('\n').map(l => l.trim()).filter(Boolean),
    [playersText]
  );
  
  // Build a Master Roster
  const masterRoster = useMemo(() => {
    const defaults = DEFAULT_PLAYERS.split('\n').map(l => l.trim());
    const allNames = [...defaults, ...activePlayers];
    return [...new Set(allNames)].filter(Boolean).sort();
  }, [activePlayers]);

  const count    = activePlayers.length;
  const benchSz  = count > 9 ? count - 9 : 0;
  const shortSz  = count < 9 ? 9 - count : 0;
  const MIN_PLAYERS = 7; // Adjust if your forfeit rule is different
  const isValid  = count >= MIN_PLAYERS && count <= 12;

  const config   = getSegmentConfig(count);

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

  const togglePlayer = (name) => {
    const isPlaying = activePlayers.includes(name);
    let newPlayers;
    if (isPlaying) {
      newPlayers = activePlayers.filter(p => p !== name);
    } else {
      newPlayers = [...activePlayers, name];
    }
    setPlayersText(newPlayers.join('\n'));
  };

  const badge = count < MIN_PLAYERS ? { text: `${count} · need ${MIN_PLAYERS - count} more`, bg: '#fee2e2', fg: '#b91c1c', border: '#f87171' }
              : count > 12          ? { text: `${count} · max 12`, bg: '#fef3c7', fg: '#b45309', border: '#92400e' }
              : count < 9           ? { text: `${count} players · short (${shortSz}) ⚠️`, bg: '#fffbeb', fg: '#b45309', border: '#f59e0b' }
              : { text: `${count} players${benchSz > 0 ? ` · ${benchSz} bench` : ' · full squad'} ✓`, bg: '#ecfdf5', fg: '#065f46', border: '#059669' };

  return (
    <div style={{ minHeight: '100vh', background: '#f0f6ff', fontFamily: "system-ui, sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 480, background: '#ffffff', borderRadius: 24, overflow: 'hidden', boxShadow: '0 20px 60px rgba(15,45,90,0.1)' }}>

        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg, #1d6fcf 0%, #0f2d5a 100%)', padding: '32px 28px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>⚽</div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: '#fff', letterSpacing: -0.5 }}>Match Setup</h1>
          <p style={{ margin: '8px 0 0', color: '#c7daf7', fontSize: 14, fontWeight: 600 }}>9v9 · 2 × 25 min · Rolling Subs</p>
        </div>

        <div style={{ padding: 24 }}>
          
          {/* Top Action Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
             <button onClick={onGoSeason} style={{ padding: '8px 16px', background: '#e2ecfc', border: 'none', borderRadius: 8, cursor: 'pointer', color: '#1d6fcf', fontSize: 14, fontWeight: 800 }}>
                📅 View Season ({seasonGameCount})
              </button>
              
              <label style={{ padding: '8px 16px', background: '#e2ecfc', border: 'none', borderRadius: 8, cursor: 'pointer', color: '#1d6fcf', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center' }}>
                📥 Import
                <input type="file" accept=".json" onChange={onImport} style={{ display: 'none' }} />
              </label>
          </div>

          {importMsg && (
            <div style={{ marginBottom: 16, padding: '12px', borderRadius: 10, background: importMsg.type === 'err' ? '#fee2e2' : '#ecfdf5', color: importMsg.type === 'err' ? '#b91c1c' : '#059669', fontSize: 14, fontWeight: 800, textAlign: 'center' }}>
              {importMsg.msg}
            </div>
          )}

          {/* Player count badge */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 16, borderBottom: '3px solid #e2ecfc' }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#0f2d5a', letterSpacing: 0.5 }}>TODAY'S SQUAD</div>
            <div style={{ fontSize: 14, fontWeight: 800, padding: '6px 14px', borderRadius: 999, background: badge.bg, color: badge.fg, border: `2px solid ${badge.border}` }}>
              {badge.text}
            </div>
          </div>

          {/* FAT FINGER ROSTER TOGGLES */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
            {masterRoster.map(name => {
              const isPlaying = activePlayers.includes(name);
              return (
                <button 
                  key={name}
                  onClick={() => togglePlayer(name)}
                  style={{
                    flex: '1 1 calc(33% - 10px)', minWidth: 100,
                    padding: '12px 8px', borderRadius: 12,
                    border: `3px solid ${isPlaying ? '#059669' : '#cbd5e1'}`,
                    background: isPlaying ? '#ecfdf5' : '#f8fafc',
                    color: isPlaying ? '#065f46' : '#64748b',
                    fontSize: 16, fontWeight: 800, cursor: 'pointer',
                    transition: 'all 0.1s',
                    boxShadow: isPlaying ? '0 4px 12px rgba(5,150,105,0.15)' : 'none'
                  }}
                >
                  {isPlaying ? '✅' : '❌'} {name}
                </button>
              );
            })}
          </div>

          {/* Hidden Raw Text Toggle for new players */}
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <button onClick={() => setShowRawText(!showRawText)} style={{ background: 'none', border: 'none', color: '#7a96b0', fontSize: 13, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
              {showRawText ? 'Hide Raw List' : '✏️ Add New Player / Edit Raw List'}
            </button>
          </div>

          {showRawText && (
             <textarea
              value={playersText}
              onChange={e => setPlayersText(e.target.value)}
              placeholder="One name per line..."
              rows={8}
              style={{ width: '100%', boxSizing: 'border-box', background: '#f8fafc', border: '3px solid #cbd5e1', borderRadius: 12, padding: '16px', color: '#0f2d5a', fontSize: 16, fontWeight: 600, lineHeight: 1.8, fontFamily: 'inherit', resize: 'vertical', outline: 'none', marginBottom: 20 }}
            />
          )}

          {/* GK toggle */}
          <div style={{ background: '#f8fafc', border: '3px solid #e2ecfc', borderRadius: 16, padding: '4px 8px', marginBottom: 16 }}>
            <Toggle
              value={lockGK}
              onChange={() => setLockGK(v => !v)}
              label="🧤 GK plays full game"
              sublabel={lockGK ? 'GK stays in goal all 50 min' : 'GK rotates to bench at half time'}
            />
          </div>

          {/* Game plan preview */}
          {isValid && (
            <div style={{ background: '#fffbeb', border: '3px solid #fcd34d', borderRadius: 16, padding: '16px', fontSize: 14, marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: '#b45309', letterSpacing: 1, marginBottom: 12 }}>GAME PLAN PREVIEW</div>
              {[
                ['🔄', 'Subs', benchSz === 0 ? 'No subs needed' : subTimes.join('  ·  ')],
                ['⚖️', 'Time', benchSz === 0 ? 'All play 50 min' : lockGK ? `GK: 50m · Others: ~${Math.round(400 / (count - 1))}m` : `~${Math.round(450 / count)}m each`],
              ].map(([icon, label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '2px solid #fde68a', gap: 8 }}>
                  <span style={{ color: '#92400e', fontWeight: 800 }}>{icon} {label}</span>
                  <span style={{ color: '#b45309', fontWeight: 700, textAlign: 'right' }}>{value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons - ONE SMART BUTTON */}
          <button
            onClick={() => {
              if (seasonGameCount > 0) {
                onReorder(); // Balances using history AND generates the board
              } else {
                onGenerate(); // Generates straight away (first game of season)
              }
            }}
            disabled={!isValid}
            style={{ width: '100%', padding: 20,
                     background: isValid ? '#1d6fcf' : '#e2ecfc',
                     border: isValid ? 'none' : '3px solid #cbd5e1',
                     borderRadius: 16, cursor: isValid ? 'pointer' : 'not-allowed',
                     color: isValid ? '#fff' : '#64748b', fontSize: 20, fontWeight: 900,
                     boxShadow: isValid ? '0 8px 24px rgba(29,111,207,0.3)' : 'none',
                     transition: 'all 0.2s' }}>
            {isValid 
              ? (seasonGameCount > 0 ? 'BALANCE & GENERATE BOARD →' : 'GENERATE TACTICAL BOARD →') 
              : `ADD ${MIN_PLAYERS - count} MORE PLAYERS`}
          </button>

        </div>
      </div>
    </div>
  );
}