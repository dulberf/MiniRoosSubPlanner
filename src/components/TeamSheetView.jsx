import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import FieldView from './FieldView.jsx';
import { calcStats, nextAppearance } from '../scheduler.js';
import { POS_BG, POS_TEXT, POS_BAND, POS_LABEL, UI } from '../constants.js';
import useScale from '../useScale.js';

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

// mm:ss with no leading zero on the minutes — matches the design's "1:42".
function fmtCountdown(totalSecs) {
  const m = Math.floor(Math.max(0, totalSecs) / 60);
  const s = Math.max(0, totalSecs) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Walks backwards to answer "when did I come off?" for a benched player.
function lastAppearance(segments, fromSegIdx, playerName) {
  for (let i = fromSegIdx - 1; i >= 0; i--) {
    const entry = Object.entries(segments[i].assignment).find(([, n]) => n === playerName);
    if (entry) {
      return { minute: getStartMin(segments, i) + segments[i].duration, pos: entry[0], segIdx: i };
    }
  }
  return null;
}

export default function TeamSheetView({
  players, segments, seasonGames, onSwap, onSave, onGoSeason, onGoSetup, isSaved, toast,
  gameClock = { isRunning: false, accumulatedMs: 0, currentSegIdx: null, segmentStartTime: null },
  onStartPeriod, onPausePeriod, onSplitSegment, onAdvanceSegment, onNudgeClock, onResetClock, onResetGame,
  onChangeGK,
  onRosterChange,
  onRebalance,
  initialCurrentSeg = 0, initialMatchStats = {}, onProgressUpdate,
}) {
  const { scale, s } = useScale();

  const [currentSeg, setCurrentSeg] = useState(initialCurrentSeg);
  const [editMode, setEditMode] = useState(false);
  const [swapFrom, setSwapFrom] = useState(null);

  const [activePlayer, setActivePlayer] = useState(null);
  const [matchStats, setMatchStats] = useState(initialMatchStats);
  const [orientation, setOrientation] = useState('vertical');

  const [honoursOpen, setHonoursOpen] = useState(false);
  const [confirmGK, setConfirmGK] = useState(null); // { name } when confirming a mid-game GK swap
  const [gkPickerOpen, setGkPickerOpen] = useState(false);

  // Session 13: one sheet for squad admin (late/out/notes/kids/resets) instead
  // of five buttons competing for space on the live screen.
  const [squadOpen, setSquadOpen] = useState(false);
  // Quick "who scored?" flow off the GOAL tool button. The per-player steppers
  // in the player sheet still work — this is an additional path, not a
  // replacement.
  const [goalPicker, setGoalPicker] = useState(null); // null | { scorer: string|null }

  // Subs-outstanding acknowledgement. The clock still advances the segment on
  // time (minutes and season stats are untouched) — this only tracks whether
  // the coach has confirmed the physical swap happened, so the red cue can
  // persist instead of vanishing with a dismissed modal.
  const [subsAckFor, setSubsAckFor] = useState(null);   // segIdx acknowledged
  const [ackFlashFor, setAckFlashFor] = useState(null); // segIdx showing "✓ · UNDO"
  const ackTimerRef = useRef(null);

  // Roster-change UI state
  const [latePlayerOpen, setLatePlayerOpen] = useState(false);
  const [latePlayerName, setLatePlayerName] = useState('');
  const [playerOutOpen, setPlayerOutOpen] = useState(false);
  const [playerOutName, setPlayerOutName] = useState('');
  const [playerOutReplacement, setPlayerOutReplacement] = useState('');

  // Emergency mid-period sub: when the clock isn't timing this period we ask how
  // many minutes have been played, so the past stays locked and only the rest of
  // the period changes. Without this the edit silently rewrote the whole period
  // (the weekend bug that left one player on 25m and another on the full 50m).
  const [subPrompt, setSubPrompt] = useState(null); // truthy when the prompt is open
  const [subPromptMins, setSubPromptMins] = useState('');
  // A swap the coach asked for via MOVE POSITION, held until the split resolves.
  const pendingSwapRef = useRef(null);

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

  const seg = segments[currentSeg];
  // Derive display counts from the current segment (not players.length) so a
  // mid-game roster change (late arrival / injury) is reflected accurately.
  const activeSquadSize = useMemo(() => {
    const names = new Set();
    if (seg) {
      Object.values(seg.assignment).forEach(n => { if (n) names.add(n); });
      seg.bench.forEach(n => { if (n) names.add(n); });
    }
    return names.size || players.length;
  }, [seg, players.length]);

  const { minutesMap } = useMemo(() => calcStats(segments, players), [segments, players]);

  const upcomingSubs = useMemo(() => {
    if (currentSeg >= segments.length - 1) return [];
    return getSubChanges(segments[currentSeg], segments[currentSeg + 1])
      .filter(c => c.type === 'sub')
      .map(c => ({ pos: c.pos, on: c.on, off: c.off }));
  }, [currentSeg, segments]);

  const trackedGoals = useMemo(
    () => Object.values(matchStats).reduce((sum, st) => sum + (st.goals || 0), 0),
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
    // Resync immediately on any run-state change — without this the first
    // render after START used a stale `now`, making the readout jump for the
    // first 1–2 seconds (Session 10 watch-list item).
    setNow(Date.now());
    if (gameClock.isRunning) {
      interval = setInterval(() => setNow(Date.now()), 500);
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

  // Rebalance-on-finish (ISSUES.md Issue 1). Snapshot the segment's bench
  // membership when edit mode opens; when edit mode closes, if players were
  // moved between field and bench (not just repositioned), ask App to re-pick
  // bench duty for the rest of the game. Deliberately depends on editMode
  // only — the snapshot must not refresh while the coach is mid-edit.
  const editSnapshotRef = useRef(null);
  useEffect(() => {
    if (editMode) {
      const sg = segments[currentSeg];
      editSnapshotRef.current = sg
        ? { segIdx: currentSeg, bench: sg.bench.filter(Boolean).sort() }
        : null;
      return;
    }
    const snap = editSnapshotRef.current;
    editSnapshotRef.current = null;
    if (!snap || snap.segIdx >= segments.length - 1) return;
    const sg = segments[snap.segIdx];
    if (!sg) return;
    const nowBench = sg.bench.filter(Boolean).sort();
    const changed = nowBench.length !== snap.bench.length ||
      nowBench.some((n, i) => n !== snap.bench[i]);
    if (changed) onRebalance?.(snap.segIdx);
  }, [editMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSegIdx = gameClock.currentSegIdx !== null ? gameClock.currentSegIdx : currentSeg;
  const activeSeg = segments[activeSegIdx];

  // Math.max(0, …) guards the one render where `now` predates segmentStartTime
  // (START was just pressed and the interval hasn't ticked yet)
  const elapsedMs = gameClock.accumulatedMs + (gameClock.isRunning && gameClock.segmentStartTime ? Math.max(0, now - gameClock.segmentStartTime) : 0);
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
      // The boundary modal used to fire here. It is replaced by the persistent
      // red CONFIRM SUBS bar, which arms itself from `pendingSubs` below and
      // does not disappear until the coach taps it.
    }
  }, [gameClock.currentSegIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const remainingSecsTotal = Math.max(0, Math.floor(remainingMsTotal / 1000));
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

  const isEffectivelyLocked = seg?.locked || (gameClock.currentSegIdx !== null && currentSeg < gameClock.currentSegIdx);
  const isViewingActive = currentSeg === activeSegIdx;
  const isKidsView = orientation !== 'vertical';

  // ── Subs-outstanding state ────────────────────────────────────────────────
  // The subs that were due at the START of the period now being played.
  const pendingSubs = useMemo(() => {
    if (activeSegIdx <= 0 || !segments[activeSegIdx - 1] || !segments[activeSegIdx]) return [];
    return getSubChanges(segments[activeSegIdx - 1], segments[activeSegIdx])
      .filter(c => c.type === 'sub')
      .map(c => ({ pos: c.pos, on: c.on, off: c.off }));
  }, [activeSegIdx, segments]);

  const subsArmed = gameClock.currentSegIdx !== null
    && activeSegIdx > 0
    && pendingSubs.length > 0
    && subsAckFor !== activeSegIdx;

  const showAckFlash = ackFlashFor === activeSegIdx;

  // A new period wipes any lingering "✓ · UNDO" from the previous one.
  useEffect(() => {
    setAckFlashFor(null);
    clearTimeout(ackTimerRef.current);
  }, [activeSegIdx]);

  useEffect(() => () => clearTimeout(ackTimerRef.current), []);

  const acknowledgeSubs = () => {
    setSubsAckFor(activeSegIdx);
    setAckFlashFor(activeSegIdx);
    clearTimeout(ackTimerRef.current);
    ackTimerRef.current = setTimeout(() => setAckFlashFor(null), 8000);
  };

  const undoAcknowledge = () => {
    clearTimeout(ackTimerRef.current);
    setSubsAckFor(null);
    setAckFlashFor(null);
  };

  // Minutes actually on the pitch SO FAR — not the whole-game projection that
  // calcStats returns. The player sheet says "26 min played", so it has to mean
  // played, not scheduled. Counts completed periods plus time in the live one.
  const minutesPlayedSoFar = (name) => {
    if (gameClock.currentSegIdx === null) return 0;
    let mins = 0;
    for (let i = 0; i <= activeSegIdx && i < segments.length; i++) {
      if (!Object.values(segments[i].assignment).includes(name)) continue;
      mins += i < activeSegIdx ? segments[i].duration : Math.floor(elapsedMs / 60000);
    }
    return mins;
  };

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

  const enterEditMode = (segIdx, from) => {
    setCurrentSeg(segIdx);
    setEditMode(true);
    setSwapFrom(from || null);
  };

  // Every path into the lineup editor goes through here so a live period is
  // always split at the sub moment rather than rewritten whole (Session 10).
  const handleEmergencySub = (from = null) => {
    if (!onSplitSegment) { enterEditMode(currentSeg, from); return; }
    const elapsedMinsForSplit = Math.floor(elapsedMs / 60000);
    // Fast path: the clock is actively timing THIS period — split at the live time.
    if (gameClock.isRunning && gameClock.currentSegIdx === currentSeg && elapsedMinsForSplit > 0) {
      const futureSegIdx = onSplitSegment(currentSeg, elapsedMinsForSplit);
      if (futureSegIdx != null) enterEditMode(futureSegIdx, from);
      return;
    }
    // Clock isn't timing this period (paused, not started, or we scrolled to it).
    // Ask how far in we are instead of silently rewriting the whole period.
    pendingSwapRef.current = from;
    const guess = elapsedMinsForSplit > 0 && elapsedMinsForSplit < seg.duration ? elapsedMinsForSplit : '';
    setSubPromptMins(String(guess));
    setSubPrompt(true);
  };

  // Coach gave a split time: lock the played part, edit only the rest.
  const confirmSubFromTime = () => {
    const mins = parseInt(subPromptMins, 10);
    if (!Number.isFinite(mins) || mins < 1 || mins > seg.duration - 1) return;
    const futureSegIdx = onSplitSegment(currentSeg, mins);
    setSubPrompt(false);
    const from = pendingSwapRef.current;
    pendingSwapRef.current = null;
    if (futureSegIdx != null) enterEditMode(futureSegIdx, from);
  };

  // Coach chose to change the whole period (only sensible before it starts).
  const editWholePeriod = () => {
    setSubPrompt(false);
    const from = pendingSwapRef.current;
    pendingSwapRef.current = null;
    enterEditMode(currentSeg, from);
  };

  const handleMovePlayer = () => {
    const name = activePlayer;
    if (!name) return;
    const onBench = seg.bench.includes(name);
    const pos = !onBench
      ? Object.entries(seg.assignment).find(([, n]) => n === name)?.[0]
      : null;
    setActivePlayer(null);
    handleEmergencySub(onBench ? { type: 'bench', name } : { type: 'pos', pos, name });
  };

  if (!seg) return null;

  // ── Derived rail data ─────────────────────────────────────────────────────
  const countdownText = fmtCountdown(remainingSecsTotal);
  const showCountdown = isViewingActive && gameClock.currentSegIdx !== null;
  const subImminent = showCountdown && remainingSecsTotal <= 120;

  const incomingNames = new Set(upcomingSubs.map(c => c.on));
  const waitingBench = seg.bench.filter(n => n && !incomingNames.has(n));

  const backOn = upcomingSubs
    .map(c => ({ name: c.off, info: c.off ? nextAppearance(segments, currentSeg, c.off) : null }))
    .filter(r => r.name);

  const minutesSorted = Object.entries(minutesMap)
    .filter(([name]) => {
      // Only players still involved — a removed player shouldn't skew the chart.
      const inSeg = Object.values(seg.assignment).includes(name) || seg.bench.includes(name);
      return inSeg || minutesMap[name] > 0;
    })
    .sort((a, b) => b[1] - a[1]);
  const maxMinutes = minutesSorted.length ? minutesSorted[0][1] : 1;
  const lowestMinutes = minutesSorted.length ? minutesSorted[minutesSorted.length - 1][1] : 0;
  const minutesSpread = minutesSorted.length
    ? `${lowestMinutes}–${minutesSorted[0][1]}m`
    : '';

  // ── Shared style helpers ──────────────────────────────────────────────────
  const bandSwatch = (pos, w, h) => ({
    width: s(w), height: s(h), borderRadius: s(4), flexShrink: 0,
    background: POS_BG[pos] || UI.track,
    boxShadow: (POS_BG[pos] || '').toLowerCase() === '#ffffff'
      ? `inset 0 0 0 ${Math.max(2, s(2))}px ${UI.navy}` : 'none',
  });

  const sectionLabel = {
    fontSize: Math.max(13, s(16)), fontWeight: 900, letterSpacing: s(2),
    color: UI.label, textTransform: 'uppercase',
  };

  const modalBackdrop = {
    position: 'fixed', inset: 0, background: UI.backdrop,
    display: 'flex', justifyContent: 'center', alignItems: 'center',
    zIndex: 240, padding: s(24), boxSizing: 'border-box',
  };
  const modalCard = {
    background: '#fff', padding: s(30), borderRadius: s(24), width: '100%',
    maxWidth: s(560), maxHeight: '88vh', overflowY: 'auto', boxSizing: 'border-box',
  };
  const modalTitle = {
    fontSize: Math.max(22, s(34)), fontWeight: 800, color: UI.navy,
    marginTop: 0, marginBottom: s(10), letterSpacing: -0.5,
  };
  const modalBody = {
    fontSize: Math.max(15, s(20)), fontWeight: 700, color: UI.bodyText,
    marginBottom: s(20), lineHeight: 1.45,
  };
  const inputStyle = {
    width: '100%', padding: s(16), borderRadius: s(12),
    border: `3px solid ${UI.blueLine}`, fontSize: Math.max(16, s(22)),
    fontWeight: 700, color: UI.navy, background: '#fff',
    boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
  };
  const btnGhost = {
    padding: s(18), borderRadius: s(12), background: '#fff',
    border: `3px solid ${UI.blueLine}`, color: UI.bodyText,
    fontSize: Math.max(15, s(21)), fontWeight: 800, cursor: 'pointer',
    fontFamily: 'inherit',
  };
  const btnSolid = (bg) => ({
    padding: s(18), borderRadius: s(12), background: bg, border: 'none',
    color: '#fff', fontSize: Math.max(15, s(21)), fontWeight: 900,
    cursor: 'pointer', fontFamily: 'inherit',
  });

  const clockNotRunning = !gameClock.isRunning;
  const halfLabel = seg.half === 1 ? '1ST HALF' : '2ND HALF';
  const runState = gameClock.currentSegIdx === null ? 'NOT STARTED'
    : gameClock.isRunning ? 'RUNNING' : 'PAUSED';
  const clockDisplay = gameClock.currentSegIdx !== null
    ? `${String(Math.floor(remainingSecsTotal / 60)).padStart(2, '0')}:${String(remainingSecsTotal % 60).padStart(2, '0')}`
    : `${String(activeSeg.duration).padStart(2, '0')}:00`;

  return (
    <div style={{
      minHeight: '100vh', background: UI.page,
      fontFamily: 'system-ui, "Segoe UI", sans-serif',
      fontVariantNumeric: 'tabular-nums',
      display: 'flex', flexDirection: 'column', color: UI.navy,
    }}>

      {/* ══ Header ══ The whole bar turns amber when the clock is not running.
          Not dismissible, no timeout — this is the forgotten-clock fix. */}
      <header style={{
        background: clockNotRunning ? UI.warn : UI.navy,
        minHeight: s(96), padding: `${s(10)}px ${s(22)}px`, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: s(16), flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: s(14), minWidth: 0 }}>
          <div style={{
            fontSize: Math.max(34, s(58)), fontWeight: 800, letterSpacing: s(-2),
            color: '#fff', lineHeight: 1,
          }}>
            {clockDisplay}
          </div>
          <div style={{
            fontSize: Math.max(12, s(17)), fontWeight: 900, letterSpacing: s(2),
            color: clockNotRunning ? UI.warnOnDark : UI.onNavyMuted, whiteSpace: 'nowrap',
          }}>
            P{activeSegIdx + 1} · {halfLabel} · {runState}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: s(10) }}>
          <div style={{
            fontSize: Math.max(15, s(21)), fontWeight: 800, color: '#fff',
            whiteSpace: 'nowrap', marginRight: s(6),
          }}>
            ⚽ {trackedGoals}
          </div>

          <button
            onClick={() => onNudgeClock?.(60)}
            style={{
              width: s(64), height: s(64), background: 'transparent',
              border: `2px solid ${clockNotRunning ? UI.warnOnDark : UI.onNavyBorder}`,
              borderRadius: s(10), color: '#fff', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', fontFamily: 'inherit', flexShrink: 0,
            }}>
            <span style={{ fontSize: Math.max(18, s(28)), fontWeight: 800, lineHeight: 1 }}>−</span>
            <span style={{ fontSize: Math.max(10, s(13)), fontWeight: 800, letterSpacing: s(1), color: clockNotRunning ? UI.warnOnDark : UI.onNavyMuted }}>1 MIN</span>
          </button>

          {gameClock.isRunning ? (
            <button
              onClick={() => onPausePeriod?.()}
              style={{
                background: UI.go, border: 'none', borderRadius: s(10),
                padding: `${s(12)}px ${s(24)}px`, color: '#fff',
                fontSize: Math.max(16, s(21)), fontWeight: 900, cursor: 'pointer',
                fontFamily: 'inherit', whiteSpace: 'nowrap', minHeight: s(64),
              }}>
              ▮▮ PAUSE
            </button>
          ) : (
            <button
              onClick={() => { unlockAudio(); acquireWakeLock(); onStartPeriod?.(activeSegIdx); }}
              style={{
                background: '#fff', border: 'none', borderRadius: s(10),
                padding: `${s(16)}px ${s(30)}px`, color: UI.navy,
                fontSize: Math.max(20, s(30)), fontWeight: 900, cursor: 'pointer',
                fontFamily: 'inherit', whiteSpace: 'nowrap', minHeight: s(64),
              }}>
              ▶ START
            </button>
          )}

          <button
            onClick={() => onNudgeClock?.(-60)}
            style={{
              width: s(64), height: s(64), background: 'transparent',
              border: `2px solid ${clockNotRunning ? UI.warnOnDark : UI.onNavyBorder}`,
              borderRadius: s(10), color: '#fff', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', fontFamily: 'inherit', flexShrink: 0,
            }}>
            <span style={{ fontSize: Math.max(18, s(28)), fontWeight: 800, lineHeight: 1 }}>+</span>
            <span style={{ fontSize: Math.max(10, s(13)), fontWeight: 800, letterSpacing: s(1), color: clockNotRunning ? UI.warnOnDark : UI.onNavyMuted }}>1 MIN</span>
          </button>
        </div>
      </header>

      {clockNotRunning && (
        <div style={{
          background: UI.warn, color: UI.warnOnDark, padding: `0 ${s(22)}px ${s(10)}px`,
          fontSize: Math.max(14, s(19)), fontWeight: 800, flexShrink: 0,
        }}>
          Clock is not running — tap START when the referee restarts.
        </div>
      )}

      {/* ══ Period pips ══ */}
      <div style={{
        background: '#fff', padding: `${s(11)}px ${s(16)}px`,
        borderBottom: `2px solid ${UI.blueLine}`, flexShrink: 0,
        display: 'flex', gap: s(8), alignItems: 'center', overflowX: 'auto',
      }}>
        {segments.map((sg, i) => {
          const done = sg.locked || (gameClock.currentSegIdx !== null && i < gameClock.currentSegIdx);
          const isNow = i === currentSeg;
          const isNext = i === activeSegIdx + 1 && subImminent;

          // Every pip shares the row evenly; the current one gets a little more
          // so it reads as the anchor without swallowing the whole bar.
          let style = {
            background: UI.page, border: `2px solid ${UI.blueLine}`, color: UI.label,
            fontWeight: 800, flex: 1,
          };
          let text = `P${i + 1}`;
          if (done) {
            style = { background: UI.track, border: '2px solid transparent', color: UI.label, fontWeight: 800, flex: 1 };
            text = `P${i + 1} ✓`;
          }
          if (isNext) {
            style = { background: '#fff', border: `3px solid ${UI.stop}`, color: UI.stop, fontWeight: 900, flex: 1.3 };
            text = `P${i + 1} · ${countdownText}`;
          }
          if (isNow) {
            style = { background: UI.navy, border: '2px solid transparent', color: '#fff', fontWeight: 900, flex: 1.4 };
            text = `P${i + 1}${i === activeSegIdx ? ' · NOW' : ''}`;
          }

          return (
            <div key={i} style={{ display: 'flex', gap: s(8), alignItems: 'center', flex: style.flex }}>
              {sg.htBefore && (
                <div style={{
                  width: s(42), height: s(44), borderRadius: s(10), flexShrink: 0,
                  background: UI.page, border: `2px solid ${UI.blueLine}`, color: UI.label,
                  fontSize: Math.max(12, s(14)), fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>HT</div>
              )}
              <button
                onClick={() => { setCurrentSeg(i); setSwapFrom(null); setEditMode(false); }}
                style={{
                  height: s(44), borderRadius: s(10), padding: `0 ${s(14)}px`,
                  fontSize: Math.max(13, s(17)), cursor: 'pointer', whiteSpace: 'nowrap',
                  fontFamily: 'inherit', flex: 1, ...style,
                }}>
                {text}
              </button>
            </div>
          );
        })}
      </div>

      {/* ══ Body ══ */}
      <main style={{
        flex: 1, minHeight: 0, display: 'flex', gap: s(14),
        padding: `${s(14)}px ${s(16)}px`,
        flexDirection: isKidsView ? 'column' : 'row',
      }}>
        {/* Pitch */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          {isKidsView && (
            <button
              onClick={() => setOrientation(o => o === 'horizontal-right' ? 'horizontal-left' : 'horizontal-right')}
              style={{ ...btnGhost, marginBottom: s(10), alignSelf: 'center' }}>
              {orientation === 'horizontal-right' ? '⬅️ Attacking Left' : 'Attacking Right ➡️'}
            </button>
          )}
          <FieldView
            assignment={seg.assignment}
            highlight={activePlayer}
            swapFrom={editMode ? swapFrom : null}
            onPlayerClick={handleFieldClick}
            upcomingSubs={editMode ? [] : upcomingSubs}
            orientation={orientation}
            subCountdown={showCountdown ? countdownText : null}
            scale={scale}
          />
        </div>

        {/* Bench rail — the answers to "who am I on for?" and "when am I back on?" */}
        {!isKidsView && (
          <div style={{
            width: s(322), flexShrink: 0, display: 'flex', flexDirection: 'column',
            gap: s(11), minHeight: 0,
          }}>
            {upcomingSubs.length > 0 && (
              <div style={{
                background: subImminent ? UI.stop : UI.navy, borderRadius: s(12),
                padding: `${s(10)}px ${s(14)}px`, display: 'flex',
                justifyContent: 'space-between', alignItems: 'baseline', gap: s(8),
              }}>
                <span style={{ fontSize: Math.max(17, s(24)), fontWeight: 900, color: '#fff' }}>NEXT CHANGE</span>
                <span style={{ fontSize: Math.max(17, s(24)), fontWeight: 900, color: '#fff' }}>
                  {showCountdown ? countdownText : '—'}
                </span>
              </div>
            )}

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: s(11) }}>
              {/* Coming on at the next change */}
              {upcomingSubs.map(change => {
                const isSel = editMode && swapFrom?.type === 'bench' && swapFrom.name === change.on;
                return (
                  <div key={change.on} onClick={() => handleBenchClick(change.on)} style={{
                    background: isSel ? UI.goTint : '#fff',
                    border: `4px solid ${isSel ? UI.go : UI.navy}`,
                    borderRadius: s(14), padding: `${s(13)}px ${s(15)}px`,
                    display: 'flex', gap: s(12), alignItems: 'center',
                    cursor: isEffectivelyLocked ? 'default' : 'pointer',
                  }}>
                    <div style={bandSwatch(change.pos, 16, 52)} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: Math.max(21, s(31)), fontWeight: 800, color: UI.navy, lineHeight: 1.1 }}>
                        {change.on}
                      </div>
                      <div style={{ fontSize: Math.max(14, s(18)), fontWeight: 700, color: UI.go }}>
                        ▲ ON for {change.off || 'nobody'} · {change.pos}
                      </div>
                    </div>
                  </div>
                );
              })}

              {waitingBench.length > 0 && (
                <>
                  <div style={sectionLabel}>Waiting</div>
                  {waitingBench.map(name => {
                    const info = nextAppearance(segments, currentSeg, name);
                    const replaced = info && segments[info.segIdx - 1]
                      ? segments[info.segIdx - 1].assignment[info.pos]
                      : null;
                    const isSel = editMode && swapFrom?.type === 'bench' && swapFrom.name === name;
                    return (
                      <div key={name} onClick={() => handleBenchClick(name)} style={{
                        background: isSel ? UI.goTint : '#fff',
                        border: `2px solid ${isSel ? UI.go : UI.blueLine}`,
                        borderRadius: s(14), padding: `${s(13)}px ${s(15)}px`,
                        display: 'flex', gap: s(12), alignItems: 'center',
                        cursor: isEffectivelyLocked ? 'default' : 'pointer',
                      }}>
                        <div style={bandSwatch(info ? info.pos : 'CB', 16, 52)} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: Math.max(21, s(31)), fontWeight: 800, color: UI.navy, lineHeight: 1.1 }}>
                            {name}
                          </div>
                          <div style={{ fontSize: Math.max(14, s(18)), fontWeight: 700, color: UI.label }}>
                            {info
                              ? `▲ ON at ${info.minute}′${replaced ? ` for ${replaced}` : ''} · ${info.pos}`
                              : 'Not back on this game'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {backOn.length > 0 && (
                <>
                  <div style={sectionLabel}>Back on</div>
                  <div style={{
                    border: `2px solid ${UI.blueLine}`, borderRadius: s(14),
                    padding: `${s(12)}px ${s(15)}px`, background: '#fff',
                    display: 'flex', flexDirection: 'column', gap: s(6),
                  }}>
                    {backOn.map(({ name, info }) => (
                      <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: s(10) }}>
                        <span style={{ fontSize: Math.max(16, s(22)), fontWeight: 800, color: UI.navy }}>{name}</span>
                        <span style={{ fontSize: Math.max(14, s(19)), fontWeight: 700, color: UI.bodyText, whiteSpace: 'nowrap' }}>
                          {info ? `${info.minute}′ · ${info.pos}` : 'done for today'}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Minutes */}
            {minutesSorted.length > 0 && (
              <div style={{
                border: `2px solid ${UI.blueLine}`, borderRadius: s(14),
                padding: `${s(12)}px ${s(15)}px`, background: '#fff', flexShrink: 0,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: s(8) }}>
                  <span style={sectionLabel}>Minutes</span>
                  <span style={{ fontSize: Math.max(13, s(15)), fontWeight: 800, color: UI.bodyText }}>{minutesSpread}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: s(4), height: s(50) }}>
                  {minutesSorted.map(([name, mins], i) => {
                    const isLowest = mins === lowestMinutes && i === minutesSorted.length - 1;
                    const isLowPair = i >= minutesSorted.length - 3;
                    return (
                      <div key={name} title={`${name}: ${mins}m`} style={{
                        flex: 1, height: `${Math.max(8, (mins / (maxMinutes || 1)) * 100)}%`,
                        borderRadius: `${s(3)}px ${s(3)}px 0 0`,
                        background: isLowest ? UI.stop : isLowPair ? UI.label : UI.navy,
                      }} />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ══ Action stack ══ */}
      {!isKidsView && (
        <div style={{
          padding: `0 ${s(16)}px ${s(14)}px`, flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: s(10),
        }}>
          {/* Confirm-subs button / edit-mode control / lock message */}
          {editMode ? (
            <button
              onClick={() => { setEditMode(false); setSwapFrom(null); }}
              style={{ ...btnSolid(UI.navy), width: '100%', padding: s(22), fontSize: Math.max(18, s(24)) }}>
              ✅ FINISH EDITING
            </button>
          ) : isEffectivelyLocked ? (
            <div style={{
              padding: s(20), textAlign: 'center', fontSize: Math.max(16, s(21)),
              fontWeight: 800, color: UI.label, background: '#fff',
              border: `2px dashed ${UI.blueLine}`, borderRadius: s(14),
            }}>
              🔒 This period is finished
            </div>
          ) : subsArmed ? (
            <button
              onClick={acknowledgeSubs}
              style={{
                width: '100%', background: UI.stop, border: 'none', borderRadius: s(14),
                padding: s(22), color: '#fff', fontSize: Math.max(18, s(24)),
                fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit',
                minHeight: s(88), lineHeight: 1.3,
              }}>
              ✓ SUBS DONE — {pendingSubs.map(c => `${c.on} ▶ ${c.pos}`).join(' · ')}
            </button>
          ) : showAckFlash ? (
            <div style={{
              width: '100%', background: '#fff', border: `3px solid ${UI.go}`,
              borderRadius: s(14), padding: s(18), minHeight: s(88),
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: s(12),
            }}>
              <span style={{ fontSize: Math.max(17, s(23)), fontWeight: 900, color: UI.go }}>Subs made ✓</span>
              <button onClick={undoAcknowledge} style={{ ...btnGhost, padding: `${s(12)}px ${s(22)}px` }}>UNDO</button>
            </div>
          ) : (
            <div style={{
              width: '100%', background: '#fff', border: `2px solid ${UI.blueLine}`,
              borderRadius: s(14), padding: s(18), minHeight: s(88), boxSizing: 'border-box',
              display: 'flex', alignItems: 'center', gap: s(12),
            }}>
              <span style={{ fontSize: Math.max(16, s(22)), fontWeight: 800, color: UI.label }}>
                {upcomingSubs.length === 0
                  ? 'No more changes this period'
                  : `Next change ${showCountdown ? `in ${countdownText}` : 'at the end of this period'} · ${upcomingSubs.map(c => c.on).join(', ')}`}
              </span>
            </div>
          )}

          {/* Tool row */}
          {!editMode && (
            <div style={{ display: 'flex', gap: s(9) }}>
              {[
                { key: 'goal',    label: 'GOAL',    icon: '⚽', filled: true,  onClick: () => setGoalPicker({ scorer: null }) },
                { key: 'gk',      label: 'GK',      icon: '🧤', onClick: () => setGkPickerOpen(true), disabled: isEffectivelyLocked },
                { key: 'squad',   label: 'SQUAD',   icon: '👥', onClick: () => setSquadOpen(true) },
                { key: 'honours', label: 'HONOURS', icon: '🏆', onClick: () => setHonoursOpen(true) },
                { key: 'season',  label: 'SEASON',  icon: '📅', onClick: onGoSeason },
                { key: 'save',    label: 'SAVE',    icon: '💾', onClick: () => openSaveModal(String(trackedGoals)) },
              ].map(tool => (
                <button
                  key={tool.key}
                  onClick={tool.disabled ? undefined : tool.onClick}
                  style={{
                    flex: 1, height: s(88), borderRadius: s(12),
                    background: tool.filled ? UI.navy : '#fff',
                    border: tool.filled ? 'none' : `3px solid ${UI.navy}`,
                    color: tool.filled ? '#fff' : UI.navy,
                    opacity: tool.disabled ? 0.4 : 1,
                    cursor: tool.disabled ? 'default' : 'pointer', fontFamily: 'inherit',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', gap: s(2),
                  }}>
                  <span style={{ fontSize: Math.max(18, s(25)) }}>{tool.icon}</span>
                  <span style={{ fontSize: Math.max(12, s(17)), fontWeight: 900, letterSpacing: s(0.5) }}>{tool.label}</span>
                </button>
              ))}
            </div>
          )}

          {isSaved && (
            <button onClick={onGoSetup} style={{ ...btnSolid(UI.navy), width: '100%' }}>
              ➕ START NEW MATCH
            </button>
          )}
        </div>
      )}

      {isKidsView && (
        <div style={{ padding: `0 ${s(16)}px ${s(14)}px`, flexShrink: 0 }}>
          <button onClick={() => setOrientation('vertical')} style={{ ...btnSolid(UI.navy), width: '100%' }}>
            📱 BACK TO COACH VIEW
          </button>
        </div>
      )}

      {/* ══ Player answer sheet (2b) ══ */}
      {activePlayer && (
        <div onClick={() => setActivePlayer(null)} style={{
          position: 'fixed', inset: 0, background: UI.scrim, zIndex: 98,
        }} />
      )}
      {activePlayer && (() => {
        const { sGoals, sAssists } = getSeasonStats(activePlayer);
        const onBench = seg.bench.includes(activePlayer);
        const pos = onBench
          ? null
          : Object.entries(seg.assignment).find(([, n]) => n === activePlayer)?.[0];
        const comingOff = upcomingSubs.find(c => c.off === activePlayer) || null;
        const comingOn = upcomingSubs.find(c => c.on === activePlayer) || null;
        const back = nextAppearance(segments, currentSeg, activePlayer);
        const came = lastAppearance(segments, currentSeg, activePlayer);
        const offMinute = getStartMin(segments, currentSeg) + seg.duration;
        const benchMins = back ? back.minute - offMinute : null;

        const swatchPos = pos || (comingOn ? comingOn.pos : (back ? back.pos : 'CB'));
        const bandName = POS_BAND[swatchPos] || '';

        const answerCard = (bg, labelCol, label, value, caption) => (
          <div style={{
            flex: 1, background: bg, borderRadius: s(18), padding: `${s(24)}px ${s(26)}px`,
            minWidth: 0,
          }}>
            <div style={{ fontSize: Math.max(15, s(21)), fontWeight: 900, letterSpacing: s(2), color: labelCol }}>
              {label}
            </div>
            <div style={{
              fontSize: Math.max(48, s(96)), fontWeight: 800, letterSpacing: s(-3),
              color: bg === UI.page ? UI.bodyText : '#fff', lineHeight: 1.05,
            }}>
              {value}
            </div>
            {caption && (
              <div style={{ fontSize: Math.max(16, s(24)), fontWeight: 700, color: labelCol }}>
                {caption}
              </div>
            )}
          </div>
        );

        const stepper = (icon, label, type) => (
          <div style={{
            flex: 1, border: `3px solid ${UI.blueLine}`, borderRadius: s(16),
            padding: `${s(16)}px ${s(20)}px`, display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: s(12), minWidth: 0,
          }}>
            <span style={{ fontSize: Math.max(17, s(24)), fontWeight: 900, color: UI.navy, whiteSpace: 'nowrap' }}>
              {icon} {label}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: s(10) }}>
              <button onClick={() => updateStat(activePlayer, type, -1)} style={{
                width: s(64), height: s(64), border: `3px solid ${UI.blueLine}`,
                borderRadius: s(12), background: '#fff', color: UI.bodyText,
                fontSize: Math.max(24, s(36)), fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
              }}>−</button>
              <span style={{ fontSize: Math.max(30, s(46)), fontWeight: 800, color: UI.navy, minWidth: s(40), textAlign: 'center' }}>
                {matchStats[activePlayer]?.[type] || 0}
              </span>
              <button onClick={() => updateStat(activePlayer, type, 1)} style={{
                width: s(64), height: s(64), border: 'none', borderRadius: s(12),
                background: UI.navy, color: '#fff',
                fontSize: Math.max(24, s(36)), fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
              }}>+</button>
            </div>
          </div>
        );

        return (
          <div style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 100,
            background: '#fff', borderTop: `8px solid ${UI.navy}`,
            borderRadius: `${s(28)}px ${s(28)}px 0 0`,
            padding: `${s(30)}px ${s(32)}px ${s(34)}px`, boxSizing: 'border-box',
            maxHeight: '92vh', overflowY: 'auto',
          }}>
            {/* Identity */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: s(20), marginBottom: s(26) }}>
              <div style={{ display: 'flex', gap: s(20), alignItems: 'center', minWidth: 0 }}>
                <div style={{
                  width: s(116), height: s(116), borderRadius: '50%', flexShrink: 0,
                  background: POS_BG[swatchPos] || UI.track,
                  border: `6px solid ${UI.navy}`, boxSizing: 'border-box',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  color: POS_TEXT[swatchPos] || UI.navy,
                }}>
                  <span style={{ fontSize: Math.max(13, s(19)), fontWeight: 900 }}>{pos || 'SUB'}</span>
                  <span style={{ fontSize: Math.max(15, s(22)), fontWeight: 800 }}>{bandName}</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: Math.max(40, s(78)), fontWeight: 800, letterSpacing: s(-2),
                    color: UI.navy, lineHeight: 1,
                  }}>
                    {activePlayer}
                  </div>
                  <div style={{ fontSize: Math.max(16, s(24)), fontWeight: 700, color: UI.bodyText, marginTop: s(6) }}>
                    {pos ? `${POS_LABEL[pos]} · ` : 'On the bench · '}
                    {bandName} wristband · {minutesPlayedSoFar(activePlayer)} min played
                    {(sGoals > 0 || sAssists > 0) && ` · season ${sGoals}G ${sAssists}A`}
                  </div>
                </div>
              </div>
              <button onClick={() => setActivePlayer(null)} style={{
                ...btnGhost, padding: `${s(16)}px ${s(26)}px`, flexShrink: 0,
                fontSize: Math.max(17, s(24)),
              }}>Close ✕</button>
            </div>

            {/* The two answers */}
            <div style={{ display: 'flex', gap: s(16), marginBottom: s(16) }}>
              {onBench ? (
                <>
                  {answerCard(UI.go, UI.goOnDark, 'YOU GO ON IN',
                    comingOn ? (showCountdown ? countdownText : 'next') : (back ? `${back.minute}′` : '—'),
                    comingOn ? `On for ${comingOn.off || 'nobody'} · ${comingOn.pos}`
                      : back ? `${POS_LABEL[back.pos]} · ${back.pos}` : 'Not back on this game')}
                  {answerCard(UI.navy, UI.onNavyMuted, 'YOU CAME OFF AT',
                    came ? `${came.minute}′` : '—',
                    came ? `You were at ${POS_LABEL[came.pos]}` : 'Not on yet today')}
                </>
              ) : (
                <>
                  {comingOff
                    ? answerCard(UI.stop, UI.stopOnDark, 'YOU COME OFF IN',
                        showCountdown ? countdownText : 'end of period',
                        `${comingOff.on} is coming on for you`)
                    : answerCard(UI.page, UI.bodyText, 'YOU STAY ON',
                        '✓', 'On for the rest of this period')}
                  {back
                    ? answerCard(UI.go, UI.goOnDark, 'YOU GO BACK ON AT',
                        `${back.minute}′`,
                        `${POS_LABEL[back.pos]}${benchMins != null && benchMins > 0 ? ` · ${benchMins} min on the bench` : ''}`)
                    : answerCard(UI.page, UI.bodyText, 'AFTER THAT',
                        '—', comingOff ? 'Done for today' : 'On for the rest of the half')}
                </>
              )}
            </div>

            {/* Goals / assists */}
            <div style={{ display: 'flex', gap: s(16), marginBottom: s(16) }}>
              {stepper('⚽', 'GOALS', 'goals')}
              {stepper('👟', 'ASSISTS', 'assists')}
            </div>

            {/* Coach actions — hidden when the iPad is being shown to the kids */}
            {!isKidsView && !isEffectivelyLocked && (
              <div style={{ display: 'flex', gap: s(16) }}>
                <button onClick={handleMovePlayer} style={{
                  flex: 1, border: `3px solid ${UI.navy}`, borderRadius: s(16), padding: s(20),
                  fontSize: Math.max(16, s(22)), fontWeight: 900, color: UI.navy,
                  background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                }}>🔀 MOVE POSITION</button>
                <button
                  onClick={() => { setConfirmGK({ name: activePlayer }); setActivePlayer(null); }}
                  disabled={seg.assignment.GK === activePlayer}
                  style={{
                    flex: 1, border: `3px solid ${UI.navy}`, borderRadius: s(16), padding: s(20),
                    fontSize: Math.max(16, s(22)), fontWeight: 900, color: UI.navy,
                    background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                    opacity: seg.assignment.GK === activePlayer ? 0.4 : 1,
                  }}>🧤 PUT IN GOAL</button>
                <button
                  onClick={() => {
                    setPlayerOutName(activePlayer);
                    setPlayerOutReplacement('');
                    setActivePlayer(null);
                    setPlayerOutOpen(true);
                  }}
                  style={{
                    flex: 1, border: `3px solid ${UI.navy}`, borderRadius: s(16), padding: s(20),
                    fontSize: Math.max(16, s(22)), fontWeight: 900, color: UI.navy,
                    background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                  }}>➖ MARK OUT</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ══ Quick goal picker ══ */}
      {goalPicker && (
        <div style={{ ...modalBackdrop, zIndex: 260 }}>
          <div style={modalCard}>
            <h2 style={modalTitle}>{goalPicker.scorer ? '👟 Who assisted?' : '⚽ Who scored?'}</h2>
            <div style={modalBody}>
              {goalPicker.scorer
                ? `${goalPicker.scorer} scored. Tap whoever set it up, or skip.`
                : 'Tap the scorer. You can still adjust any player from their own sheet on the pitch.'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: s(10) }}>
              {players
                .filter(p => !goalPicker.scorer || p !== goalPicker.scorer)
                .map(p => (
                  <button key={p} onClick={() => {
                    if (goalPicker.scorer) {
                      updateStat(p, 'assists', 1);
                      setGoalPicker(null);
                    } else {
                      updateStat(p, 'goals', 1);
                      setGoalPicker({ scorer: p });
                    }
                  }} style={{
                    border: `3px solid ${UI.blueLine}`, borderRadius: s(12),
                    padding: `${s(14)}px ${s(22)}px`, fontSize: Math.max(20, s(30)),
                    fontWeight: 800, color: UI.navy, background: '#fff',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>{p}</button>
                ))}
            </div>
            <div style={{ display: 'flex', gap: s(12), marginTop: s(24) }}>
              <button onClick={() => setGoalPicker(null)} style={{ ...btnGhost, flex: 1 }}>
                {goalPicker.scorer ? 'No assist' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Squad sheet — late player, player out, notes, kids view, resets ══ */}
      {squadOpen && (
        <div style={{ ...modalBackdrop, zIndex: 230 }}>
          <div style={modalCard}>
            <h2 style={modalTitle}>👥 Squad &amp; game</h2>
            <div style={modalBody}>
              {activeSquadSize} players · {seg.bench.length} on the bench
            </div>

            {!isEffectivelyLocked && onRosterChange && (
              <div style={{ display: 'flex', gap: s(12), marginBottom: s(20) }}>
                <button onClick={() => { setLatePlayerName(''); setSquadOpen(false); setLatePlayerOpen(true); }}
                  style={{ ...btnGhost, flex: 1, borderColor: UI.navy, color: UI.navy, fontWeight: 900 }}>
                  ➕ LATE PLAYER
                </button>
                <button onClick={() => { setPlayerOutName(''); setPlayerOutReplacement(''); setSquadOpen(false); setPlayerOutOpen(true); }}
                  style={{ ...btnGhost, flex: 1, borderColor: UI.navy, color: UI.navy, fontWeight: 900 }}>
                  ➖ PLAYER OUT
                </button>
              </div>
            )}

            {!isEffectivelyLocked && (
              <button onClick={() => { setSquadOpen(false); handleEmergencySub(); }}
                style={{ ...btnGhost, width: '100%', borderColor: UI.navy, color: UI.navy, fontWeight: 900, marginBottom: s(20) }}>
                🔄 EDIT LINEUP / SUB
              </button>
            )}

            <div style={{ ...sectionLabel, marginBottom: s(8) }}>Match notes</div>
            <textarea
              value={matchNotes}
              onChange={e => setMatchNotes(e.target.value)}
              placeholder="Tactics, HT talk, training focus..."
              style={{ ...inputStyle, minHeight: s(120), resize: 'vertical', lineHeight: 1.5, marginBottom: s(20) }}
            />

            <button onClick={() => { setOrientation('horizontal-right'); setSquadOpen(false); }}
              style={{ ...btnGhost, width: '100%', borderColor: UI.navy, color: UI.navy, fontWeight: 900, marginBottom: s(20) }}>
              📺 SHOW THE KIDS
            </button>

            <div style={{ ...sectionLabel, marginBottom: s(8) }}>Danger zone</div>
            <div style={{ display: 'flex', gap: s(12), marginBottom: s(20) }}>
              <button onClick={() => { onResetClock?.(); setSquadOpen(false); }}
                style={{ ...btnGhost, flex: 1, borderColor: UI.stop, color: UI.stop }}>
                🔄 Reset period
              </button>
              <button onClick={() => { wakeLockRef.current?.release(); onResetGame?.(); setSquadOpen(false); }}
                style={{ ...btnSolid(UI.stop), flex: 1 }}>
                🗑️ Reset game
              </button>
            </div>

            <button onClick={() => setSquadOpen(false)} style={{ ...btnGhost, width: '100%' }}>Close</button>
          </div>
        </div>
      )}

      {/* ── Allocate GK: pick a player to take over in goal ── */}
      {gkPickerOpen && (
        <div style={{ ...modalBackdrop, zIndex: 240 }}>
          <div style={modalCard}>
            <h2 style={modalTitle}>🧤 Allocate Goalkeeper</h2>
            <div style={modalBody}>
              Pick a player to go in goal for the rest of {seg.half === 1 ? 'the first half' : 'the second half'}. Currently in goal: <strong style={{ color: UI.navy }}>{seg.assignment.GK}</strong>.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: s(8) }}>
              {players.filter(p => p !== seg.assignment.GK).map(p => {
                const onBench = seg.bench.includes(p);
                return (
                  <button key={p} onClick={() => { setGkPickerOpen(false); setConfirmGK({ name: p }); }} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: `${s(14)}px ${s(18)}px`, borderRadius: s(12), background: '#fff',
                    border: `2px solid ${UI.blueLine}`, fontSize: Math.max(16, s(22)),
                    fontWeight: 800, color: UI.navy, cursor: 'pointer', textAlign: 'left',
                    fontFamily: 'inherit',
                  }}>
                    <span>{p}</span>
                    <span style={{ fontSize: Math.max(13, s(16)), fontWeight: 800, color: onBench ? UI.label : UI.go }}>
                      {onBench ? '🪑 ON BENCH' : '⚽ ON FIELD'}
                    </span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setGkPickerOpen(false)} style={{ ...btnGhost, width: '100%', marginTop: s(16) }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Confirm: change GK mid-game ── */}
      {confirmGK && (
        <div style={{ ...modalBackdrop, zIndex: 250 }}>
          <div style={{ ...modalCard, maxWidth: s(480), textAlign: 'center' }}>
            <div style={{ fontSize: s(48), marginBottom: s(12) }}>🧤</div>
            <h2 style={modalTitle}>Change Goalkeeper?</h2>
            <p style={modalBody}>
              <strong style={{ color: UI.navy }}>{confirmGK.name}</strong> will go in goal for the rest of {seg.half === 1 ? 'the first half' : 'the second half'}. <strong style={{ color: UI.navy }}>{seg.assignment.GK}</strong> will swap into their place. Subs already played are not affected.
            </p>
            <div style={{ display: 'flex', gap: s(12) }}>
              <button onClick={() => setConfirmGK(null)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
              <button onClick={() => {
                onChangeGK?.(currentSeg, confirmGK.name);
                setConfirmGK(null);
                setActivePlayer(null);
              }} style={{ ...btnSolid(UI.navy), flex: 2 }}>
                🧤 Make GK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Emergency sub: ask the split time when the clock isn't timing this period ── */}
      {subPrompt && (() => {
        const mins  = parseInt(subPromptMins, 10);
        const canSplit = seg.duration >= 2;
        const valid = canSplit && Number.isFinite(mins) && mins >= 1 && mins <= seg.duration - 1;
        // Once this period has any elapsed time, a whole-period rewrite would
        // falsify minutes already played (the Round-8 bug class) — block it.
        const periodUnderway = gameClock.currentSegIdx === currentSeg && elapsedMs > 0;
        return (
          <div style={{ ...modalBackdrop, zIndex: 250 }}>
            <div style={{ ...modalCard, maxWidth: s(480) }}>
              <h2 style={modalTitle}>🔁 Make a Substitution</h2>
              <div style={modalBody}>
                The clock isn't timing this period, so I don't know how far in we are. Enter the minutes already played and I'll <strong style={{ color: UI.navy }}>lock everything before the sub</strong> — only the rest of the period changes.
              </div>
              {canSplit && (
                <>
                  <label style={{ ...sectionLabel, display: 'block', marginBottom: s(8) }}>
                    Minutes played this period (1–{seg.duration - 1})
                  </label>
                  <input
                    type="number" min={1} max={seg.duration - 1} value={subPromptMins} autoFocus
                    onChange={e => setSubPromptMins(e.target.value)}
                    style={inputStyle}
                  />
                  <button
                    disabled={!valid}
                    onClick={confirmSubFromTime}
                    style={{ ...btnSolid(valid ? UI.go : UI.label), width: '100%', marginTop: s(16), cursor: valid ? 'pointer' : 'default' }}>
                    ✂️ Sub from {valid ? mins : '…'} min — lock the past
                  </button>
                </>
              )}
              <button
                onClick={editWholePeriod}
                disabled={periodUnderway}
                style={{
                  ...btnGhost, width: '100%', marginTop: s(10),
                  borderColor: periodUnderway ? UI.blueLine : UI.warn,
                  color: periodUnderway ? UI.label : UI.warnText,
                  background: periodUnderway ? '#fff' : UI.warnTint,
                  cursor: periodUnderway ? 'not-allowed' : 'pointer',
                }}>
                ⚠️ Change the whole period instead
              </button>
              <div style={{ fontSize: Math.max(13, s(16)), fontWeight: 700, color: UI.warnText, marginTop: s(6), lineHeight: 1.4 }}>
                {periodUnderway
                  ? `This period is underway — a whole-period change would rewrite the ${Math.floor(elapsedMs / 60000)}+ minutes already played. Use the sub-from-time option above.`
                  : `"Whole period" rewrites who's on for all ${seg.duration} minutes — only for periods that haven't started yet.`}
              </div>
              <button
                onClick={() => { setSubPrompt(false); pendingSwapRef.current = null; }}
                style={{ ...btnGhost, width: '100%', marginTop: s(12) }}>
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Late player: name input + confirm ── */}
      {latePlayerOpen && (() => {
        const trimmed = latePlayerName.trim();
        // Compare against the ACTIVE squad (segment-derived), not players —
        // a previously-removed name is allowed to come back as a new arrival.
        const activeNames = new Set();
        Object.values(seg.assignment).forEach(n => { if (n) activeNames.add(n); });
        seg.bench.forEach(n => { if (n) activeNames.add(n); });
        const dup = activeNames.has(trimmed);
        const tooMany = activeSquadSize >= 12;
        const valid = trimmed.length > 0 && !dup && !tooMany;
        const elapsedMins = Math.floor(elapsedMs / 60000);
        const elapsedSecs = Math.floor((elapsedMs % 60000) / 1000);
        return (
          <div style={{ ...modalBackdrop, zIndex: 250 }}>
            <div style={{ ...modalCard, maxWidth: s(480) }}>
              <h2 style={modalTitle}>➕ Late Player</h2>
              <div style={modalBody}>
                Add a player to the squad. The schedule will be replanned from the current clock time. They get equal share of the remaining game — no catch-up.
              </div>
              <input
                value={latePlayerName}
                onChange={e => setLatePlayerName(e.target.value)}
                placeholder="Player name"
                autoFocus
                style={inputStyle}
              />
              {trimmed && (
                <div style={{
                  marginTop: s(14), padding: `${s(12)}px ${s(16)}px`, borderRadius: s(12),
                  background: dup || tooMany ? '#fdecec' : UI.goTint,
                  border: `2px solid ${dup || tooMany ? UI.stop : UI.go}`,
                  fontSize: Math.max(14, s(18)), fontWeight: 700,
                  color: dup || tooMany ? UI.stop : UI.go,
                }}>
                  {dup
                    ? `${trimmed} is already in the squad.`
                    : tooMany
                      ? `Maximum is 12 players (already at ${activeSquadSize}).`
                      : `Squad will go from ${activeSquadSize} → ${activeSquadSize + 1}. Splitting at ${elapsedMins}:${String(elapsedSecs).padStart(2, '0')}.`}
                </div>
              )}
              <div style={{ display: 'flex', gap: s(12), marginTop: s(20) }}>
                <button onClick={() => setLatePlayerOpen(false)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
                <button
                  disabled={!valid}
                  onClick={() => {
                    onRosterChange?.({ type: 'add', name: trimmed });
                    setLatePlayerOpen(false);
                  }}
                  style={{ ...btnSolid(valid ? UI.go : UI.label), flex: 2, cursor: valid ? 'pointer' : 'not-allowed' }}>
                  ➕ Add Player
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Player out: pick player (and replacement if on field) + confirm ── */}
      {playerOutOpen && (() => {
        const onField = playerOutName && Object.values(seg.assignment).includes(playerOutName);
        const isCurrentGK = playerOutName && seg.assignment.GK === playerOutName;
        // Active squad = current segment's field + bench (excludes anyone
        // already removed by an earlier injury). The player dropdown should
        // only offer active players.
        const activeNamesOut = new Set();
        Object.values(seg.assignment).forEach(n => { if (n) activeNamesOut.add(n); });
        seg.bench.forEach(n => { if (n) activeNamesOut.add(n); });
        const activePlayerList = players.filter(p => activeNamesOut.has(p));
        const wouldDropBelowSix = activeSquadSize - 1 < 6;
        const benchOptions = seg.bench;
        const elapsedMins = Math.floor(elapsedMs / 60000);
        const elapsedSecs = Math.floor((elapsedMs % 60000) / 1000);
        const valid = playerOutName && !isCurrentGK && !wouldDropBelowSix && (!onField || benchOptions.length > 0 || activeSquadSize - 1 < 9);
        return (
          <div style={{ ...modalBackdrop, zIndex: 250 }}>
            <div style={{ ...modalCard, maxWidth: s(480) }}>
              <h2 style={modalTitle}>➖ Player Out</h2>
              <div style={modalBody}>
                Remove a player from the rest of the game (e.g. injury). Their minutes already played are kept. The schedule will be replanned for the remainder.
              </div>

              <label style={{ ...sectionLabel, display: 'block', marginBottom: s(8) }}>Player leaving</label>
              <select
                value={playerOutName}
                onChange={e => { setPlayerOutName(e.target.value); setPlayerOutReplacement(''); }}
                style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">— Select Player —</option>
                {activePlayerList.map(p => <option key={p} value={p}>{p}</option>)}
              </select>

              {onField && benchOptions.length > 0 && (
                <>
                  <label style={{ ...sectionLabel, display: 'block', marginTop: s(16), marginBottom: s(8) }}>Who comes on?</label>
                  <select
                    value={playerOutReplacement}
                    onChange={e => setPlayerOutReplacement(e.target.value)}
                    style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="">— Pick most-rested —</option>
                    {benchOptions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </>
              )}

              {playerOutName && (
                <div style={{
                  marginTop: s(14), padding: `${s(12)}px ${s(16)}px`, borderRadius: s(12),
                  background: !valid ? '#fdecec' : UI.warnTint,
                  border: `2px solid ${!valid ? UI.stop : UI.warn}`,
                  fontSize: Math.max(14, s(18)), fontWeight: 700,
                  color: !valid ? UI.stop : UI.warnText,
                }}>
                  {isCurrentGK
                    ? 'This player is the current goalkeeper. Use the GK button first to swap goalkeeper, then mark them out.'
                    : wouldDropBelowSix
                      ? `Cannot drop below 6 players (currently ${activeSquadSize}).`
                      : onField && benchOptions.length === 0 && activeSquadSize - 1 >= 9
                        ? 'No bench players available to swap on.'
                        : `Squad will go from ${activeSquadSize} → ${activeSquadSize - 1}. Splitting at ${elapsedMins}:${String(elapsedSecs).padStart(2, '0')}. ${onField ? `${playerOutReplacement || '(most-rested bench player)'} comes on.` : `${playerOutName} was on the bench.`}`}
                </div>
              )}

              <div style={{ display: 'flex', gap: s(12), marginTop: s(20) }}>
                <button onClick={() => setPlayerOutOpen(false)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
                <button
                  disabled={!valid}
                  onClick={() => {
                    onRosterChange?.({
                      type: 'remove',
                      name: playerOutName,
                      replacementOnField: playerOutReplacement || undefined,
                    });
                    setPlayerOutOpen(false);
                  }}
                  style={{ ...btnSolid(valid ? UI.stop : UI.label), flex: 2, cursor: valid ? 'pointer' : 'not-allowed' }}>
                  ➖ Mark Out
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
          <div style={{ ...modalBackdrop, zIndex: 250 }}>
            <div style={modalCard}>
              <h2 style={modalTitle}>🏆 Season Honours</h2>
              <div style={modalBody}>
                {seasonGames.length} games · ⭐ Player of the Week · 🏅 Captain
              </div>
              {seasonGames.length === 0 ? (
                <div style={{ padding: s(32), textAlign: 'center', color: UI.bodyText, fontWeight: 700, fontSize: Math.max(15, s(20)) }}>
                  No games saved yet — honours will appear here once you've recorded a few matches.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: s(8) }}>
                  {sorted.map(p => {
                    const { potm: pc, captain: cc } = counts[p];
                    const total = pc + cc;
                    return (
                      <div key={p} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: `${s(14)}px ${s(18)}px`, borderRadius: s(12),
                        background: '#fff',
                        border: `${total === 0 ? 4 : 2}px solid ${total === 0 ? UI.go : UI.blueLine}`,
                      }}>
                        <span style={{ fontSize: Math.max(19, s(28)), fontWeight: 800, color: UI.navy }}>{p}</span>
                        <div style={{ display: 'flex', gap: s(18), fontSize: Math.max(16, s(22)), fontWeight: 800, color: UI.bodyText }}>
                          <span style={{ color: pc ? UI.bodyText : '#a8c0d8' }}>⭐ {pc || '—'}</span>
                          <span style={{ color: cc ? UI.bodyText : '#a8c0d8' }}>🏅 {cc || '—'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <button onClick={() => setHonoursOpen(false)} style={{ ...btnGhost, width: '100%', marginTop: s(20) }}>Close</button>
            </div>
          </div>
        );
      })()}

      {/* ── Post-Game Save Modal ── */}
      {saveOpen && (
        <div style={{ ...modalBackdrop, zIndex: 300 }}>
          <div style={modalCard}>
            <h2 style={modalTitle}>📊 Post-game summary</h2>

            <div style={{ marginBottom: s(20) }}>
              <label style={{ ...sectionLabel, display: 'block', marginBottom: s(8) }}>Match label (optional)</label>
              <input value={matchLabel} onChange={e => setMatchLabel(e.target.value)} placeholder="e.g. Grand Final vs Eastside" style={inputStyle} />
            </div>

            <div style={{ marginBottom: s(20) }}>
              <label style={{ ...sectionLabel, display: 'block', marginBottom: s(10) }}>Score</label>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: s(18) }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: Math.max(13, s(16)), fontWeight: 800, color: UI.label, marginBottom: s(6), textAlign: 'center' }}>US</div>
                  <input
                    type="number" min="0" value={ourScore}
                    onChange={e => setOurScore(e.target.value)}
                    style={{ ...inputStyle, border: `4px solid ${UI.navy}`, borderRadius: s(14), fontSize: Math.max(32, s(52)), fontWeight: 800, textAlign: 'center' }}
                  />
                </div>
                <div style={{ fontSize: Math.max(22, s(34)), fontWeight: 800, color: UI.label, paddingBottom: s(16), flexShrink: 0 }}>–</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: Math.max(13, s(16)), fontWeight: 800, color: UI.label, marginBottom: s(6), textAlign: 'center' }}>THEM</div>
                  <input
                    type="number" min="0" value={oppositionScore}
                    onChange={e => setOppositionScore(e.target.value)}
                    placeholder="0"
                    style={{ ...inputStyle, borderRadius: s(14), fontSize: Math.max(32, s(52)), fontWeight: 800, textAlign: 'center' }}
                  />
                </div>
              </div>
              {ourScore !== '' && Number(ourScore) !== trackedGoals && (
                <div style={{
                  marginTop: s(12), padding: `${s(16)}px ${s(20)}px`, borderRadius: s(12),
                  background: UI.warnTint, border: `3px solid ${UI.warn}`,
                  color: UI.warnText, fontSize: Math.max(15, s(20)), fontWeight: 700,
                }}>
                  ⚠️ {trackedGoals} goal{trackedGoals !== 1 ? 's' : ''} allocated to players but the score says {ourScore}. Tap a player to allocate — or save now and fix it later.
                </div>
              )}
            </div>

            <div style={{ marginBottom: s(20) }}>
              <label style={{ ...sectionLabel, display: 'block', marginBottom: s(8) }}>⭐ Player of the week</label>
              <select value={potm} onChange={e => setPotm(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">— Select Player —</option>
                {players.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: s(28) }}>
              <label style={{ ...sectionLabel, display: 'block', marginBottom: s(8) }}>🏅 Captain next week</label>
              <select value={captain} onChange={e => setCaptain(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">— Select Captain —</option>
                {players.map(p => <option key={p} value={p}>{p}</option>)}
                {/* If last win's captain isn't in today's squad, still show them */}
                {suggestedCaptain && !players.includes(suggestedCaptain) && (
                  <option value={suggestedCaptain}>{suggestedCaptain} (not in squad)</option>
                )}
              </select>
              {suggestedCaptain && (
                <div style={{ marginTop: s(6), fontSize: Math.max(14, s(18)), fontWeight: 700, color: UI.bodyText }}>
                  💡 Suggested from last win
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: s(12) }}>
              <button onClick={() => setSaveOpen(false)} style={{ ...btnGhost, flex: 1, padding: s(24) }}>Cancel</button>
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
              }} style={{ ...btnSolid(UI.go), flex: 2, padding: s(24), fontSize: Math.max(17, s(26)) }}>
                💾 SAVE GAME
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast (App-level feedback: swaps, rebalance, GK + roster changes) ── */}
      {toast && (
        <div style={{
          position: 'fixed', top: s(16), left: '50%', transform: 'translateX(-50%)',
          zIndex: 400, background: toast.type === 'err' ? UI.stop : UI.go, color: '#fff',
          padding: `${s(14)}px ${s(26)}px`, borderRadius: s(12),
          fontSize: Math.max(15, s(20)), fontWeight: 800,
          pointerEvents: 'none', maxWidth: '90vw', textAlign: 'center',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
