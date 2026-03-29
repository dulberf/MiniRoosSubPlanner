import { useState, useMemo, useEffect } from 'react';
import FieldView from './FieldView.jsx';
import { calcStats } from '../scheduler.js';
import { POSITIONS, POS_BG, POS_TEXT, POS_BORDER } from '../constants.js';

// ... (Helper functions remain unchanged)
function getStartMin(segments, idx) {
  let t = 0;
  for (let i = 0; i < idx; i++) t += segments[i].duration;
  return t;
}

function getSubChanges(prev, curr) {
  const changes = [];
  const prevBenchSet = new Set(prev.bench);
  const comingOn = [...new Set(Object.values(curr.assignment).filter(Boolean))].filter(p => prevBenchSet.has(p));
  
  comingOn.forEach(onPlayer => {
    const pos = Object.entries(curr.assignment).find(([, n]) => n === onPlayer)?.[0];
    const offPlayer = prev.assignment[pos];
    if (pos) changes.push({ type: 'sub', on: onPlayer, off: offPlayer || null, pos });
  });

  if (prev.gkName !== curr.gkName && !changes.some(c => c.on === curr.gkName || c.off === prev.gkName)) {
    changes.push({ type: 'gk', on: curr.gkName, off: prev.gkName });
  }

  Object.entries(curr.assignment).forEach(([pos, name]) => {
    if (name && !comingOn.includes(name) && prev.assignment[pos] !== name) {
      const prevPos = Object.entries(prev.assignment).find(([, n]) => n === name)?.[0];
      if (prevPos && prevPos !== pos) changes.push({ type: 'poschange', player: name, from: prevPos, to: pos });
    }
  });
  return changes;
}

