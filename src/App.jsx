/**
 * App — root component.  Manages global state and routes between the three
 * main views: setup (InputView), result (TeamSheetView), season (SeasonView).
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

import InputView      from './components/InputView.jsx';
import TeamSheetView  from './components/TeamSheetView.jsx';
import SeasonView     from './components/SeasonView.jsx';

import { buildSchedule, orderPlayersForGame, applySwap, calcStats } from './scheduler.js';
import { STORAGE_KEY, DEFAULT_PLAYERS } from './constants.js';

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

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  // ── Routing
  const [view, setView] = useState('setup'); // 'setup' | 'result' | 'season'

  // ── Setup state
  const [playersText, setPlayersText] = useState(DEFAULT_PLAYERS);
  const [lockGK,      setLockGK]      = useState(false);

  // ── Season data
  const [seasonGames, setSeasonGames] = useState(loadSeason);

  // ── Generated game state
  const [segments,    setSegments]    = useState(null);
  const [isSaved,     setIsSaved]     = useState(false);

  // ── Toast
  const [toast, setToast] = useState(null);
  const toastTimer         = useRef(null);

  // ── Landing import
  const [importMsg, setImportMsg] = useState(null);

  // Persist season to localStorage whenever it changes
  useEffect(() => { saveSeason(seasonGames); }, [seasonGames]);

  // Derived player list from textarea
  const players = useMemo(
    () => playersText.split('\n').map(l => l.trim()).filter(Boolean),
    [playersText]
  );

  const showToast = useCallback((msg, type = 'ok') => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  // ── Generate team sheet
  const handleGenerate = useCallback(() => {
    if (players.length < 9) { showToast('Need at least 9 players!', 'err'); return; }
    if (players.length > 12) { showToast('Maximum 12 players.', 'err'); return; }
    const segs = buildSchedule(players, lockGK);
    setSegments(segs);
    setIsSaved(false);
    setView('result');
  }, [players, lockGK, showToast]);

  // ── Season-smart reorder
  const handleReorder = useCallback(() => {
    if (seasonGames.length === 0) return;
    const reordered = orderPlayersForGame(players, seasonGames, lockGK);
    setPlayersText(reordered.join('\n'));
    if (reordered.length >= 9 && reordered.length <= 12) {
      setSegments(buildSchedule(reordered, lockGK));
      setIsSaved(false);
      if (view === 'setup') setView('result');
    }
  }, [players, seasonGames, lockGK, view]);

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

  // ── Save game to season
  const handleSave = useCallback(({ label, goals, potm }) => {
    if (!segments) return;
    const stats = calcStats(segments, players);
    const now = new Date();
    const game  = {
      date:     `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`,
      label:    label || '',
      players:  [...players],
      segments: segments.map(s => ({ ...s })),
      stats,
      goals:    goals || {},
      potm:     potm || null,
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

  if (view === 'season') {
    return (
      <SeasonView
        seasonGames={seasonGames}
        onBack={() => setView(segments ? 'result' : 'setup')}
        onDeleteGame={handleDeleteGame}
        onClearAll={handleClearAll}
        onUpdateGame={handleUpdateGame}
      />
    );
  }

  if (view === 'result' && segments) {
    return (
      <TeamSheetView
        players={players}
        segments={segments}
        lockGK={lockGK}
        seasonGames={seasonGames}
        onSwap={handleSwap}
        onSave={handleSave}
        onReorder={handleReorder}
        onGoSeason={() => setView('season')}
        onGoSetup={() => { setView('setup'); setSegments(null); }}
        isSaved={isSaved}
        toast={toast}
      />
    );
  }

  // Default: setup view
  return (
    <InputView
      playersText={playersText}
      setPlayersText={setPlayersText}
      lockGK={lockGK}
      setLockGK={setLockGK}
      onGenerate={handleGenerate}
      onReorder={handleReorder}
      onGoSeason={() => setView('season')}
      seasonGameCount={seasonGames.length}
      onImport={handleLandingImport}
      importMsg={importMsg}
    />
  );
}
