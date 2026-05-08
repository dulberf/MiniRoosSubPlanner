import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import FieldView from './FieldView.jsx';
import { calcStats } from '../scheduler.js';
import { POSITIONS, POS_BG, POS_TEXT, POS_BORDER } from '../constants.js';

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
  players, segments, seasonGames, onSwap, onSave, onReorder, onGoSeason, onGoSetup, isSaved, toast,
  gameClock = { isRunning: false, accumulatedMs: 0, currentSegIdx: null, segmentStartTime: null },
  onStartPeriod, onPausePeriod, onSplitSegment, onAdvanceSegment, onNudgeClock, onResetClock, onResetGame,
  onChangeGK,
  initialCurrentSeg = 0, initialMatchStats = {}, onProgressUpdate,
}) {
  const [tab, setTab] = useState('field');
  const [currentSeg, setCurrentSeg] = useState(initialCurrentSeg);
  const [editMode, setEditMode] = useState(false);
  const [swapFrom, setSwapFrom] = useState(null);

  const [activePlayer, setActivePlayer] = useState(null);
  const [matchStats, setMatchStats] = useState(initialMatchStats); 
  const [orientation, setOrientation] = useState('vertical'); 
  
  const [scriptModal, setScriptModal] = useState(null);
  const [honoursOpen, setHonoursOpen] = useState(false);
  const [confirmGK, setConfirmGK] = useState(null); // { name } when confirming a mid-game GK swap
  const [gkPickerOpen, setGkPickerOpen] = useState(false);

  // FIX: Restore Save Modal State
  const [saveOpen, setSaveOpen] = useState(false);
  const [matchLabel, setMatchLabel] = useState('');
  const [potm, setPotm] = useState('');
  const [captain, setCaptain] = useState('');
  const [ourScore, setOurScore] = useState('');
  const [oppositionScore, setOppositionScore] = useState('');
  const [matchNotes, setMatchNotes] = useState('');

  // Suggest the captain from the last winning game (may not be in today's squad)
  const suggestedCaptain = useMemo(() => {
    for (let i = seasonGames.length - 1; i >= 0; i--) {
      if (seasonGames[i].result === 'W' && seasonGames[i].captain) {
        return seasonGames[i].captain;
      }
    }
    return '';
  }, [seasonGames]);

  // Open save modal and pre-populate scores + captain suggestion
  const openSaveModal = useCallback((initialScore) => {
    setOurScore(initialScore);
    setCaptain(suggestedCaptain);
    setSaveOpen(true);
  }, [suggestedCaptain]);

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

  const trackedGoals = useMemo(
    () => Object.values(matchStats).reduce((s, st) => s + (st.goals || 0), 0),
    [matchStats]
  );

  const getSeasonStats = (playerName) => {
    let sGoals = 0;
    let sAssists = 0;
    if (seasonGames && seasonGames.length > 0) {
      seasonGames.forEach(game => {
        if (game.goals && game.goals[playerName]) sGoals += game.goals[playerName];
        if (game.assists && game.assists[playerName]) sAssists += game.assists[playerName];
      });
    }
    sGoals += (matchStats[playerName]?.goals || 0);
    sAssists += (matchStats[playerName]?.assists || 0);
    return { sGoals, sAssists };
  };

  useEffect(() => {
    let interval;
    if (gameClock.isRunning) {
      interval = setInterval(() => setNow(Date.now()), 500);
    } else {
      setNow(Date.now());
    }
    return () => clearInterval(interval);
  }, [gameClock.isRunning]);

  // Save in-progress state whenever the segment advances
  const matchStatsRef = useRef(matchStats);
  matchStatsRef.current = matchStats;
  useEffect(() => {
    if (onProgressUpdate) onProgressUpdate(currentSeg, matchStatsRef.current);
  }, [currentSeg, onProgressUpdate]);

  // Refs so event listeners can always read the latest values without re-registering.
  const currentSegRef = useRef(currentSeg);
  currentSegRef.current = currentSeg;
  const onProgressUpdateRef = useRef(onProgressUpdate);
  onProgressUpdateRef.current = onProgressUpdate;
  const debounceRef = useRef(null);
  const audioCtxRef = useRef(null);
  const wakeLockRef = useRef(null);
  const lastBuzzSecRef = useRef(null);

  // Stable flush — cancels any pending debounce and writes immediately.
  // Used by visibilitychange and beforeunload handlers.
  const flushSave = useCallback(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = null;
    if (onProgressUpdateRef.current) {
      onProgressUpdateRef.current(currentSegRef.current, matchStatsRef.current);
    }
  }, []); // empty deps — stable for the lifetime of this component

  const unlockAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    } else if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  };

  const acquireWakeLock = async () => {
    try {
      if (navigator.wakeLock) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      }
    } catch (_) {}
  };

  const buzz = (freq = 660, duration = 0.3, volume = 0.5, startOffset = 0) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime + startOffset);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);
    osc.start(ctx.currentTime + startOffset);
    osc.stop(ctx.currentTime + startOffset + duration);
  };

  const buzzEnd = () => {
    [0, 0.15, 0.3, 0.45, 0.6].forEach(offset => buzz(880, 0.12, 0.8, offset));
  };

  // Debounced save on every matchStats change.
  // ⚠️ Known data-loss window: a goal/assist recorded within 3 seconds of a sudden
  // crash will not be persisted. Accepted trade-off vs disk-write thrashing.
  useEffect(() => {
    if (!onProgressUpdate) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onProgressUpdate(currentSegRef.current, matchStats);
    }, 3000);
    return () => clearTimeout(debounceRef.current);
  }, [matchStats, onProgressUpdate]);

  // Flush on visibility change (primary iPad/iOS save path) and beforeunload (desktop fallback).
  // ⚠️ iOS/iPad: beforeunload is unreliable — the OS can kill the process before the
  // disk write completes. visibilitychange is the critical path for iPad and must
  // never be the sole flush mechanism.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushSave();
      if (document.visibilityState === 'visible') {
        audioCtxRef.current?.resume();
        acquireWakeLock();
      }
    };
    const handleBeforeUnload = () => flushSave();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [flushSave]); // flushSave is stable — registers once, never re-runs

  const activeSegIdx = gameClock.currentSegIdx !== null ? gameClock.currentSegIdx : currentSeg;
  const activeSeg = segments[activeSegIdx];
  
  const elapsedMs = gameClock.accumulatedMs + (gameClock.isRunning && gameClock.segmentStartTime ? now - gameClock.segmentStartTime : 0);
  const remainingMsTotal = activeSeg ? (activeSeg.duration * 60000) - elapsedMs : 0;
  
  useEffect(() => {
    if (gameClock.isRunning && remainingMsTotal <= 0) {
      buzzEnd();
      onAdvanceSegment?.();
    }
  }, [remainingMsTotal, gameClock.isRunning, onAdvanceSegment]);

  useEffect(() => {
    if (gameClock.currentSegIdx !== null && gameClock.currentSegIdx !== currentSeg) {
      const nextIdx = gameClock.currentSegIdx;
      setCurrentSeg(nextIdx);
      setEditMode(false);
      setSwapFrom(null);

      if (nextIdx > 0 && nextIdx > currentSeg) {
        const activeChanges = getSubChanges(segments[nextIdx - 1], segments[nextIdx])
          .filter(c => c.type === 'sub')
          .map(c => ({ pos: c.pos, on: c.on, off: c.off }));
        
        setScriptModal({
          title: `⏱️ Period ${nextIdx + 1} Started! Call these subs:`,
          subs: activeChanges
        });
      }
    }
  }, [gameClock.currentSegIdx]);

  const remainingSecsTotal = Math.max(0, Math.floor(remainingMsTotal / 1000));
  const remMins = Math.floor(remainingSecsTotal / 60);
  const remSecs = remainingSecsTotal % 60;
  
  const isWarning = remainingSecsTotal <= 120 && remainingSecsTotal > 30;
  const isCritical = remainingSecsTotal <= 30 && remainingSecsTotal > 0;

  useEffect(() => {
    if (!isCritical || remainingSecsTotal <= 0) {
      if (!isCritical) lastBuzzSecRef.current = null;
      return;
    }
    if (remainingSecsTotal % 5 === 0 && lastBuzzSecRef.current !== remainingSecsTotal) {
      lastBuzzSecRef.current = remainingSecsTotal;
      buzz(660, 0.25, 0.5);
    }
  }, [remainingSecsTotal, isCritical]);

  const clockColor = isCritical ? '#dc2626' : isWarning ? '#d97706' : '#059669';
  const clockBg = isCritical ? '#fee2e2' : isWarning ? '#fffbeb' : '#ecfdf5';

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

  const handleMovePlayer = () => {
    const isOnBench = seg.bench.includes(activePlayer);
    const pos = !isOnBench
      ? Object.entries(seg.assignment).find(([, n]) => n === activePlayer)?.[0]
      : null;
    setSwapFrom(isOnBench ? { type: 'bench', name: activePlayer } : { type: 'pos', pos, name: activePlayer });
    setEditMode(true);
    setActivePlayer(null);
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

          {showClockMenu && (
            <div style={{ position: 'absolute', top: '110%', left: '50%', transform: 'translateX(-50%)', background: '#fff', border: '3px solid #1d6fcf', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 10px 25px rgba(0,0,0,0.2)', zIndex: 200, minWidth: 260 }}>
              
              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                <button onClick={() => { onNudgeClock?.(-60); setShowClockMenu(false); }} style={{ flex: 1, padding: '8px', background: '#e2ecfc', border: 'none', borderRadius: 8, fontWeight: 800, cursor: 'pointer', color: '#1d6fcf' }}>+1m to Clock</button>
                <button onClick={() => { onNudgeClock?.(60); setShowClockMenu(false); }} style={{ flex: 1, padding: '8px', background: '#e2ecfc', border: 'none', borderRadius: 8, fontWeight: 800, cursor: 'pointer', color: '#1d6fcf' }}>-1m from Clock</button>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {!gameClock.isRunning ? (
                  <button onClick={() => { unlockAudio(); acquireWakeLock(); onStartPeriod?.(activeSegIdx); setShowClockMenu(false); }} style={{ flex: 1, padding: '8px', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 900, cursor: 'pointer' }}>▶️ START / RESUME</button>
                ) : (
                  <button onClick={() => { onPausePeriod?.(); setShowClockMenu(false); }} style={{ flex: 1, padding: '8px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 900, cursor: 'pointer' }}>⏸️ PAUSE</button>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, borderTop: '2px solid #e2ecfc', paddingTop: 8 }}>
                 <button onClick={() => { onResetClock?.(); setShowClockMenu(false); }} style={{ flex: 1, padding: '8px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 8, fontWeight: 800, cursor: 'pointer' }}>🔄 Reset Period</button>
                 <button onClick={() => { wakeLockRef.current?.release(); onResetGame?.(); setShowClockMenu(false); }} style={{ flex: 1, padding: '8px', background: '#7f1d1d', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 800, cursor: 'pointer' }}>🗑️ Reset Game</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setHonoursOpen(true)} style={{ padding: '10px 16px', fontSize: 14, fontWeight: 800, background: '#fffbeb', border: '3px solid #fcd34d', borderRadius: 8, color: '#b45309', cursor: 'pointer' }}>
            🏆 Honours
          </button>
          <button onClick={() => setOrientation(isKidsView ? 'vertical' : 'horizontal-right')} style={{ padding: '10px 20px', fontSize: 16, fontWeight: 800, background: isKidsView ? '#059669' : '#e2ecfc', border: `3px solid ${isKidsView ? '#047857' : '#1d6fcf'}`, borderRadius: 8, color: isKidsView ? '#fff' : '#1d6fcf', cursor: 'pointer' }}>
            {isKidsView ? '📱 Coach View' : '📺 Show Kids'}
          </button>
        </div>
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
                  </div>
                );
              })}
            </div>

            <textarea
              value={matchNotes}
              onChange={e => setMatchNotes(e.target.value)}
              placeholder="Tactics, HT talk, training focus..."
              style={{ width: '100%', minHeight: 120, padding: 14, borderRadius: 12, border: '3px solid #c7daf7', fontSize: 15, fontWeight: 600, color: '#0f2d5a', background: '#fff', resize: 'vertical', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}
            />

            {currentSeg < segments.length - 1 && !editMode && !isEffectivelyLocked && (
              <button onClick={() => setScriptModal({ title: '📋 Next Sub Script', subs: upcomingSubs })} style={{ padding: 16, fontSize: 16, fontWeight: 800, background: '#fffbeb', color: '#b45309', border: '4px solid #f59e0b', borderRadius: 12, cursor: 'pointer' }}>
                📋 READ NEXT SUB SCRIPT
              </button>
            )}

            {!editMode && !isEffectivelyLocked && (
              <button onClick={() => setGkPickerOpen(true)} style={{ padding: 16, fontSize: 16, fontWeight: 800, background: '#fff7ed', color: '#b45309', border: '4px solid #f59e0b', borderRadius: 12, cursor: 'pointer' }}>
                🧤 ALLOCATE GK
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
          <div style={{ width: '100%', maxWidth: isKidsView ? 800 : 550, opacity: isEffectivelyLocked ? 0.8 : 1, ...(activePlayer ? { position: 'relative', zIndex: 99 } : {}) }}>
            <FieldView assignment={seg.assignment} highlight={activePlayer} swapFrom={editMode ? swapFrom : null} onPlayerClick={handleFieldClick} upcomingSubs={editMode ? [] : upcomingSubs} orientation={orientation} />
          </div>
        </div>
      </main>

      {/* ── Backdrop: closes modal on tap outside panel or tokens ── */}
      {activePlayer && (
        <div onClick={() => setActivePlayer(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 98, background: 'rgba(0,0,0,0.001)', WebkitTapHighlightColor: 'transparent' }} />
      )}

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
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleMovePlayer} style={{ padding: '10px 16px', borderRadius: 8, background: '#e2ecfc', border: '2px solid #1d6fcf', fontSize: 15, fontWeight: 800, color: '#1d6fcf', cursor: 'pointer' }}>🔀 Move Player</button>
                <button onClick={() => setActivePlayer(null)} style={{ background: '#f1f5f9', border: 'none', padding: '10px 16px', borderRadius: 8, fontSize: 18, fontWeight: 800, color: '#64748b', cursor: 'pointer' }}>Close ✕</button>
              </div>
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

      {/* ── Allocate GK: pick a player to take over in goal ── */}
      {gkPickerOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,45,90,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 240, padding: 20 }}>
          <div style={{ background: '#fff', padding: 28, borderRadius: 24, width: '100%', maxWidth: 420, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: '#0f2d5a', marginTop: 0, marginBottom: 6 }}>🧤 Allocate Goalkeeper</h2>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#4a6b8a', marginBottom: 18, lineHeight: 1.4 }}>
              Pick a player to go in goal for the rest of {seg.half === 1 ? 'the first half' : 'the second half'}. Currently in goal: <strong style={{ color: '#0f2d5a' }}>{seg.assignment.GK}</strong>.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {players.filter(p => p !== seg.assignment.GK).map(p => {
                const onBench = seg.bench.includes(p);
                return (
                  <button key={p} onClick={() => { setGkPickerOpen(false); setConfirmGK({ name: p }); }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: 10, background: '#f8fafc', border: '2px solid #e2ecfc', fontSize: 16, fontWeight: 800, color: '#0f2d5a', cursor: 'pointer', textAlign: 'left' }}>
                    <span>{p}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: onBench ? '#b45309' : '#059669' }}>{onBench ? '🪑 ON BENCH' : '⚽ ON FIELD'}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setGkPickerOpen(false)} style={{ width: '100%', marginTop: 16, padding: 14, fontSize: 15, fontWeight: 800, background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 12, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Confirm: change GK mid-game ── */}
      {confirmGK && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,45,90,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 250, padding: 20 }}>
          <div style={{ background: '#fff', padding: 32, borderRadius: 24, width: '100%', maxWidth: 440, boxShadow: '0 24px 60px rgba(0,0,0,0.3)', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🧤</div>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: '#0f2d5a', marginTop: 0, marginBottom: 12 }}>Change Goalkeeper?</h2>
            <p style={{ fontSize: 15, color: '#4a6b8a', fontWeight: 600, lineHeight: 1.5, margin: '0 0 24px' }}>
              <strong style={{ color: '#0f2d5a' }}>{confirmGK.name}</strong> will go in goal for the rest of {seg.half === 1 ? 'the first half' : 'the second half'}. <strong style={{ color: '#0f2d5a' }}>{seg.assignment.GK}</strong> will swap into their place. Subs already played are not affected.
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setConfirmGK(null)} style={{ flex: 1, padding: 16, background: '#f1f5f9', border: 'none', borderRadius: 12, color: '#64748b', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => {
                onChangeGK?.(currentSeg, confirmGK.name);
                setConfirmGK(null);
                setActivePlayer(null);
              }} style={{ flex: 2, padding: 16, background: '#f59e0b', border: 'none', borderRadius: 12, color: '#fff', fontSize: 15, fontWeight: 900, cursor: 'pointer' }}>
                🧤 Make GK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Honours sheet ── */}
      {honoursOpen && (() => {
        const counts = {};
        players.forEach(p => { counts[p] = { potm: 0, captain: 0 }; });
        (seasonGames || []).forEach(g => {
          if (g.potm && counts[g.potm]) counts[g.potm].potm++;
          if (g.captain && counts[g.captain]) counts[g.captain].captain++;
        });
        const sorted = [...players].sort((a, b) => {
          const at = counts[a].potm + counts[a].captain;
          const bt = counts[b].potm + counts[b].captain;
          if (at !== bt) return bt - at;
          return a.localeCompare(b);
        });
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,45,90,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 250, padding: 20 }}>
            <div style={{ background: '#fff', padding: 28, borderRadius: 24, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
              <h2 style={{ fontSize: 22, fontWeight: 900, color: '#0f2d5a', marginTop: 0, marginBottom: 6 }}>🏆 Season Honours</h2>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 16, padding: '8px 12px', background: '#f8fafc', borderRadius: 8, border: '2px solid #e2ecfc' }}>
                <span style={{ color: '#d97706' }}>⭐</span> Player of the Week  ·  <span style={{ color: '#c2410c' }}>🏅</span> Captain
              </div>
              {seasonGames.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontWeight: 600 }}>No games saved yet — honours will appear here once you've recorded a few matches.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sorted.map(p => {
                    const { potm, captain } = counts[p];
                    const total = potm + captain;
                    return (
                      <div key={p} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: total > 0 ? '#fffbeb' : '#f8fafc', border: `2px solid ${total > 0 ? '#fcd34d' : '#e2ecfc'}` }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: '#0f2d5a' }}>{p}</span>
                        <div style={{ display: 'flex', gap: 12, fontSize: 14, fontWeight: 800 }}>
                          {potm > 0 && <span style={{ color: '#b45309' }}>⭐ ×{potm}</span>}
                          {captain > 0 && <span style={{ color: '#c2410c' }}>🏅 ×{captain}</span>}
                          {total === 0 && <span style={{ color: '#cbd5e1', fontWeight: 700 }}>—</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <button onClick={() => setHonoursOpen(false)} style={{ width: '100%', marginTop: 20, padding: 16, fontSize: 16, fontWeight: 900, background: '#1d6fcf', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        );
      })()}

      {/* ── UNIFIED Coach's Script Modal ── */}
      {scriptModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,45,90,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 200, padding: 20 }}>
          <div style={{ background: '#fff', padding: 32, borderRadius: 24, width: '100%', maxWidth: 600, boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontSize: 24, fontWeight: 900, color: '#0f2d5a', marginTop: 0, marginBottom: 20 }}>{scriptModal.title}</h2>
            <ul style={{ fontSize: 20, fontWeight: 700, color: '#4a6b8a', lineHeight: 1.8, listStyle: 'none', padding: 0 }}>
              {scriptModal.subs.map((sub, idx) => (
                <li key={idx} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '2px solid #e2ecfc' }}>
                  <span style={{ color: '#059669' }}>{sub.on}</span> you are on for <span style={{ color: '#dc2626' }}>{sub.off || 'nobody'}</span> at <strong>{sub.pos}</strong>.
                </li>
              ))}
              {scriptModal.subs.length === 0 && <li>No substitutions required.</li>}
            </ul>
            <button onClick={() => setScriptModal(null)} style={{ width: '100%', padding: 20, fontSize: 18, fontWeight: 900, background: '#1d6fcf', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', marginTop: 16 }}>Got It</button>
          </div>
        </div>
      )}

      {/* ── FIX: Restored Post-Game Save Modal ── */}
      {saveOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,45,90,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 300, padding: 20 }}>
          <div style={{ background: '#fff', padding: 32, borderRadius: 24, width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontSize: 24, fontWeight: 900, color: '#0f2d5a', marginTop: 0, marginBottom: 24 }}>📊 Post-Game Summary</h2>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#4a6b8a', marginBottom: 8, letterSpacing: 1 }}>MATCH LABEL (OPTIONAL)</label>
              <input value={matchLabel} onChange={e => setMatchLabel(e.target.value)} placeholder="e.g. Grand Final vs Eastside" style={{ width: '100%', padding: '16px', borderRadius: 12, border: '3px solid #e2ecfc', fontSize: 16, fontWeight: 600, boxSizing: 'border-box', outline: 'none' }} />
            </div>

            {/* Game Result */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#4a6b8a', marginBottom: 12, letterSpacing: 1 }}>GAME RESULT</label>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6, textAlign: 'center' }}>OUR SCORE</div>
                  <input
                    type="number"
                    min="0"
                    value={ourScore}
                    onChange={e => setOurScore(e.target.value)}
                    style={{ width: '100%', padding: '14px', borderRadius: 12, border: '3px solid #1d6fcf', fontSize: 28, fontWeight: 900, textAlign: 'center', boxSizing: 'border-box', color: '#0f2d5a', outline: 'none' }}
                  />
                </div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#4a6b8a', paddingBottom: 14, flexShrink: 0 }}>–</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6, textAlign: 'center' }}>OPPOSITION</div>
                  <input
                    type="number"
                    min="0"
                    value={oppositionScore}
                    onChange={e => setOppositionScore(e.target.value)}
                    placeholder="0"
                    style={{ width: '100%', padding: '14px', borderRadius: 12, border: '3px solid #e2ecfc', fontSize: 28, fontWeight: 900, textAlign: 'center', boxSizing: 'border-box', color: '#64748b', outline: 'none' }}
                  />
                </div>
              </div>
              {ourScore !== '' && Number(ourScore) !== trackedGoals && (
                <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 10, background: '#fffbeb', border: '2px solid #fcd34d', color: '#b45309', fontSize: 13, fontWeight: 700 }}>
                  ⚠️ {trackedGoals} goal{trackedGoals !== 1 ? 's' : ''} allocated to players but score shows {ourScore}. Tap a player to allocate — or save and come back later.
                </div>
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#4a6b8a', marginBottom: 8, letterSpacing: 1 }}>⭐ PLAYER OF THE WEEK</label>
              <select value={potm} onChange={e => setPotm(e.target.value)} style={{ width: '100%', padding: '16px', borderRadius: 12, border: '3px solid #e2ecfc', fontSize: 16, fontWeight: 600, boxSizing: 'border-box', background: '#fff', outline: 'none', cursor: 'pointer' }}>
                <option value="">— Select Player —</option>
                {players.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 32 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#4a6b8a', marginBottom: 8, letterSpacing: 1 }}>🏅 CAPTAIN</label>
              <select value={captain} onChange={e => setCaptain(e.target.value)} style={{ width: '100%', padding: '16px', borderRadius: 12, border: '3px solid #e2ecfc', fontSize: 16, fontWeight: 600, boxSizing: 'border-box', background: '#fff', outline: 'none', cursor: 'pointer' }}>
                <option value="">— Select Captain —</option>
                {players.map(p => <option key={p} value={p}>{p}</option>)}
                {/* If last win's captain isn't in today's squad, still show them */}
                {suggestedCaptain && !players.includes(suggestedCaptain) && (
                  <option value={suggestedCaptain}>{suggestedCaptain} (not in squad)</option>
                )}
              </select>
              {suggestedCaptain && (
                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: '#4a6b8a' }}>
                  💡 Suggested from last win
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setSaveOpen(false)} style={{ flex: 1, padding: 20, borderRadius: 12, background: '#f1f5f9', color: '#64748b', fontSize: 16, fontWeight: 800, border: 'none', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => {
                const formattedGoals = {};
                const formattedAssists = {};
                Object.entries(matchStats).forEach(([p, stats]) => {
                  if (stats.goals && stats.goals > 0) formattedGoals[p] = stats.goals;
                  if (stats.assists && stats.assists > 0) formattedAssists[p] = stats.assists;
                });
                wakeLockRef.current?.release();
                onSave({ label: matchLabel, potm, captain, goals: formattedGoals, assists: formattedAssists, ourScore: ourScore !== '' ? Number(ourScore) : trackedGoals, oppositionScore: oppositionScore !== '' ? Number(oppositionScore) : null, notes: matchNotes });
                setSaveOpen(false);
                onGoSeason();
              }} style={{ flex: 2, padding: 20, borderRadius: 12, background: '#059669', color: '#fff', fontSize: 16, fontWeight: 900, border: 'none', cursor: 'pointer' }}>
                💾 Save Game
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 5. Post-Game Footer ── */}
      <footer style={{ padding: '16px 24px', background: '#fff', borderTop: '3px solid #c7daf7', display: 'flex', gap: 12 }}>
        {isSaved ? (
           <>
             <button onClick={() => openSaveModal(String(trackedGoals))} style={{ flex: 1, padding: 20, fontSize: 18, fontWeight: 900, background: '#f8fafc', color: '#4a6b8a', border: '4px solid #cbd5e1', borderRadius: 12, cursor: 'pointer' }}>
               ✏️ EDIT SAVED DATA
             </button>
             <button onClick={onGoSetup} style={{ flex: 2, padding: 20, fontSize: 18, fontWeight: 900, background: '#1d6fcf', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', boxShadow: '0 8px 24px rgba(29,111,207,0.3)' }}>
               ➕ START NEW MATCH
             </button>
           </>
        ) : (
          <button onClick={() => openSaveModal(String(trackedGoals))} style={{ width: '100%', padding: 20, fontSize: 18, fontWeight: 900, background: '#f8fafc', color: '#4a6b8a', border: '4px solid #cbd5e1', borderRadius: 12, cursor: 'pointer' }}>
            📊 REVIEW & SAVE GAME
          </button>
        )}
      </footer>
    </div>
  );
}