export default function TeamSheetView({ 
  players, segments, lockGK, seasonGames, onSwap, onSave, onReorder, onGoSeason, onGoSetup, isSaved, toast,
  gameClock = { isRunning: false, accumulatedMs: 0, currentSegIdx: null, segmentStartTime: null },
  onStartPeriod, onPausePeriod, onSplitSegment, onAdvanceSegment, onNudgeClock, onResetClock, onResetGame
}) {
  const [tab, setTab] = useState('field');
  const [currentSeg, setCurrentSeg] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [swapFrom, setSwapFrom] = useState(null);
  
  const [activePlayer, setActivePlayer] = useState(null); 
  const [matchStats, setMatchStats] = useState({}); 
  const [orientation, setOrientation] = useState('vertical'); 
  const [showScript, setShowScript] = useState(false);

  const [now, setNow] = useState(Date.now());
  const [showClockMenu, setShowClockMenu] = useState(false);

  const seg = segments[currentSeg];
  const benchSize = players.length - 9;
  
  const { minutesMap, gkDutyMap, playerSchedule } = useMemo(() => calcStats(segments, players), [segments, players]);
  const minMins = Math.min(...Object.values(minutesMap));
  const maxMins = Math.max(...Object.values(minutesMap));

  const upcomingSubs = useMemo(() => {
    if (currentSeg >= segments.length - 1) return [];
    return getSubChanges(segments[currentSeg], segments[currentSeg + 1])
      .filter(c => c.type === 'sub')
      .map(c => ({ pos: c.pos, on: c.on, off: c.off }));
  }, [currentSeg, segments]);

  const getSeasonStats = (playerName) => {
    let sGoals = 0;
    let sAssists = 0;
    if (seasonGames && seasonGames.length > 0) {
      seasonGames.forEach(game => {
        if (game.stats && game.stats[playerName]) {
          sGoals += (game.stats[playerName].goals || 0);
          sAssists += (game.stats[playerName].assists || 0);
        }
      });
    }
    return { sGoals, sAssists };
  };

  // --- TIMER MATH & AUTO-ROLLOVER ---
  useEffect(() => {
    let interval;
    if (gameClock.isRunning) {
      // Tick every 500ms for tighter rollover detection
      interval = setInterval(() => setNow(Date.now()), 500);
    } else {
      setNow(Date.now());
    }
    return () => clearInterval(interval);
  }, [gameClock.isRunning]);

  // Make the header clock look at the ACTIVE game segment, not just the tab we are looking at
  const activeSegIdx = gameClock.currentSegIdx !== null ? gameClock.currentSegIdx : currentSeg;
  const activeSeg = segments[activeSegIdx];
  
  const elapsedMs = gameClock.accumulatedMs + (gameClock.isRunning && gameClock.segmentStartTime ? now - gameClock.segmentStartTime : 0);
  const remainingMsTotal = activeSeg ? (activeSeg.duration * 60000) - elapsedMs : 0;
  
  // The Auto-Advance Trigger
  useEffect(() => {
    if (gameClock.isRunning && remainingMsTotal <= 0) {
      onAdvanceSegment?.();
    }
  }, [remainingMsTotal, gameClock.isRunning, onAdvanceSegment]);

  // Snap the UI to the new segment when the engine rolls over
  useEffect(() => {
    if (gameClock.currentSegIdx !== null && gameClock.currentSegIdx !== currentSeg) {
      setCurrentSeg(gameClock.currentSegIdx);
      setEditMode(false);
      setSwapFrom(null);
    }
  }, [gameClock.currentSegIdx]); // Intentionally omitting currentSeg to avoid loop

  const remainingSecsTotal = Math.max(0, Math.floor(remainingMsTotal / 1000));
  const remMins = Math.floor(remainingSecsTotal / 60);
  const remSecs = remainingSecsTotal % 60;
  
  const isWarning = remainingSecsTotal <= 120 && remainingSecsTotal > 30;
  const isCritical = remainingSecsTotal <= 30 && remainingSecsTotal > 0;
  const clockColor = isCritical ? '#dc2626' : isWarning ? '#d97706' : '#059669';
  const clockBg = isCritical ? '#fee2e2' : isWarning ? '#fffbeb' : '#ecfdf5';

  // --- HISTORICAL LOCK RULE ---
  // Locked if engine split it, OR if it's a past segment.
  const isEffectivelyLocked = seg?.locked || (gameClock.currentSegIdx !== null && currentSeg < gameClock.currentSegIdx);

  const updateStat = (player, type, delta) => {
    setMatchStats(prev => {
      const current = prev[player]?.[type] || 0;
      return { ...prev, [player]: { ...(prev[player] || { goals: 0, assists: 0 }), [type]: Math.max(0, current + delta) } };
    });
  };

  const handleFieldClick = (name, pos) => {
    if (!editMode) {
      setActivePlayer(activePlayer === name ? null : name);
      return;
    }
    if (isEffectivelyLocked) return; 
    const locked = pos === 'GK' && lockGK;
    if (locked) return;
    if (!swapFrom) { setSwapFrom({ type: 'pos', pos, name }); return; }
    if (swapFrom.type === 'pos' && swapFrom.pos === pos) { setSwapFrom(null); return; }
    onSwap(currentSeg, { from: swapFrom, to: { type: 'pos', pos, name } });
    setSwapFrom(null);
  };

  const handleBenchClick = (name) => {
    if (!editMode) {
      setActivePlayer(activePlayer === name ? null : name);
      return;
    }
    if (isEffectivelyLocked) return;
    if (!swapFrom) { setSwapFrom({ type: 'bench', name }); return; }
    if (swapFrom.type === 'bench' && swapFrom.name === name) { setSwapFrom(null); return; }
    onSwap(currentSeg, { from: swapFrom, to: { type: 'bench', name } });
    setSwapFrom(null);
  };

  const handleEmergencySub = () => {
    if (!onSplitSegment) return setEditMode(true);
    const elapsedMinsForSplit = Math.floor(elapsedMs / 60000);
    if (gameClock.isRunning && gameClock.currentSegIdx === currentSeg && elapsedMinsForSplit > 0) {
      const futureSegIdx = onSplitSegment(currentSeg, elapsedMinsForSplit);
      if (futureSegIdx !== undefined) {
        setCurrentSeg(futureSegIdx);
        setEditMode(true);
      }
    } else {
      setEditMode(true);
    }
  };

  const isKidsView = orientation !== 'vertical';

  if (!seg) return null;

  return (
    <div style={{ minHeight: '100vh', background: '#f0f6ff', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column' }}>
      
      {/* ── 1. Top Glance Bar ── */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', background: '#fff', borderBottom: '3px solid #c7daf7' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0f2d5a' }}>⚽ {players.length} Players | {benchSize} Bench</h1>
        
        {/* SMART HEADER CLOCK */}
        <div style={{ position: 'relative' }}>
          <button 
            onClick={() => setShowClockMenu(!showClockMenu)}
            style={{ 
              fontSize: 24, fontWeight: 900, color: gameClock.isRunning ? clockColor : '#64748b', 
              background: gameClock.isRunning ? clockBg : '#f1f5f9', 
              padding: '6px 20px', border: `3px solid ${gameClock.isRunning ? clockColor : '#cbd5e1'}`, 
              borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8
            }}>
            {gameClock.isRunning ? '⏱️' : '⏸️'} 
            {gameClock.currentSegIdx !== null ? `${remMins.toString().padStart(2, '0')}:${remSecs.toString().padStart(2, '0')}` : `${activeSeg.duration}:00`}
          </button>

          {/* INTUITIVE CLOCK MENU */}
          {showClockMenu && (
            <div style={{ position: 'absolute', top: '110%', left: '50%', transform: 'translateX(-50%)', background: '#fff', border: '3px solid #1d6fcf', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 10px 25px rgba(0,0,0,0.2)', zIndex: 200, minWidth: 260 }}>
              
              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                <button onClick={() => { onNudgeClock?.(-60); setShowClockMenu(false); }} style={{ flex: 1, padding: '8px', background: '#e2ecfc', border: 'none', borderRadius: 8, fontWeight: 800, cursor: 'pointer', color: '#1d6fcf' }}>+1m to Clock</button>
                <button onClick={() => { onNudgeClock?.(60); setShowClockMenu(false); }} style={{ flex: 1, padding: '8px', background: '#e2ecfc', border: 'none', borderRadius: 8, fontWeight: 800, cursor: 'pointer', color: '#1d6fcf' }}>-1m from Clock</button>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {!gameClock.isRunning ? (
                  <button onClick={() => { onStartPeriod?.(activeSegIdx); setShowClockMenu(false); }} style={{ flex: 1, padding: '8px', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 900, cursor: 'pointer' }}>▶️ START / RESUME</button>
                ) : (
                  <button onClick={() => { onPausePeriod?.(); setShowClockMenu(false); }} style={{ flex: 1, padding: '8px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 900, cursor: 'pointer' }}>⏸️ PAUSE</button>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, borderTop: '2px solid #e2ecfc', paddingTop: 8 }}>
                 <button onClick={() => { onResetClock?.(); setShowClockMenu(false); }} style={{ flex: 1, padding: '8px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 8, fontWeight: 800, cursor: 'pointer' }}>🔄 Reset Period</button>
                 <button onClick={() => { onResetGame?.(); setShowClockMenu(false); }} style={{ flex: 1, padding: '8px', background: '#7f1d1d', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 800, cursor: 'pointer' }}>🗑️ Reset Game</button>
              </div>
            </div>
          )}
        </div>

        <button onClick={() => setOrientation(isKidsView ? 'vertical' : 'horizontal-right')} style={{ padding: '10px 20px', fontSize: 16, fontWeight: 800, background: isKidsView ? '#059669' : '#e2ecfc', border: `3px solid ${isKidsView ? '#047857' : '#1d6fcf'}`, borderRadius: 8, color: isKidsView ? '#fff' : '#1d6fcf', cursor: 'pointer' }}>
          {isKidsView ? '📱 Coach View' : '📺 Show Kids'}
        </button>
      </header>

      {/* ── 2. Chunky Timeline ── */}
      <div style={{ display: 'flex', gap: 12, padding: '12px 24px', background: '#fff', borderBottom: '3px solid #c7daf7', overflowX: 'auto' }}>
        {segments.map((s, i) => {
          const locked = s.locked || (gameClock.currentSegIdx !== null && i < gameClock.currentSegIdx);
          return (
            <button key={i} onClick={() => { setCurrentSeg(i); setSwapFrom(null); setEditMode(false); }} style={{ padding: '12px 20px', fontSize: 15, fontWeight: 800, border: `3px solid ${i === currentSeg ? '#1558b0' : s.htBefore ? '#f59e0b' : '#c7daf7'}`, borderRadius: 8, background: i === currentSeg ? '#1d6fcf' : s.htBefore ? '#fffbeb' : '#f8fafc', color: i === currentSeg ? '#fff' : s.htBefore ? '#b45309' : '#4a6b8a', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {locked ? '🔒 ' : s.htBefore ? '⏸ ' : ''}{s.label} ({s.duration}m)
            </button>
          );
        })}
      </div>

      {/* ── 3. Main Action Area ── */}
      <main style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: 16, gap: 16, flexDirection: isKidsView ? 'column' : 'row' }}>
        {/* Bench Panel */}
        {(!isKidsView || editMode) && (
          <div style={{ width: isKidsView ? '100%' : '35%', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#4a6b8a', letterSpacing: 1 }}>THE BENCH</div>
            
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {seg.bench.map(name => {
                const subTo = upcomingSubs.find(s => s.on === name);
                const isSel = editMode && swapFrom?.type === 'bench' && swapFrom.name === name;
                return (
                  <div key={name} onClick={() => handleBenchClick(name)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16, background: isSel ? '#eff6ff' : '#fff', border: `4px solid ${isSel ? '#1d6fcf' : '#cbd5e1'}`, borderRadius: 12, fontSize: 20, fontWeight: 800, cursor: isEffectivelyLocked ? 'default' : 'pointer', opacity: isEffectivelyLocked ? 0.7 : 1 }}>
                    <div>
                      🪑 {name}
                      {subTo && !editMode && <span style={{ fontSize: 13, background: '#059669', color: '#fff', padding: '4px 8px', borderRadius: 6, marginLeft: 12 }}>▲ TO {subTo.pos}</span>}
                    </div>
                    <span style={{ fontSize: 16, color: '#64748b' }}>{minutesMap[name] || 0}m</span>
                  </div>
                );
              })}
            </div>

            {currentSeg < segments.length - 1 && !editMode && !isEffectivelyLocked && (
              <button onClick={() => setShowScript(true)} style={{ padding: 16, fontSize: 16, fontWeight: 800, background: '#fffbeb', color: '#b45309', border: '4px solid #f59e0b', borderRadius: 12, cursor: 'pointer' }}>
                📋 READ NEXT SUB SCRIPT
              </button>
            )}

            {!isEffectivelyLocked && (
              <button onClick={editMode ? () => setEditMode(false) : handleEmergencySub} style={{ padding: 20, fontSize: 18, fontWeight: 900, background: editMode ? '#1d6fcf' : '#059669', color: '#fff', border: `4px solid ${editMode ? '#1558b0' : '#047857'}`, borderRadius: 12, cursor: 'pointer' }}>
                {editMode ? '✅ FINISH EDITING' : (gameClock.isRunning && gameClock.currentSegIdx === currentSeg ? '🚨 EMERGENCY MID-PERIOD SUB' : '🔄 EDIT LINEUP')}
              </button>
            )}
            {isEffectivelyLocked && (
               <div style={{ padding: 16, textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#64748b', background: '#f1f5f9', borderRadius: 12, border: '2px dashed #cbd5e1' }}>
                 🔒 This period is completed and cannot be edited.
               </div>
            )}
          </div>
        )}

        {/* The Pitch */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#e2ecfc', borderRadius: 16, padding: 16 }}>
          {isKidsView && (
             <button onClick={() => setOrientation(o => o === 'horizontal-right' ? 'horizontal-left' : 'horizontal-right')} style={{ marginBottom: 16, padding: '10px 20px', fontSize: 16, fontWeight: 800, background: '#fff', border: '3px solid #cbd5e1', borderRadius: 8, cursor: 'pointer' }}>
               {orientation === 'horizontal-right' ? '⬅️ Attacking Left' : 'Attacking Right ➡️'}
             </button>
          )}
          <div style={{ width: '100%', maxWidth: isKidsView ? 800 : 550, opacity: isEffectivelyLocked ? 0.8 : 1 }}>
            <FieldView assignment={seg.assignment} highlight={activePlayer} swapFrom={editMode ? swapFrom : null} onPlayerClick={handleFieldClick} upcomingSubs={editMode ? [] : upcomingSubs} orientation={orientation} />
          </div>
        </div>
      </main>

      {/* ── 4. Fat-Finger Bottom Panel ── */}
      {activePlayer && (() => {
        const { sGoals, sAssists } = getSeasonStats(activePlayer);
        return (
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '4px solid #1d6fcf', padding: '24px', boxShadow: '0 -10px 40px rgba(0,0,0,0.15)', zIndex: 100, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: '#0f2d5a' }}>{activePlayer}</h2>
                <div style={{ marginTop: 8, background: '#f8fafc', padding: '8px 14px', borderRadius: 8, fontSize: 14, fontWeight: 800, color: '#4a6b8a', display: 'inline-flex', gap: 16, border: '2px solid #e2ecfc' }}>
                  <span>⏱️ Today: {minutesMap[activePlayer] || 0}m</span>
                  <span>|</span>
                  <span>🏆 Season: {sGoals} Goals, {sAssists} Assists</span>
                </div>
              </div>
              <button onClick={() => setActivePlayer(null)} style={{ background: '#f1f5f9', border: 'none', padding: '10px 16px', borderRadius: 8, fontSize: 18, fontWeight: 800, color: '#64748b', cursor: 'pointer' }}>Close ✕</button>
            </div>

            <div style={{ display: 'flex', gap: 24 }}>
              <div style={{ flex: 1, background: '#fffbeb', border: '3px solid #f59e0b', borderRadius: 16, padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#b45309', marginBottom: 12 }}>⚽ GAME GOALS</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button onClick={() => updateStat(activePlayer, 'goals', -1)} style={{ width: 60, height: 60, fontSize: 32, fontWeight: 900, borderRadius: 12, background: '#fff', border: '3px solid #fcd34d', color: '#d97706', cursor: 'pointer' }}>−</button>
                  <span style={{ fontSize: 40, fontWeight: 900, color: '#92400e' }}>{matchStats[activePlayer]?.goals || 0}</span>
                  <button onClick={() => updateStat(activePlayer, 'goals', 1)} style={{ width: 60, height: 60, fontSize: 32, fontWeight: 900, borderRadius: 12, background: '#f59e0b', border: 'none', color: '#fff', cursor: 'pointer' }}>+</button>
                </div>
              </div>
              <div style={{ flex: 1, background: '#eff6ff', border: '3px solid #3b82f6', borderRadius: 16, padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#1d4ed8', marginBottom: 12 }}>👟 GAME ASSISTS</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button onClick={() => updateStat(activePlayer, 'assists', -1)} style={{ width: 60, height: 60, fontSize: 32, fontWeight: 900, borderRadius: 12, background: '#fff', border: '3px solid #93c5fd', color: '#2563eb', cursor: 'pointer' }}>−</button>
                  <span style={{ fontSize: 40, fontWeight: 900, color: '#1e3a8a' }}>{matchStats[activePlayer]?.assists || 0}</span>
                  <button onClick={() => updateStat(activePlayer, 'assists', 1)} style={{ width: 60, height: 60, fontSize: 32, fontWeight: 900, borderRadius: 12, background: '#3b82f6', border: 'none', color: '#fff', cursor: 'pointer' }}>+</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Coach's Script Modal ── */}
      {showScript && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,45,90,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 200, padding: 20 }}>
          <div style={{ background: '#fff', padding: 32, borderRadius: 24, width: '100%', maxWidth: 600 }}>
            <h2 style={{ fontSize: 24, fontWeight: 900, color: '#0f2d5a', marginBottom: 20 }}>📋 Next Sub Script</h2>
            <ul style={{ fontSize: 20, fontWeight: 700, color: '#4a6b8a', lineHeight: 1.8, listStyle: 'none', padding: 0 }}>
              {upcomingSubs.map((sub, idx) => (
                <li key={idx} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '2px solid #e2ecfc' }}>
                  <span style={{ color: '#059669' }}>{sub.on}</span> you are on for <span style={{ color: '#dc2626' }}>{sub.off || 'nobody'}</span> at <strong>{sub.pos}</strong>.
                </li>
              ))}
              {upcomingSubs.length === 0 && <li>No substitutions queued.</li>}
            </ul>
            <button onClick={() => setShowScript(false)} style={{ width: '100%', padding: 20, fontSize: 18, fontWeight: 900, background: '#1d6fcf', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', marginTop: 16 }}>Got It</button>
          </div>
        </div>
      )}

      {/* ── 5. Post-Game Footer ── */}
      <footer style={{ padding: '16px 24px', background: '#fff', borderTop: '3px solid #c7daf7' }}>
        <button 
          onClick={() => { 
            onSave({ stats: matchStats }); 
            onGoSeason(); 
          }} 
          style={{ width: '100%', padding: 20, fontSize: 18, fontWeight: 900, background: '#f8fafc', color: '#4a6b8a', border: '4px solid #cbd5e1', borderRadius: 12, cursor: 'pointer' }}>
          📊 SAVE GAME & VIEW SEASON TRACKER
        </button>
      </footer>
    </div>
  );
}