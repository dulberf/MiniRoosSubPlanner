/**
 * App — root component.  Manages global state and routes between the three
 * main views: setup (InputView), result (TeamSheetView), season (SeasonView).
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

import InputView      from './components/InputView.jsx';
import TeamSheetView  from './components/TeamSheetView.jsx';
import SeasonView     from './components/SeasonView.jsx';

import { buildSchedule, orderPlayersForGame, applySwap, calcStats, splitSegment, changeGKFromSegment, getSecondGKSlot } from './scheduler.js';
import { STORAGE_KEY, IN_PROGRESS_KEY, DEFAULT_PLAYERS } from './constants.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function loadSeason() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSeason(games) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(games)); } catch {}
}

function saveInProgress(data) {
  try { localStorage.setItem(IN_PROGRESS_KEY, JSON.stringify(data)); } catch {}
}
function loadInProgress() {
  try { const raw = localStorage.getItem(IN_PROGRESS_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function clearInProgress() {
  try { localStorage.removeItem(IN_PROGRESS_KEY); } catch {}
}

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  // ── Routing
  const [view, setView] = useState('setup'); // 'setup' | 'result' | 'season'

  // ── Setup state
  const [playersText, setPlayersText] = useState(DEFAULT_PLAYERS);
  const [gkH1,        setGkH1]        = useState(null);
  const [gkH2,        setGkH2]        = useState(null);

  // ── Season data
  const [seasonGames, setSeasonGames] = useState(loadSeason);

  // ── Generated game state
  const [segments,    setSegments]    = useState(null);
  const [isSaved,     setIsSaved]     = useState(false);

  // ── Crash recovery
  const [resumeData,    setResumeData]    = useState(null);
  const [initialSegData, setInitialSegData] = useState({ currentSeg: 0, matchStats: {} });
  // Tracks whether in-progress data exists in localStorage. Stays true until the
  // coach explicitly starts a new game or confirms discard — NOT cleared on modal dismiss.
  const [hasInProgress, setHasInProgress] = useState(() => !!loadInProgress()?.segments);

  useEffect(() => {
    const data = loadInProgress();
    if (data?.segments) setResumeData(data);
  }, []);

  // ── Game clock (source of truth for live countdown timer)
  //    segmentStartTime – Date.now() when the current period was started/resumed
  //    accumulatedMs    – ms banked from previous start→pause cycles within this period
  //    currentSegIdx    – which segment is actively being timed
  //    isRunning        – true while the clock is ticking
  const [gameClock, setGameClock] = useState({
    segmentStartTime: null,
    accumulatedMs:    0,
    currentSegIdx:    null,
    isRunning:        false,
  });

  // Ref for segments so clock callbacks always read the latest value
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  // ── Toast
  const [toast, setToast] = useState(null);
  const toastTimer         = useRef(null);

  // ── Landing import
  const [importMsg, setImportMsg] = useState(null);

  // Persist season to localStorage whenever it changes
  useEffect(() => { saveSeason(seasonGames); }, [seasonGames]);

  // Warn before leaving if a game is in progress and unsaved.
  // Triggers the browser's native "Leave page?" dialog on desktop/dev.
  useEffect(() => {
    if (!segments || isSaved) return;
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = ''; // required for Chrome to show the dialog
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [segments, isSaved]);

  // Derived player list from textarea
  const players = useMemo(
    () => playersText.split('\n').map(l => l.trim()).filter(Boolean),
    [playersText]
  );

  // Auto-suggest GKs from the fairness oracle. Fires when squad changes or a
  // pick falls out of the squad. Preserves manual picks, then ensures H1 ≠ H2
  // (when the oracle's H2 slot would collide with a preserved H1, fall back to
  // the oracle's H1 slot — guaranteed to be a different player).
  useEffect(() => {
    if (players.length < 6 || players.length > 12) return;
    const reordered = orderPlayersForGame(players, seasonGames, false);
    const slot = getSecondGKSlot(reordered.length);
    const oracleH1 = reordered[0] ?? null;
    const oracleH2 = (slot > 0 && reordered[slot]) ? reordered[slot] : null;

    const finalH1 = (gkH1 && players.includes(gkH1)) ? gkH1 : oracleH1;
    let finalH2;
    if (gkH2 && players.includes(gkH2) && gkH2 !== finalH1) {
      finalH2 = gkH2;
    } else if (oracleH2 && oracleH2 !== finalH1) {
      finalH2 = oracleH2;
    } else if (oracleH1 && oracleH1 !== finalH1) {
      finalH2 = oracleH1;
    } else {
      finalH2 = finalH1; // tiny squad fallback
    }

    if (finalH1 !== gkH1) setGkH1(finalH1);
    if (finalH2 !== gkH2) setGkH2(finalH2);
  }, [players, seasonGames, gkH1, gkH2]);

  const showToast = useCallback((msg, type = 'ok') => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  // ── Generate team sheet
  const handleGenerate = useCallback(() => {
    if (players.length < 6) { showToast('Need at least 6 players!', 'err'); return; }
    if (players.length > 12) { showToast('Maximum 12 players.', 'err'); return; }
    const segs = buildSchedule(players, { gkH1, gkH2 });
    clearInProgress();
    setHasInProgress(false);
    setInitialSegData({ currentSeg: 0, matchStats: {} });
    setSegments(segs);
    setIsSaved(false);
    setGameClock({ segmentStartTime: null, accumulatedMs: 0, currentSegIdx: null, isRunning: false });
    setView('result');
  }, [players, gkH1, gkH2, showToast]);

  // ── In-progress save (called by TeamSheetView on segment change)
  const handleProgressUpdate = useCallback((currentSeg, matchStats) => {
    if (!segments) return;
    saveInProgress({ segments, playersText, gkH1, gkH2, currentSeg, matchStats });
  }, [segments, playersText, gkH1, gkH2]);

  // ── Resume from setup screen banner (used when modal was dismissed but data still exists)
  const handleResumeFromStorage = useCallback(() => {
    const data = loadInProgress();
    if (!data?.segments) return;
    setPlayersText(data.playersText);
    if (data.gkH1) setGkH1(data.gkH1);
    if (data.gkH2) setGkH2(data.gkH2);
    setSegments(data.segments);
    setInitialSegData({ currentSeg: data.currentSeg, matchStats: data.matchStats || {} });
    setGameClock({ segmentStartTime: null, accumulatedMs: 0, currentSegIdx: data.currentSeg, isRunning: false });
    setIsSaved(false);
    setView('result');
  }, []);

  // ── Season-smart reorder. Respects manual GK picks if they're still in the squad;
  // otherwise falls back to the fairness oracle's choice. Guards against H2
  // collapsing to the same player as H1 when the oracle's H2 slot happens to be
  // whoever's currently preserved as H1.
  const handleReorder = useCallback(() => {
    if (seasonGames.length === 0) return;
    const reordered = orderPlayersForGame(players, seasonGames, false);
    setPlayersText(reordered.join('\n'));
    if (reordered.length >= 6 && reordered.length <= 12) {
      const slot = getSecondGKSlot(reordered.length);
      const oracleH1 = reordered[0] ?? null;
      const oracleH2 = (slot > 0 && reordered[slot]) ? reordered[slot] : null;
      const finalH1 = (gkH1 && reordered.includes(gkH1)) ? gkH1 : oracleH1;
      let finalH2;
      if (gkH2 && reordered.includes(gkH2) && gkH2 !== finalH1) {
        finalH2 = gkH2;
      } else if (oracleH2 && oracleH2 !== finalH1) {
        finalH2 = oracleH2;
      } else if (oracleH1 && oracleH1 !== finalH1) {
        finalH2 = oracleH1;
      } else {
        finalH2 = finalH1;
      }
      setGkH1(finalH1);
      setGkH2(finalH2);
      setSegments(buildSchedule(reordered, { gkH1: finalH1, gkH2: finalH2 }));
      setIsSaved(false);
      if (view === 'setup') setView('result');
    }
  }, [players, seasonGames, view, gkH1, gkH2]);

  // ── Mid-game GK change (from TeamSheetView player modal)
  const handleChangeGK = useCallback((fromSegIdx, newGKName) => {
    setSegments(prev => prev ? changeGKFromSegment(prev, fromSegIdx, newGKName) : prev);
    setIsSaved(false);
    showToast(`${newGKName} is now in goal`);
  }, [showToast]);

  // ── Manual player swap within a segment
  const handleSwap = useCallback((segIdx, swapAction) => {
    setSegments(prev => {
      const updated = [...prev];
      updated[segIdx] = applySwap(prev[segIdx], swapAction);

      // Position persistence: propagate forward through subsequent segments.
      //
      // Rule: any player who stays on the field keeps the exact position they
      // held in the previous (already-updated) segment. Players coming on from
      // the bench slot into whichever positions were vacated by those going off.
      //
      // Stops at the half-time boundary — H2 positions are managed separately.
      for (let i = segIdx + 1; i < updated.length; i++) {
        const prevSeg = updated[i - 1]; // previous segment (already updated)
        const currSeg = updated[i];     // segment to recompute

        // Half-time is a hard reset — don't carry positions into the next half
        if (currSeg.htBefore) break;

        const prevBenchSet = new Set(prevSeg.bench);
        const currBenchSet = new Set(currSeg.bench);

        // Start with every player in their prevSeg position
        const newAssignment = { ...prevSeg.assignment };

        // Remove players who are going to bench this segment;
        // record the positions they vacate
        const vacatedPositions = [];
        Object.entries(newAssignment).forEach(([pos, name]) => {
          if (currBenchSet.has(name)) {
            delete newAssignment[pos];
            vacatedPositions.push(pos);
          }
        });

        // Incoming players: were on bench in prevSeg, now on field in currSeg
        const incomingPlayers = Object.values(currSeg.assignment)
          .filter(name => name && prevBenchSet.has(name));

        // Slot each incoming player into a vacated position
        incomingPlayers.forEach((name, idx) => {
          if (vacatedPositions[idx] !== undefined) {
            newAssignment[vacatedPositions[idx]] = name;
          }
        });

        updated[i] = {
          ...currSeg,
          assignment: newAssignment,
          gkName: newAssignment.GK || currSeg.gkName,
          edited: true,
        };
      }

      return updated;
    });
    setIsSaved(false);
    showToast('Swap applied ✓');
  }, [showToast]);

  // ── Game clock controls ──────────────────────────────────────────────────
  //
  // The clock is per-SEGMENT but auto-rolls to the next segment when the
  // countdown reaches zero, without pausing.  It only stops at a half-time
  // boundary (next segment has htBefore === true) or end of game.
  //
  // Gemini's setInterval computes the countdown and calls advanceSegment()
  // when it hits zero.  The overshoot is carried forward so there's no drift.

  /**
   * Start (or resume) the clock for a given segment.
   *
   * offsetSeconds – signed offset in seconds.  Positive = time already
   *   elapsed (coach was late pressing start).  Negative = rewind
   *   (jumped ahead by accident).  The segmentStartTime is shifted so
   *   Gemini's elapsed-time math stays in sync with the referee.
   */
  const startCurrentPeriod = useCallback((segIdx, offsetSeconds = 0) => {
    const offsetMs = offsetSeconds * 1000;
    setGameClock(prev => {
      const isSameSegment = prev.currentSegIdx === segIdx;
      return {
        segmentStartTime: Date.now() - offsetMs,
        accumulatedMs:    isSameSegment ? Math.max(0, prev.accumulatedMs + offsetMs) : Math.max(0, offsetMs),
        currentSegIdx:    segIdx,
        isRunning:        true,
      };
    });
  }, []);

  /**
   * Pause the clock.  Only stops at half-time or end of game — Gemini
   * should NOT call this between segments within a half.
   */
  const pauseCurrentPeriod = useCallback(() => {
    setGameClock(prev => {
      if (!prev.isRunning || prev.segmentStartTime === null) return prev;
      return {
        ...prev,
        accumulatedMs:    prev.accumulatedMs + (Date.now() - prev.segmentStartTime),
        segmentStartTime: null,
        isRunning:        false,
      };
    });
  }, []);

  /**
   * Nudge the running clock forward or backward by `deltaSeconds`.
   * Positive = add time (clock jumps ahead), negative = subtract.
   * Works whether the clock is running or paused.
   */
  const nudgeClock = useCallback((deltaSeconds) => {
    const deltaMs = deltaSeconds * 1000;
    setGameClock(prev => {
      if (prev.currentSegIdx === null) return prev;
      return {
        ...prev,
        accumulatedMs: Math.max(0, prev.accumulatedMs + deltaMs),
      };
    });
  }, []);

  /**
   * Auto-advance to the next segment.  Gemini's setInterval should call
   * this when the per-segment countdown reaches zero.
   *
   * Carries the overshoot (ms past the boundary) into the next segment so
   * the continuous clock doesn't drift.  Automatically pauses if the next
   * segment is a half-time boundary or the game is over.
   */
  const advanceSegment = useCallback(() => {
    setGameClock(prev => {
      if (prev.currentSegIdx === null) return prev;
      const segs = segmentsRef.current;
      if (!segs) return prev;

      const seg = segs[prev.currentSegIdx];
      const segDurationMs = seg.duration * 60000;

      // Compute how far past the segment boundary we are
      const elapsedMs = prev.accumulatedMs +
        (prev.isRunning && prev.segmentStartTime ? Date.now() - prev.segmentStartTime : 0);
      const overshootMs = Math.max(0, elapsedMs - segDurationMs);

      const nextIdx = prev.currentSegIdx + 1;

      // Stop at end of game or half-time boundary
      if (nextIdx >= segs.length || segs[nextIdx].htBefore) {
        return {
          segmentStartTime: null,
          accumulatedMs:    0,
          currentSegIdx:    prev.currentSegIdx,
          isRunning:        false,
        };
      }

      // Roll into the next segment, carrying the overshoot
      return {
        segmentStartTime: Date.now(),
        accumulatedMs:    overshootMs,
        currentSegIdx:    nextIdx,
        isRunning:        true,
      };
    });
  }, []);

  /**
   * Zero out the running clock (e.g. coach started it by accident).
   * Keeps currentSegIdx so the UI stays on the same segment.
   */
  const resetClock = useCallback(() => {
    setGameClock(prev => ({
      segmentStartTime: null,
      accumulatedMs:    0,
      currentSegIdx:    prev.currentSegIdx,
      isRunning:        false,
    }));
  }, []);

  /**
   * Total wipe — back to the setup screen, clear segments and clock.
   */
  const resetGame = useCallback(() => {
    setSegments(null);
    setIsSaved(false);
    setGameClock({ segmentStartTime: null, accumulatedMs: 0, currentSegIdx: null, isRunning: false });
    setView('setup');
  }, []);

  /**
   * Split the current segment at the live elapsed time and pause the clock.
   * Returns the index of the new "future" segment (B) so the UI can
   * immediately offer the swap interface on it.
   */
  const handleSplitSegment = useCallback(() => {
    let futureSegIdx = null;

    setGameClock(prev => {
      if (prev.currentSegIdx === null) return prev;

      const elapsedMs = prev.accumulatedMs +
        (prev.isRunning && prev.segmentStartTime ? Date.now() - prev.segmentStartTime : 0);
      const elapsedMinutes = Math.max(1, Math.round(elapsedMs / 60000));

      setSegments(prevSegs => {
        const seg = prevSegs[prev.currentSegIdx];
        const clamped = Math.min(elapsedMinutes, seg.duration - 1);
        const newSegs = splitSegment(prevSegs, prev.currentSegIdx, clamped);
        futureSegIdx = prev.currentSegIdx + 1;
        return newSegs;
      });
      setIsSaved(false);

      // Pause the clock and point to the new "future" segment
      return {
        segmentStartTime: null,
        accumulatedMs:    0,
        currentSegIdx:    prev.currentSegIdx + 1,
        isRunning:        false,
      };
    });

    return futureSegIdx;
  }, []);

  // ── Save game to season
  const handleSave = useCallback(({ label, goals, assists, potm, captain, ourScore, oppositionScore, notes }) => {
    if (!segments) return;
    const stats = calcStats(segments, players);
    const now = new Date();
    const result = (ourScore != null && oppositionScore != null)
      ? (ourScore > oppositionScore ? 'W' : ourScore < oppositionScore ? 'L' : 'D')
      : null;
    const game  = {
      date:           `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`,
      label:          label || '',
      players:        [...players],
      segments:       segments.map(s => ({ ...s })),
      stats,
      goals:          goals || {},
      assists:        assists || {},
      potm:           potm || null,
      captain:        captain || null,
      ourScore:       ourScore ?? null,
      oppositionScore: oppositionScore ?? null,
      result,
      notes:          notes || '',
    };

    setSeasonGames(prev => {
      // If already saved (editing), replace the last matching entry
      if (isSaved) {
        const idx = [...prev].reverse().findIndex(
          g => g.date === game.date && JSON.stringify(g.players) === JSON.stringify(players)
        );
        if (idx !== -1) {
          const realIdx = prev.length - 1 - idx;
          const next = [...prev];
          next[realIdx] = game;
          return next;
        }
      }
      return [...prev, game];
    });

    setIsSaved(true);
    clearInProgress();
    setHasInProgress(false);
    showToast(isSaved ? 'Changes saved ✓' : 'Saved to season ✓');
  }, [segments, players, isSaved, showToast]);

  // ── Season management
  const handleDeleteGame = useCallback((idx) => {
    setSeasonGames(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleClearAll = useCallback(() => {
    setSeasonGames([]);
  }, []);

  const handleUpdateGame = useCallback((idx, updates) => {
    setSeasonGames(prev => prev.map((g, i) => i === idx ? { ...g, ...updates } : g));
  }, []);

  // ── Landing page import (from InputView)
  const handleLandingImport = useCallback((ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed   = JSON.parse(e.target.result);
        const incoming = parsed.games || parsed;
        if (!Array.isArray(incoming) || incoming.length === 0) {
          setImportMsg({ type: 'err', msg: 'Invalid file — no games found' });
          setTimeout(() => setImportMsg(null), 3500);
          return;
        }
        const merged = [...seasonGames];
        let added = 0;
        incoming.forEach(game => {
          const dup = seasonGames.some(eg =>
            eg.date === game.date &&
            JSON.stringify(eg.players) === JSON.stringify(game.players) &&
            eg.label === game.label
          );
          if (!dup) { merged.push(game); added++; }
        });
        if (added === 0) {
          setImportMsg({ type: 'err', msg: 'No new games — all already imported' });
          setTimeout(() => setImportMsg(null), 3500);
          return;
        }
        setSeasonGames(merged);
        setImportMsg({ type: 'ok', msg: `✓ Imported ${added} game${added !== 1 ? 's' : ''}` });
        setTimeout(() => setImportMsg(null), 3500);
      } catch {
        setImportMsg({ type: 'err', msg: 'Could not read file — valid export?' });
        setTimeout(() => setImportMsg(null), 3500);
      }
    };
    reader.readAsText(file);
    ev.target.value = '';
  }, [seasonGames]);

  // ── Routing ───────────────────────────────────────────────────────────────

  // Resume prompt — shown on top of whatever view is active
  const resumePrompt = resumeData && (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,45,90,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 24, padding: 32, maxWidth: 420, width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.3)', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚽</div>
        <h2 style={{ fontSize: 24, fontWeight: 900, color: '#0f2d5a', margin: '0 0 12px' }}>Game in Progress</h2>
        <p style={{ fontSize: 16, color: '#4a6b8a', fontWeight: 600, margin: '0 0 32px' }}>
          You have an unfinished game from your last session. Do you want to resume it?
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => setResumeData(null)} style={{ flex: 1, padding: 18, borderRadius: 12, background: '#f1f5f9', color: '#64748b', fontSize: 16, fontWeight: 800, border: 'none', cursor: 'pointer' }}>
            Not Now
          </button>
          <button onClick={() => {
            setPlayersText(resumeData.playersText);
            if (resumeData.gkH1) setGkH1(resumeData.gkH1);
            if (resumeData.gkH2) setGkH2(resumeData.gkH2);
            setSegments(resumeData.segments);
            setInitialSegData({ currentSeg: resumeData.currentSeg, matchStats: resumeData.matchStats || {} });
            setGameClock({ segmentStartTime: null, accumulatedMs: 0, currentSegIdx: resumeData.currentSeg, isRunning: false });
            setIsSaved(false);
            setView('result');
            setResumeData(null);
          }} style={{ flex: 2, padding: 18, borderRadius: 12, background: '#1d6fcf', color: '#fff', fontSize: 16, fontWeight: 900, border: 'none', cursor: 'pointer' }}>
            Resume Game
          </button>
        </div>
      </div>
    </div>
  );

  if (view === 'season') {
    return (
      <>
        {resumePrompt}
        <SeasonView
          seasonGames={seasonGames}
          onBack={() => setView(segments ? 'result' : 'setup')}
          onDeleteGame={handleDeleteGame}
          onClearAll={handleClearAll}
          onUpdateGame={handleUpdateGame}
          onGoSetup={() => { setSegments(null); setView('setup'); }}
        />
      </>
    );
  }

  if (view === 'result' && segments) {
    return (
      <TeamSheetView
        players={players}
        segments={segments}
        seasonGames={seasonGames}
        onSwap={handleSwap}
        onSave={handleSave}
        onReorder={handleReorder}
        onGoSeason={() => setView('season')}
        onGoSetup={() => { setView('setup'); setSegments(null); }}
        isSaved={isSaved}
        toast={toast}
        gameClock={gameClock}
        onStartPeriod={startCurrentPeriod}
        onPausePeriod={pauseCurrentPeriod}
        onNudgeClock={nudgeClock}
        onAdvanceSegment={advanceSegment}
        onResetClock={resetClock}
        onResetGame={resetGame}
        onSplitSegment={handleSplitSegment}
        onChangeGK={handleChangeGK}
        initialCurrentSeg={initialSegData.currentSeg}
        initialMatchStats={initialSegData.matchStats}
        onProgressUpdate={handleProgressUpdate}
      />
    );
  }

  // Default: setup view
  return (
    <>
      {resumePrompt}
      {hasInProgress && !resumeData && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#1d6fcf', color: '#fff', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 50, boxShadow: '0 -4px 16px rgba(0,0,0,0.2)' }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>⚽ Game in progress</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleResumeFromStorage} style={{ background: '#fff', color: '#1d6fcf', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Resume</button>
            <button onClick={() => { clearInProgress(); setHasInProgress(false); }} style={{ background: 'transparent', color: '#fff', border: '2px solid rgba(255,255,255,0.5)', borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Discard</button>
          </div>
        </div>
      )}
      <InputView
        playersText={playersText}
        setPlayersText={setPlayersText}
        gkH1={gkH1}
        setGkH1={setGkH1}
        gkH2={gkH2}
        setGkH2={setGkH2}
        onGenerate={handleGenerate}
        onReorder={handleReorder}
        onGoSeason={() => setView('season')}
        seasonGameCount={seasonGames.length}
        onImport={handleLandingImport}
        importMsg={importMsg}
      />
    </>
  );
}
