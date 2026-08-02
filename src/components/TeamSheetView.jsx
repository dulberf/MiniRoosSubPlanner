import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import FieldView from './FieldView.jsx';
import { calcStats, nextAppearance } from '../scheduler.js';
import { MIN_SQUAD, MAX_SQUAD } from '../replan.js';
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

  // Roster-change UI state (3b/3c). LATE PLAYER and PLAYER OUT and both of
  // their modals are gone: the squad sheet's chip grid IS the roster editor.
  // Tap a playing chip to take someone off, a dashed chip to bring them on.
  const [playerOff, setPlayerOff] = useState(null);           // name whose 3c panel is open
  const [playerOffReplacement, setPlayerOffReplacement] = useState('');
  const [newPlayerOpen, setNewPlayerOpen] = useState(false);  // "+ SOMEONE NEW"
  const [newPlayerName, setNewPlayerName] = useState('');
  // "Wipe the game" is the only irreversible action in the app, so it is a
  // 2-second hold rather than a tap. 0 → 1 over the hold.
  const [wipeHold, setWipeHold] = useState(0);
  const wipeTimerRef = useRef(null);
  // The side sheet hangs below the header + pip strip so the clock never goes
  // out of sight — losing the clock is the failure mode this redesign exists to
  // fix. Measured off <main> rather than recomputed from s() sizes.
  const bodyRef = useRef(null);
  const [sheetTop, setSheetTop] = useState(0);

  useEffect(() => {
    if (!squadOpen) return;
    const measure = () => {
      const top = bodyRef.current?.getBoundingClientRect().top;
      if (typeof top === 'number') setSheetTop(Math.max(0, top));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [squadOpen]);

  // Hold-to-wipe. Cleared on release, on unmount, and whenever the sheet closes,
  // so a half-finished hold can never carry over into a later tap.
  const startWipeHold = () => {
    if (wipeTimerRef.current) return;
    const started = Date.now();
    wipeTimerRef.current = setInterval(() => {
      const pct = Math.min(1, (Date.now() - started) / 2000);
      setWipeHold(pct);
      if (pct >= 1) {
        clearInterval(wipeTimerRef.current);
        wipeTimerRef.current = null;
        setWipeHold(0);
        releaseWakeLock();
        onResetGame?.();
        setSquadOpen(false);
      }
    }, 50);
  };
  const cancelWipeHold = () => {
    clearInterval(wipeTimerRef.current);
    wipeTimerRef.current = null;
    setWipeHold(0);
  };
  useEffect(() => () => clearInterval(wipeTimerRef.current), []);

  // Emergency mid-period sub: when the clock isn't timing this period we ask how
  // many minutes have been played, so the past stays locked and only the rest of
  // the period changes. Without this the edit silently rewrote the whole period
  // (the weekend bug that left one player on 25m and another on the full 50m).
  const [subPrompt, setSubPrompt] = useState(null); // truthy when the prompt is open
  const [subPromptMins, setSubPromptMins] = useState('');
  // A swap the coach asked for via MOVE POSITION, held until the split resolves.
  const pendingSwapRef = useRef(null);

  const [saveOpen, setSaveOpen] = useState(false);
  // Chip rows in the save modal show the eligible ("never had one") players by
  // default; these expand them to the whole squad.
  const [potmExpanded, setPotmExpanded] = useState(false);
  const [captainExpanded, setCaptainExpanded] = useState(false);
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

  // Season honours tallies. `lastRound` is the 1-based index of the most recent
  // game where a player was POTW or captain — it drives both the "last: R7"
  // column and the ranking of who is most overdue.
  const honours = useMemo(() => {
    const map = {};
    const entry = (name) => {
      if (!map[name]) map[name] = { potm: 0, captain: 0, lastRound: null };
      return map[name];
    };
    players.forEach(entry);
    (seasonGames || []).forEach((g, i) => {
      if (g.potm) { const e = entry(g.potm); e.potm++; e.lastRound = i + 1; }
      if (g.captain) { const e = entry(g.captain); e.captain++; e.lastRound = i + 1; }
    });
    return map;
  }, [players, seasonGames]);

  // Never had either AND playing today. Still used for the save modal's helper
  // line, but it is no longer what the honours sheet leads with — see below.
  const eligibleForHonour = useMemo(
    () => players.filter(p => honours[p] && honours[p].potm === 0 && honours[p].captain === 0),
    [players, honours]
  );

  // Screen 4a. The sheet used to ask "who has never had one", which is only a
  // real question for the first few rounds — by round 11 every player has an
  // honour and the block that carried the whole screen rendered empty. Asking
  // "who has gone longest without one" works identically in round 1 (everyone
  // is "never") and round 30, because never sorts ahead of any number.
  // lastRound is null for never-honoured, so `?? 0` puts them first.
  const overdueOrder = useCallback((a, b) => {
    const squad = new Set(players);
    const aIn = squad.has(a), bIn = squad.has(b);
    if (aIn !== bIn) return aIn ? -1 : 1;
    const ar = honours[a]?.lastRound ?? 0, br = honours[b]?.lastRound ?? 0;
    if (ar !== br) return ar - br;
    return a.localeCompare(b);
  }, [players, honours]);

  // The four most overdue players who are actually here today.
  const dueNext = useMemo(
    () => [...players].sort(overdueOrder).slice(0, 4),
    [players, overdueOrder]
  );

  // Everyone the shortlist didn't cover: today's squad first, then absentees.
  const everyoneElse = useMemo(
    () => Object.keys(honours).filter(p => !dueNext.includes(p)).sort(overdueOrder),
    [honours, dueNext, overdueOrder]
  );

  // "9 rounds ago" reads as an argument; "last: R2" reads as a database field.
  const roundsSince = useCallback((p, caps) => {
    const lr = honours[p]?.lastRound;
    if (lr == null) return caps ? 'NEVER HAD ONE' : 'never had one';
    const diff = seasonGames.length - lr;
    if (diff <= 0) return caps ? 'LAST ROUND' : 'last round';
    return caps ? `${diff} ROUND${diff === 1 ? '' : 'S'} AGO` : `${diff} round${diff === 1 ? '' : 's'} ago`;
  }, [honours, seasonGames]);

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
  // The visibility handler registers once and must read the live clock state.
  const gameClockRef = useRef(gameClock);
  gameClockRef.current = gameClock;
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

  // The wake lock stops the iPad sleeping through a sub (Session 7). It is also
  // the app's single biggest power cost — the screen is the drain, held at
  // sun-readable brightness. Session 18 scoped it to the clock: held while the
  // period is running, released the moment it is not. It used to stay on
  // through all of half-time and indefinitely after the final whistle, which
  // bought nothing.
  const acquireWakeLock = async () => {
    try {
      if (navigator.wakeLock && !wakeLockRef.current) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        // The browser drops the lock whenever the page is hidden; clear our
        // handle so the visibility handler knows to take a fresh one.
        wakeLockRef.current.addEventListener?.('release', () => {
          wakeLockRef.current = null;
        });
      }
    } catch (_) {}
  };

  const releaseWakeLock = () => {
    try { wakeLockRef.current?.release(); } catch (_) {}
    wakeLockRef.current = null;
  };

  // Wake lock follows the clock: held while a period runs, released the moment
  // it stops. Half-time, a paused game and the wait after full-time all let the
  // screen sleep normally now. Declared BELOW acquire/release on purpose —
  // Session 7 crashed on a TDZ from an effect placed above its dependencies.
  useEffect(() => {
    if (gameClock.isRunning) acquireWakeLock();
    else releaseWakeLock();
  }, [gameClock.isRunning]);

  // Never leak the lock if this screen goes away without passing through
  // Save Game or a reset.
  useEffect(() => () => releaseWakeLock(), []);

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
        // Only re-take the lock if a period is actually running. Coming back to
        // a paused game must not pin the screen on.
        if (gameClockRef.current.isRunning) acquireWakeLock();
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
  // Takes the value explicitly (3d's steppers clamp before calling) and falls
  // back to the input state; splitSegment requires 1 ≤ mins < duration.
  const confirmSubFromTime = (explicitMins) => {
    const mins = Number.isFinite(explicitMins) ? explicitMins : parseInt(subPromptMins, 10);
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

  // Chip row for POTW / captain. Shows the "never had one" players by default —
  // the whole point is that the fair answer is the visible one — with an
  // "Everyone else" escape to the full squad.
  const honourChipRow = (value, setValue, expanded, setExpanded) => {
    // 4a's reframing applies here too: lead with longest-since-an-honour, not
    // never-had-one. The "never" players still come first — never sorts ahead
    // of any round number — but the row keeps working once nobody is left.
    const byOverdue = [...players].sort(overdueOrder);
    const showAll = expanded || byOverdue.length <= 4;
    const base = showAll ? byOverdue : byOverdue.slice(0, 4);
    const shown = value && !base.includes(value) ? [value, ...base] : base;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: s(10) }}>
        {shown.map(p => {
          const sel = value === p;
          return (
            <button key={p} onClick={() => setValue(sel ? '' : p)} style={{
              background: sel ? UI.navy : '#fff',
              border: `3px solid ${sel ? UI.navy : UI.blueLine}`,
              borderRadius: s(12), padding: `${s(14)}px ${s(24)}px`,
              fontSize: Math.max(18, s(26)), fontWeight: 800,
              color: sel ? '#fff' : UI.navy, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {p}{sel ? ' ✓' : ''}
            </button>
          );
        })}
        {!showAll && (
          <button onClick={() => setExpanded(true)} style={{
            background: '#fff', border: `3px solid ${UI.blueLine}`, borderRadius: s(12),
            padding: `${s(14)}px ${s(24)}px`, fontSize: Math.max(18, s(26)),
            fontWeight: 800, color: UI.label, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Everyone else ▾
          </button>
        )}
      </div>
    );
  };

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
      <main ref={bodyRef} style={{
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

      {/* ══ Squad sheet (3b) — a right-hand side sheet, NOT a centred modal.
           The header and pip strip stay visible above it: losing sight of the
           clock is the failure mode this whole redesign exists to fix.
           The chip grid replaces LATE PLAYER and PLAYER OUT and both of their
           modals, and answers "who is actually here", which the old sheet
           never did. ══ */}
      {squadOpen && (() => {
        const activeNames = new Set();
        Object.values(seg.assignment).forEach(n => { if (n) activeNames.add(n); });
        seg.bench.forEach(n => { if (n) activeNames.add(n); });

        const posOf = (n) => Object.entries(seg.assignment).find(([, v]) => v === n)?.[0];
        const notHere = players.filter(p => !activeNames.has(p));
        const onCount = Object.values(seg.assignment).filter(Boolean).length;
        const canEditRoster = !isEffectivelyLocked && !!onRosterChange;

        const closeSheet = () => {
          cancelWipeHold();
          setPlayerOff(null);
          setNewPlayerOpen(false);
          setSquadOpen(false);
        };

        // Chip states: navy = on the field, white = on the bench, dashed = not
        // here, amber = the player whose 3c panel is open.
        const chipFor = (name) => {
          const pos = posOf(name);
          const here = activeNames.has(name);
          const going = playerOff === name;
          const back = here && !pos ? nextAppearance(segments, currentSeg, name) : null;
          // Short code on the chip (it sits in a 3-column grid); the long name
          // is used in the 3c panel heading, where there is room to read it.
          const sub = going ? 'GOING OFF'
            : !here ? 'NOT HERE'
            : pos ? `${pos} · ON`
            : back ? `BENCH · ON AT ${back.minute}` : 'BENCH';
          return { pos, here, going, sub };
        };

        return (
          <>
            {/* Scrim over the pitch only — the chrome above stays legible. */}
            <div
              onClick={closeSheet}
              style={{ position: 'fixed', left: 0, right: 0, top: sheetTop, bottom: 0, background: UI.scrim, zIndex: 230 }}
            />
            <div style={{
              position: 'fixed', right: 0, top: sheetTop, bottom: 0, width: `min(${s(648)}px, 92vw)`,
              background: '#fff', borderLeft: `3px solid ${UI.blueLine}`, zIndex: 231,
              display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
            }}>
              {/* Header */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                gap: s(16), padding: `${s(22)}px ${s(26)}px ${s(16)}px`,
                borderBottom: `2px solid ${UI.blueLine}`, flexShrink: 0,
              }}>
                <div>
                  <div style={{ fontSize: Math.max(26, s(40)), fontWeight: 800, color: UI.navy, letterSpacing: -0.5, lineHeight: 1.05 }}>
                    Squad
                  </div>
                  <div style={{ fontSize: Math.max(16, s(21)), fontWeight: 700, color: UI.bodyText, marginTop: s(4) }}>
                    {activeSquadSize} here · {onCount} on · {seg.bench.filter(Boolean).length} on the bench
                  </div>
                </div>
                <button type="button" onClick={closeSheet} style={{
                  width: s(72), height: s(72), flexShrink: 0, borderRadius: s(12),
                  border: `2px solid ${UI.blueLine}`, background: '#fff', color: UI.navy,
                  fontSize: Math.max(22, s(30)), fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
                }}>✕</button>
              </div>

              {/* Scrolling middle */}
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `${s(18)}px ${s(26)}px` }}>

                <div style={{ ...sectionLabel, marginBottom: s(12) }}>Who's available</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: s(10) }}>
                  {[...players].map(name => {
                    const { here, going, sub } = chipFor(name);
                    return (
                      <button
                        key={name}
                        type="button"
                        disabled={!canEditRoster}
                        onClick={() => {
                          if (!canEditRoster) return;
                          if (here) {
                            setPlayerOffReplacement('');
                            setPlayerOff(playerOff === name ? null : name);
                          } else {
                            onRosterChange?.({ type: 'add', name });
                            closeSheet();
                          }
                        }}
                        style={{
                          padding: `${s(12)}px ${s(8)}px`, borderRadius: s(12), textAlign: 'center',
                          cursor: canEditRoster ? 'pointer' : 'default', fontFamily: 'inherit',
                          background: going ? '#fff' : here && posOf(name) ? UI.navy : '#fff',
                          border: `3px ${here ? 'solid' : 'dashed'} ${going ? UI.warn : here ? UI.navy : UI.blueLine}`,
                          color: going ? UI.warn : here && posOf(name) ? '#fff' : here ? UI.navy : UI.label,
                          opacity: here ? 1 : 0.75,
                        }}>
                        <div style={{ fontSize: Math.max(18, s(26)), fontWeight: 800, lineHeight: 1.1 }}>{name}</div>
                        <div style={{
                          fontSize: Math.max(15, s(15)), fontWeight: 900, letterSpacing: s(1),
                          marginTop: s(2), opacity: going ? 1 : 0.85,
                        }}>{sub}</div>
                      </button>
                    );
                  })}
                </div>

                {canEditRoster && (
                  <div style={{ display: 'flex', gap: s(14), alignItems: 'flex-start', marginTop: s(12), flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => { setNewPlayerName(''); setNewPlayerOpen(v => !v); }} style={{
                      border: `3px dashed ${UI.blueLine}`, borderRadius: s(12), background: 'transparent',
                      padding: `${s(12)}px ${s(18)}px`, fontSize: Math.max(16, s(20)), fontWeight: 800,
                      color: UI.label, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                    }}>+ SOMEONE NEW</button>
                    <div style={{ flex: 1, minWidth: s(200), fontSize: Math.max(16, s(18)), fontWeight: 600, color: UI.bodyText, lineHeight: 1.4 }}>
                      Tap a name to take them off. Tap a dashed name to bring them on — they're worked into the rest of the plan.
                    </div>
                  </div>
                )}

                {newPlayerOpen && (() => {
                  const trimmed = newPlayerName.trim();
                  const dup = activeNames.has(trimmed);
                  const tooMany = activeSquadSize >= MAX_SQUAD;
                  const ok = trimmed.length > 0 && !dup && !tooMany;
                  return (
                    <div style={{ marginTop: s(12), padding: s(16), borderRadius: s(14), border: `3px solid ${UI.blueLine}` }}>
                      <input
                        value={newPlayerName}
                        onChange={e => setNewPlayerName(e.target.value)}
                        placeholder="Name"
                        autoFocus
                        style={inputStyle}
                      />
                      {trimmed && !ok && (
                        <div style={{ marginTop: s(10), fontSize: Math.max(15, s(18)), fontWeight: 800, color: UI.stop }}>
                          {dup ? `${trimmed} is already in the squad.` : `Maximum is ${MAX_SQUAD} players (already at ${activeSquadSize}).`}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: s(10), marginTop: s(12) }}>
                        <button type="button" onClick={() => setNewPlayerOpen(false)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
                        <button
                          type="button"
                          disabled={!ok}
                          onClick={() => { onRosterChange?.({ type: 'add', name: trimmed }); closeSheet(); }}
                          style={{ ...btnSolid(ok ? UI.go : UI.label), flex: 2, cursor: ok ? 'pointer' : 'not-allowed' }}>
                          Bring {trimmed || 'them'} on
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* ── 3c: a player comes off. Expands in place — no second modal,
                     no losing your scroll position. Amber, not red: this changes
                     the plan, it is not an error. ── */}
                {playerOff && (() => {
                  const pos = posOf(playerOff);
                  const isGK = seg.assignment.GK === playerOff;
                  const wouldDropBelowFloor = activeSquadSize - 1 < MIN_SQUAD;
                  const benchOptions = seg.bench.filter(Boolean);
                  // pickReplacement() in replan.js takes the bench player with
                  // the least cumulative minutes — default to the same one.
                  const byMinutes = [...benchOptions].sort((a, b) => minutesPlayedSoFar(a) - minutesPlayedSoFar(b));
                  const chosen = playerOffReplacement || byMinutes[0] || '';
                  const needsReplacement = !!pos && benchOptions.length > 0;
                  const noBench = !!pos && benchOptions.length === 0 && activeSquadSize - 1 >= 9;
                  const blocked = isGK || wouldDropBelowFloor || noBench;

                  return (
                    <div style={{
                      marginTop: s(16), padding: `${s(20)}px ${s(22)}px`, borderRadius: s(16),
                      background: UI.warnTint, border: `3px solid ${UI.warn}`,
                    }}>
                      <div style={{ fontSize: Math.max(22, s(32)), fontWeight: 800, color: UI.warnText, lineHeight: 1.15 }}>
                        {isGK ? `${playerOff} is in goal` : `${playerOff} comes off now`}
                      </div>

                      {isGK ? (
                        <>
                          <div style={{ fontSize: Math.max(16, s(21)), fontWeight: 700, color: UI.warnText, marginTop: s(8), lineHeight: 1.45 }}>
                            Pick a new goalkeeper first, then take {playerOff} off. The rotation can't leave the goal empty.
                          </div>
                          <div style={{ display: 'flex', gap: s(12), marginTop: s(18) }}>
                            <button type="button" onClick={() => setPlayerOff(null)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
                            <button type="button" onClick={() => { setPlayerOff(null); setSquadOpen(false); setGkPickerOpen(true); }}
                              style={{ ...btnSolid(UI.warn), flex: 2 }}>
                              ALLOCATE GK
                            </button>
                          </div>
                        </>
                      ) : wouldDropBelowFloor ? (
                        <>
                          <div style={{ fontSize: Math.max(16, s(21)), fontWeight: 700, color: UI.warnText, marginTop: s(8), lineHeight: 1.45 }}>
                            You're down to {activeSquadSize}. {MIN_SQUAD} is the floor — below that there aren't enough players to keep a game going.
                          </div>
                          <button type="button" onClick={() => setPlayerOff(null)} style={{ ...btnGhost, width: '100%', marginTop: s(18) }}>Close</button>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: Math.max(16, s(21)), fontWeight: 700, color: UI.warnText, marginTop: s(8), lineHeight: 1.45 }}>
                            {playerOff} keeps the <strong>{minutesPlayedSoFar(playerOff)} minutes</strong> already played. Nothing already played changes.
                          </div>

                          {needsReplacement && (
                            <>
                              <div style={{ ...sectionLabel, color: UI.warn, marginTop: s(16), marginBottom: s(10) }}>
                                Who takes {POS_LABEL[pos] || pos} now?
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: s(10) }}>
                                {byMinutes.map((b, i) => {
                                  const sel = chosen === b;
                                  return (
                                    <button key={b} type="button" onClick={() => setPlayerOffReplacement(b)} style={{
                                      background: sel ? UI.navy : '#fff',
                                      border: `3px solid ${sel ? UI.navy : UI.blueLine}`,
                                      borderRadius: s(12), padding: `${s(12)}px ${s(18)}px`,
                                      color: sel ? '#fff' : UI.navy, cursor: 'pointer', fontFamily: 'inherit',
                                      display: 'flex', alignItems: 'baseline', gap: s(8),
                                    }}>
                                      <span style={{ fontSize: Math.max(18, s(26)), fontWeight: 800 }}>{b}{sel ? ' ✓' : ''}</span>
                                      <span style={{ fontSize: Math.max(15, s(17)), fontWeight: 800, opacity: 0.85 }}>
                                        {minutesPlayedSoFar(b)} min{i === 0 ? ' — least' : ''}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          )}

                          {/* Corrected after reading replan.js: the removed player's
                              minutes are NOT handed to one substitute.
                              buildRemainderForHalf rebuilds the rest of the half, and
                              an H1 removal also triggers buildFreshHalf for the whole
                              second half. Saying so is the honest version — the coach
                              notices ten minutes later otherwise, and distrusts it. */}
                          <div style={{
                            marginTop: s(16), padding: `${s(14)}px ${s(18)}px`, borderRadius: s(12),
                            background: '#fff', border: `2px solid ${UI.blueLine}`,
                          }}>
                            <div style={{ ...sectionLabel, marginBottom: s(6) }}>What this does to the rest</div>
                            <div style={{ fontSize: Math.max(16, s(21)), fontWeight: 700, color: UI.navy, lineHeight: 1.45 }}>
                              {needsReplacement ? `${chosen} goes straight into ${(POS_LABEL[pos] || pos).toLowerCase()}. ` : ''}
                              The rest of this {seg.half === 1 ? 'half and the whole second half are' : 'half is'} then
                              re-planned for {activeSquadSize - 1} players, sharing the remaining minutes equally — so the
                              periods after this one will not match what's on the board now.
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: s(12), marginTop: s(18) }}>
                            <button type="button" onClick={() => setPlayerOff(null)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
                            <button
                              type="button"
                              disabled={blocked}
                              onClick={() => {
                                onRosterChange?.({
                                  type: 'remove',
                                  name: playerOff,
                                  replacementOnField: needsReplacement ? chosen : undefined,
                                });
                                closeSheet();
                              }}
                              style={{ ...btnSolid(UI.warn), flex: 2, cursor: blocked ? 'not-allowed' : 'pointer' }}>
                              TAKE {playerOff.toUpperCase()} OFF
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* Two routes to the sub, deliberately named differently. The
                    fast path is the pitch — tap the player, then MOVE POSITION.
                    This is the deliberate, several-players-at-once path. */}
                <div style={{ display: 'flex', gap: s(12), marginTop: s(22) }}>
                  <button
                    type="button"
                    disabled={isEffectivelyLocked}
                    onClick={() => { setSquadOpen(false); handleEmergencySub(); }}
                    style={{
                      ...btnGhost, flex: 1, borderColor: isEffectivelyLocked ? UI.blueLine : UI.navy,
                      color: isEffectivelyLocked ? UI.label : UI.navy, fontWeight: 900,
                      cursor: isEffectivelyLocked ? 'not-allowed' : 'pointer',
                    }}>
                    REARRANGE THE LINEUP
                  </button>
                  <button type="button" onClick={() => { setOrientation('horizontal-right'); closeSheet(); }}
                    style={{ ...btnGhost, flex: 1, borderColor: UI.navy, color: UI.navy, fontWeight: 900 }}>
                    SHOW THE KIDS
                  </button>
                </div>
                <div style={{ fontSize: Math.max(16, s(18)), fontWeight: 600, color: UI.label, marginTop: s(8), lineHeight: 1.4 }}>
                  Moving one player is quicker from the pitch — tap them, then MOVE POSITION.
                </div>

                {/* Low in the sheet on purpose: notes are a half-time,
                    standing-still task and must not compete for the thumb. */}
                <div style={{ ...sectionLabel, marginTop: s(24), marginBottom: s(8) }}>Match notes</div>
                <textarea
                  value={matchNotes}
                  onChange={e => setMatchNotes(e.target.value)}
                  placeholder="Tactics, HT talk, training focus…"
                  style={{ ...inputStyle, minHeight: s(120), resize: 'vertical', lineHeight: 1.5 }}
                />
              </div>

              {/* Pinned to the bottom, below a rule. Reset used to sit a
                  thumb-width from the notes box. */}
              <div style={{ flexShrink: 0, borderTop: `2px solid ${UI.blueLine}`, padding: `${s(16)}px ${s(26)}px ${s(20)}px` }}>
                <div style={{ ...sectionLabel, marginBottom: s(10) }}>Start again</div>
                <div style={{ display: 'flex', gap: s(12) }}>
                  <button type="button" onClick={() => { onResetClock?.(); closeSheet(); }} style={{ ...btnGhost, flex: 1 }}>
                    Restart this period
                  </button>
                  <button
                    type="button"
                    onMouseDown={startWipeHold} onMouseUp={cancelWipeHold} onMouseLeave={cancelWipeHold}
                    onTouchStart={startWipeHold} onTouchEnd={cancelWipeHold} onTouchCancel={cancelWipeHold}
                    style={{
                      ...btnGhost, flex: 1, borderColor: UI.stop, color: UI.stop, fontWeight: 900,
                      background: `linear-gradient(to right, ${UI.stop}22 ${wipeHold * 100}%, #fff ${wipeHold * 100}%)`,
                      touchAction: 'none', userSelect: 'none',
                    }}>
                    Wipe the game
                    <div style={{ fontSize: Math.max(15, s(15)), fontWeight: 900, letterSpacing: s(1), marginTop: s(2) }}>
                      {wipeHold > 0 ? 'KEEP HOLDING…' : 'HOLD 2 SECONDS'}
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </>
        );
      })()}

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
        const shown = Number.isFinite(mins) ? mins : Math.max(1, Math.round(seg.duration / 2));
        const clamped = Math.min(Math.max(shown, 1), Math.max(1, seg.duration - 1));
        const setMins = (v) => setSubPromptMins(String(Math.min(Math.max(v, 1), Math.max(1, seg.duration - 1))));
        // Kickoff-relative start of this period. Summed from durations, not
        // parsed out of seg.label — "H1 0–10" matches the 1 in "H1" first.
        const from = segments.slice(0, currentSeg).reduce((a, x) => a + (x.duration || 0), 0);
        const shortcuts = [
          ['Right at the start', 1],
          ['Halfway', Math.max(1, Math.round(seg.duration / 2))],
          ['Nearly the whole period', Math.max(1, seg.duration - 1)],
        ];
        return (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 250, background: UI.page,
            display: 'flex', flexDirection: 'column', overflowY: 'auto',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {/* Amber header, inheriting the 2a rule — the chrome states WHY it
                is asking before the coach reads a word. */}
            <div style={{
              background: UI.warn, padding: `${s(18)}px ${s(26)}px`, flexShrink: 0,
              display: 'flex', alignItems: 'baseline', gap: s(16), flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: Math.max(30, s(52)), fontWeight: 800, color: '#fff', letterSpacing: -1, lineHeight: 1 }}>
                {fmtCountdown(remainingSecsTotal)}
              </div>
              <div style={{ fontSize: Math.max(15, s(19)), fontWeight: 900, color: UI.warnOnDark, letterSpacing: s(2) }}>
                P{currentSeg + 1} · {seg.half === 1 ? '1ST HALF' : '2ND HALF'} · CLOCK NOT RUNNING
              </div>
            </div>

            <div style={{ flex: 1, padding: `${s(26)}px ${s(30)}px`, maxWidth: s(1024), width: '100%', boxSizing: 'border-box' }}>
              <div style={{ ...sectionLabel, color: UI.warn, marginBottom: s(8) }}>Before this change is made</div>
              <div style={{ fontSize: Math.max(30, s(52)), fontWeight: 800, color: UI.navy, letterSpacing: -1, lineHeight: 1.1 }}>
                How far into this period did it happen?
              </div>
              <div style={{ fontSize: Math.max(17, s(23)), fontWeight: 700, color: UI.bodyText, marginTop: s(12), lineHeight: 1.45 }}>
                The clock wasn't timing P{currentSeg + 1}, so the app can't tell. Minutes already played
                stay exactly as they are — this only changes what's left.
              </div>

              {canSplit && (
                <>
                  {/* The bar carries the argument: this is the visual form of
                      splitSegment, and it is why the answer matters. */}
                  <div style={{ ...sectionLabel, marginTop: s(24), marginBottom: s(10) }}>
                    Period {currentSeg + 1} · minute {from} to {from + seg.duration}
                  </div>
                  <div style={{ display: 'flex', height: s(96), borderRadius: s(12), overflow: 'hidden', border: `3px solid ${UI.navy}` }}>
                    <div style={{
                      flex: clamped, background: UI.navy, color: '#fff',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 0,
                    }}>
                      <div style={{ fontSize: Math.max(18, s(26)), fontWeight: 800, whiteSpace: 'nowrap' }}>{clamped} min played</div>
                      <div style={{ fontSize: Math.max(15, s(16)), fontWeight: 900, letterSpacing: s(1), color: UI.onNavyMuted, whiteSpace: 'nowrap' }}>
                        LOCKED — CAN'T CHANGE
                      </div>
                    </div>
                    <div style={{
                      flex: Math.max(0.0001, seg.duration - clamped), background: '#fff', color: UI.navy,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 0,
                    }}>
                      <div style={{ fontSize: Math.max(18, s(26)), fontWeight: 800, whiteSpace: 'nowrap' }}>{seg.duration - clamped} min left</div>
                      <div style={{ fontSize: Math.max(15, s(16)), fontWeight: 900, letterSpacing: s(1), color: UI.label, whiteSpace: 'nowrap' }}>
                        THIS EDIT APPLIES HERE
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: s(6), fontSize: Math.max(15, s(17)), fontWeight: 900, color: UI.label }}>
                    <span>{from} MIN</span><span>{from + clamped} MIN</span><span>{from + seg.duration} MIN</span>
                  </div>

                  {/* Clamped rather than disabled, so the control never feels stuck. */}
                  <div style={{ display: 'flex', gap: s(12), alignItems: 'stretch', marginTop: s(20) }}>
                    <button type="button" onClick={() => setMins(clamped - 1)} style={{
                      width: s(108), height: s(108), borderRadius: s(14), background: '#fff',
                      border: `3px solid ${UI.navy}`, color: UI.navy, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                      <div style={{ fontSize: Math.max(24, s(34)), fontWeight: 800, lineHeight: 1 }}>−</div>
                      <div style={{ fontSize: Math.max(15, s(15)), fontWeight: 900, letterSpacing: s(1) }}>1 MIN</div>
                    </button>
                    <div style={{
                      flex: 1, borderRadius: s(14), background: '#fff', border: `3px solid ${UI.blueLine}`,
                      display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: s(10),
                    }}>
                      <span style={{ fontSize: Math.max(40, s(72)), fontWeight: 800, color: UI.navy, lineHeight: 1.4 }}>{clamped}</span>
                      <span style={{ fontSize: Math.max(17, s(24)), fontWeight: 700, color: UI.bodyText }}>minutes played</span>
                    </div>
                    <button type="button" onClick={() => setMins(clamped + 1)} style={{
                      width: s(108), height: s(108), borderRadius: s(14), background: '#fff',
                      border: `3px solid ${UI.navy}`, color: UI.navy, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                      <div style={{ fontSize: Math.max(24, s(34)), fontWeight: 800, lineHeight: 1 }}>+</div>
                      <div style={{ fontSize: Math.max(15, s(15)), fontWeight: 900, letterSpacing: s(1) }}>1 MIN</div>
                    </button>
                  </div>

                  {/* "Halfway" is what a coach actually knows. */}
                  <div style={{ display: 'flex', gap: s(12), marginTop: s(14), flexWrap: 'wrap' }}>
                    {shortcuts.map(([label, v]) => {
                      const sel = clamped === v;
                      return (
                        <button key={label} type="button" onClick={() => setMins(v)} style={{
                          flex: '1 1 30%', padding: `${s(16)}px ${s(12)}px`, borderRadius: s(12),
                          background: sel ? UI.navy : '#fff', border: `3px solid ${sel ? UI.navy : UI.blueLine}`,
                          color: sel ? '#fff' : UI.navy, fontSize: Math.max(17, s(22)), fontWeight: 800,
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}>{label}{sel ? ' ✓' : ''}</button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* A prompt that cannot be answered confidently gets dismissed
                  carelessly, which is the same bug wearing a hat. */}
              <div style={{
                marginTop: s(22), padding: `${s(18)}px ${s(22)}px`, borderRadius: s(14),
                background: UI.warnTint, border: `3px solid ${UI.warn}`,
              }}>
                <div style={{ ...sectionLabel, color: UI.warn, marginBottom: s(6) }}>If you get this wrong</div>
                <div style={{ fontSize: Math.max(17, s(22)), fontWeight: 700, color: UI.warnText, lineHeight: 1.45 }}>
                  Everyone's minutes for the day shift by the same amount you're out by. Say
                  {' '}{Math.max(1, Math.round(seg.duration / 2))} if you're not sure — half a period is the safest
                  guess, and you can correct it from the season screen after the game.
                </div>
              </div>

              {/* Session 12, Issue 5: the whole-period escape hatch stays, and
                  stays disabled once the period has elapsed time — that rewrite
                  would falsify minutes already played (the Round-8 bug class). */}
              <button
                type="button"
                onClick={editWholePeriod}
                disabled={periodUnderway}
                style={{
                  ...btnGhost, width: '100%', marginTop: s(16),
                  borderColor: periodUnderway ? UI.blueLine : UI.warn,
                  color: periodUnderway ? UI.label : UI.warnText,
                  background: periodUnderway ? '#fff' : UI.warnTint,
                  cursor: periodUnderway ? 'not-allowed' : 'pointer',
                }}>
                Change the whole period instead
              </button>
              <div style={{ fontSize: Math.max(15, s(17)), fontWeight: 700, color: UI.warnText, marginTop: s(6), lineHeight: 1.4 }}>
                {periodUnderway
                  ? `This period is underway — a whole-period change would rewrite the ${Math.floor(elapsedMs / 60000)}+ minutes already played. Use the minutes above.`
                  : `"Whole period" rewrites who's on for all ${seg.duration} minutes — only for periods that haven't started yet.`}
              </div>
            </div>

            <div style={{ flexShrink: 0, display: 'flex', gap: s(14), padding: `${s(16)}px ${s(30)}px ${s(26)}px`, maxWidth: s(1024), width: '100%', boxSizing: 'border-box' }}>
              <button type="button" onClick={() => { setSubPrompt(false); pendingSwapRef.current = null; }}
                style={{ ...btnGhost, flex: 1, height: s(92) }}>
                Cancel the change
              </button>
              <button
                type="button"
                disabled={!canSplit}
                onClick={() => { setSubPromptMins(String(clamped)); confirmSubFromTime(clamped); }}
                style={{ ...btnSolid(canSplit ? UI.navy : UI.label), flex: 2, height: s(92), cursor: canSplit ? 'pointer' : 'not-allowed' }}>
                {clamped} MINUTE{clamped === 1 ? '' : 'S'} IN — CARRY ON →
              </button>
            </div>
          </div>
        );
      })()}

      {/* ══ Honours sheet (4a) ══ */}
      {honoursOpen && (
        <div style={{ ...modalBackdrop, zIndex: 250 }}>
          <div style={modalCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: s(16) }}>
              <h2 style={{ ...modalTitle, marginBottom: s(6) }}>Season honours</h2>
              <button onClick={() => setHonoursOpen(false)} style={{ ...btnGhost, padding: `${s(14)}px ${s(22)}px`, flexShrink: 0 }}>Close ✕</button>
            </div>
            <div style={{ ...modalBody, marginBottom: s(18) }}>
              {seasonGames.length} round{seasonGames.length !== 1 ? 's' : ''} played · ⭐ Player of the Week · 🏅 Captain
            </div>

            {/* Who has gone longest without one. Never-honoured players sort to
                the top on their own, so this block is never empty. */}
            {dueNext.length > 0 && (
              <div style={{
                background: UI.goTint, border: `4px solid ${UI.go}`, borderRadius: s(16),
                padding: `${s(20)}px ${s(24)}px`, marginBottom: s(20),
              }}>
                <div style={{ ...sectionLabel, color: UI.go, marginBottom: s(4) }}>
                  Longest without one — pick from here
                </div>
                <div style={{ fontSize: Math.max(15, s(19)), fontWeight: 700, color: UI.go, marginBottom: s(14) }}>
                  Playing today, furthest back first.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: s(12) }}>
                  {dueNext.map(p => {
                    const picked = potm === p;
                    return (
                      <button key={p} type="button" onClick={() => setPotm(picked ? '' : p)} style={{
                        background: picked ? UI.navy : '#fff',
                        border: `3px solid ${picked ? UI.navy : UI.go}`,
                        borderRadius: s(12), padding: `${s(12)}px ${s(22)}px`,
                        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                      }}>
                        <div style={{ fontSize: Math.max(20, s(30)), fontWeight: 800, color: picked ? '#fff' : UI.navy }}>
                          {p}{picked ? ' ✓' : ''}
                        </div>
                        <div style={{
                          fontSize: Math.max(15, s(16)), fontWeight: 900, letterSpacing: s(1),
                          textTransform: 'uppercase', color: picked ? UI.goOnDark : UI.go,
                        }}>
                          {roundsSince(p, true)}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {potm && dueNext.includes(potm) && (
                  <div style={{ marginTop: s(14), fontSize: Math.max(15, s(19)), fontWeight: 800, color: UI.go }}>
                    {potm} is lined up for Player of the Week — confirm it on the save screen.
                  </div>
                )}
              </div>
            )}

            {everyoneElse.length > 0 && (
              <>
                <div style={{ ...sectionLabel, marginBottom: s(10) }}>Everyone else</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: s(8) }}>
                  {everyoneElse.map(p => {
                    const { potm: pc, captain: cc } = honours[p];
                    const playingToday = players.includes(p);
                    const dim = '#a8c0d8';
                    return (
                      <div key={p} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        gap: s(12), padding: `${s(16)}px ${s(20)}px`, borderRadius: s(12),
                        background: '#fff',
                        border: `2px ${playingToday ? 'solid' : 'dashed'} ${UI.blueLine}`,
                        opacity: playingToday ? 1 : 0.55,
                      }}>
                        <span style={{ fontSize: Math.max(20, s(30)), fontWeight: 800, color: UI.navy }}>{p}</span>
                        <div style={{
                          display: 'flex', gap: s(18), alignItems: 'baseline',
                          fontSize: Math.max(16, s(24)), fontWeight: 800, color: UI.bodyText,
                          whiteSpace: 'nowrap',
                        }}>
                          <span style={{ color: pc ? UI.bodyText : dim }}>⭐ {pc ? `×${pc}` : '—'}</span>
                          <span style={{ color: cc ? UI.bodyText : dim }}>🏅 {cc ? `×${cc}` : '—'}</span>
                          <span style={{ color: dim }}>
                            {playingToday ? roundsSince(p, false) : 'not playing today'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* No empty state. The point of 4a is that "longest without one"
                answers the question in round 1 too — everyone reads NEVER HAD
                ONE and the coach picks from the shortlist like any other week. */}
          </div>
        </div>
      )}

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
              <label style={{ ...sectionLabel, display: 'block', marginBottom: s(10) }}>⭐ Player of the week</label>
              {honourChipRow(potm, setPotm, potmExpanded, setPotmExpanded)}
              {potm && (
                <div style={{
                  marginTop: s(8), fontSize: Math.max(15, s(18)), fontWeight: 700,
                  color: eligibleForHonour.includes(potm) ? UI.go : UI.bodyText,
                }}>
                  {eligibleForHonour.includes(potm)
                    ? 'Never had one'
                    : `Already has ⭐ ×${honours[potm]?.potm || 0} · last honour ${roundsSince(potm, false)}`}
                  {(matchStats[potm]?.goals || 0) > 0 ? ' · scored today' : ''}
                </div>
              )}
            </div>

            <div style={{ marginBottom: s(28) }}>
              <label style={{ ...sectionLabel, display: 'block', marginBottom: s(10) }}>🏅 Captain next week</label>
              {honourChipRow(captain, setCaptain, captainExpanded, setCaptainExpanded)}
              {suggestedCaptain && (
                <div style={{ marginTop: s(8), fontSize: Math.max(15, s(18)), fontWeight: 700, color: UI.bodyText }}>
                  {suggestedCaptain} captained the last win
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
                releaseWakeLock();
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
