/**
 * SeasonView — the Season Tracker screen.
 * Lists all saved games, shows aggregate stats, and handles
 * export / import / delete / edit-goals.
 */
import { useState, useRef } from 'react';
import { POSITIONS, POS_BG, POS_TEXT, POS_BORDER, STORAGE_KEY } from '../constants.js';

export default function SeasonView({ seasonGames, onBack, onDeleteGame, onClearAll, onUpdateGame, onGoSetup }) {
  const [confirmIdx, setConfirmIdx]     = useState(null); 
  const [editIdx, setEditIdx]           = useState(null); 
  const [expandedIdx, setExpandedIdx]   = useState(null); 
  const [editGoals, setEditGoals]             = useState({});
  const [editAssists, setEditAssists]         = useState({});
  const [editPotm, setEditPotm]               = useState('');
  const [editCaptain, setEditCaptain]         = useState('');
  const [editOurScore, setEditOurScore]       = useState('');
  const [editOppScore, setEditOppScore]       = useState('');
  const [editNotes, setEditNotes]             = useState('');
  const [importMsg, setImportMsg]       = useState(null);
  const importRef                       = useRef(null);

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = () => {
    const data = JSON.stringify({ version: 1, exported: new Date().toISOString(), games: seasonGames }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `teamsheet-season-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Import ────────────────────────────────────────────────────────────────
  const handleImport = (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed   = JSON.parse(e.target.result);
        const incoming = parsed.games || parsed;
        if (!Array.isArray(incoming) || incoming.length === 0) {
          flash('err', 'Invalid file — no games found');
          return;
        }
        const merged = [...seasonGames];
        let added = 0;
        incoming.forEach(game => {
          const isDupe = seasonGames.some(eg =>
            eg.date === game.date &&
            JSON.stringify(eg.players) === JSON.stringify(game.players) &&
            eg.label === game.label
          );
          if (!isDupe) { merged.push(game); added++; }
        });
        if (added === 0) { flash('err', 'No new games to import (all already exist)'); return; }
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch {}
        flash('ok', `✓ Imported ${added} new game${added !== 1 ? 's' : ''}`);
        setTimeout(() => window.location.reload(), 1000);
      } catch {
        flash('err', 'Could not read file — is it a valid export?');
      }
    };
    reader.readAsText(file);
    ev.target.value = '';
  };

  const flash = (type, msg) => {
    setImportMsg({ type, msg });
    setTimeout(() => setImportMsg(null), 3500);
  };

  // ── Season totals ─────────────────────────────────────────────────────────
  const allPlayers  = [...new Set(seasonGames.flatMap(g => g.players))];
  const totals      = Object.fromEntries(allPlayers.map(p => [p, {
    minutes: 0, benchMins: 0, gkH1: 0, gkH2: 0, games: 0, goals: 0, assists: 0, potm: 0,
    captainGames: 0, posCount: {},
  }]));

  seasonGames.forEach(game => {
    const { minutesMap, playerSchedule } = game.stats || {};

    // Per-game GK by half (Sets avoid double-counting multi-seg halves)
    const gkH1Set = new Set(
      (game.segments || []).filter(s => s.half === 1).map(s => s.assignment?.GK).filter(Boolean)
    );
    const gkH2Set = new Set(
      (game.segments || []).filter(s => s.half === 2).map(s => s.assignment?.GK).filter(Boolean)
    );

    game.players.forEach(p => {
      if (!totals[p]) return;
      if (minutesMap?.[p] != null) {
        totals[p].minutes += minutesMap[p];
        totals[p].games   += 1;
        if (gkH1Set.has(p)) totals[p].gkH1++;
        if (gkH2Set.has(p)) totals[p].gkH2++;
        // Bench minutes: sum duration of every segment where this player is on the bench
        (game.segments || []).forEach(seg => {
          if (seg.bench?.includes(p)) totals[p].benchMins += (seg.duration || 0);
        });
        new Set((playerSchedule?.[p] || []).filter(s => s && s !== 'BENCH')).forEach(pos => {
          totals[p].posCount[pos] = (totals[p].posCount[pos] || 0) + 1;
        });
      }
    });
    if (game.goals)   Object.entries(game.goals).forEach(([p, n]) => { if (totals[p]) totals[p].goals += n; });
    if (game.assists) Object.entries(game.assists).forEach(([p, n]) => { if (totals[p]) totals[p].assists += n; });
    if (game.potm    && totals[game.potm])    totals[game.potm].potm++;
    if (game.captain && totals[game.captain]) totals[game.captain].captainGames++;
  });

  // ── Season record (W/D/L) ─────────────────────────────────────────────────
  const record = seasonGames.reduce((acc, g) => {
    if (g.result === 'W') acc.w++;
    else if (g.result === 'D') acc.d++;
    else if (g.result === 'L') acc.l++;
    return acc;
  }, { w: 0, d: 0, l: 0 });
  const hasRecord = record.w + record.d + record.l > 0;

  // Calculate true fairness metrics
  const maxAvgMins = Math.max(...allPlayers.map(p => totals[p].games > 0 ? totals[p].minutes / totals[p].games : 0));
  const maxGoals   = Math.max(...allPlayers.map(p => totals[p]?.goals   || 0));
  const maxAssists = Math.max(...allPlayers.map(p => totals[p]?.assists || 0));

  // ── Empty state ───────────────────────────────────────────────────────────
  if (seasonGames.length === 0) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#4a6b8a', minHeight: '100vh', background: '#f0f6ff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>📅</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: '#0f2d5a', marginBottom: 8 }}>
        No Games Recorded Yet
      </div>
      <div style={{ fontSize: 16, color: '#4a6b8a', fontWeight: 600 }}>
        Play a game and hit "Save to Season" to build your dashboard.
      </div>
      <button onClick={onBack} style={{ marginTop: 24, background: '#1d6fcf', border: 'none', borderRadius: 12, color: '#fff', padding: '16px 32px', cursor: 'pointer', fontSize: 18, fontWeight: 900, boxShadow: '0 8px 24px rgba(29,111,207,0.3)' }}>
        ← Back to Match Setup
      </button>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f0f6ff', fontFamily: 'system-ui, sans-serif' }}>
      
      {/* ── Header ── */}
      <header style={{ background: 'linear-gradient(135deg, #1d6fcf 0%, #0f2d5a 100%)', padding: '32px 24px 24px', textAlign: 'center', position: 'relative' }}>
        <button onClick={onBack} style={{ position: 'absolute', left: 24, top: 32, background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.3)', borderRadius: 12, color: '#fff', padding: '10px 20px', cursor: 'pointer', fontSize: 16, fontWeight: 800 }}>
          ← Back
        </button>
        <div style={{ fontSize: 48, marginBottom: 8 }}>⚖️</div>
        <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, color: '#fff', letterSpacing: -0.5 }}>
          Season Fairness Tracker
        </h1>
        <p style={{ margin: '8px 0 0', color: '#c7daf7', fontSize: 16, fontWeight: 600 }}>
          {seasonGames.length} Game{seasonGames.length !== 1 ? 's' : ''} Recorded
        </p>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          {onGoSetup && (
            <button onClick={onGoSetup} style={{ background: '#f59e0b', border: 'none', borderRadius: 8, color: '#fff', padding: '10px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 900, boxShadow: '0 4px 12px rgba(245,158,11,0.3)' }}>
              ➕ Start New Match
            </button>
          )}
          <button onClick={handleExport} style={{ background: '#059669', border: 'none', borderRadius: 8, color: '#fff', padding: '10px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 800 }}>
            📤 Export Backup
          </button>
          <label style={{ background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.3)', borderRadius: 8, color: '#fff', padding: '10px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 800, display: 'inline-block' }}>
            📥 Import Backup
            <input ref={importRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
          <button onClick={() => setConfirmIdx('all')} style={{ background: '#dc2626', border: 'none', borderRadius: 8, color: '#fff', padding: '10px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 800 }}>
            🗑 Reset Season
          </button>
        </div>
      </header>

      {importMsg && (
        <div style={{ margin: '16px auto', maxWidth: 840, padding: '12px 16px', borderRadius: 12, background: importMsg.type === 'err' ? '#fee2e2' : '#ecfdf5', border: `2px solid ${importMsg.type === 'err' ? '#f87171' : '#059669'}`, color: importMsg.type === 'err' ? '#b91c1c' : '#059669', fontSize: 14, fontWeight: 800, textAlign: 'center' }}>
          {importMsg.msg}
        </div>
      )}

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px 60px' }}>

        {/* ── Season Record ── */}
        {hasRecord && (
          <div style={{ background: '#ffffff', borderRadius: 20, padding: '20px 24px', border: '3px solid #e2ecfc', marginBottom: 24, boxShadow: '0 10px 30px rgba(15,45,90,0.05)', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: '#0f2d5a', letterSpacing: 1, flexShrink: 0 }}>SEASON RECORD</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 20px', borderRadius: 14, background: '#ecfdf5', border: '3px solid #6ee7b7', minWidth: 64 }}>
                <span style={{ fontSize: 28, fontWeight: 900, color: '#059669' }}>{record.w}</span>
                <span style={{ fontSize: 11, fontWeight: 900, color: '#059669', letterSpacing: 1 }}>WIN{record.w !== 1 ? 'S' : ''}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 20px', borderRadius: 14, background: '#fffbeb', border: '3px solid #fcd34d', minWidth: 64 }}>
                <span style={{ fontSize: 28, fontWeight: 900, color: '#b45309' }}>{record.d}</span>
                <span style={{ fontSize: 11, fontWeight: 900, color: '#b45309', letterSpacing: 1 }}>DRAW{record.d !== 1 ? 'S' : ''}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 20px', borderRadius: 14, background: '#fee2e2', border: '3px solid #fca5a5', minWidth: 64 }}>
                <span style={{ fontSize: 28, fontWeight: 900, color: '#dc2626' }}>{record.l}</span>
                <span style={{ fontSize: 11, fontWeight: 900, color: '#dc2626', letterSpacing: 1 }}>LOSS{record.l !== 1 ? 'ES' : ''}</span>
              </div>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 800, color: '#4a6b8a' }}>
              {record.w + record.d + record.l} of {seasonGames.length} game{seasonGames.length !== 1 ? 's' : ''} with results
            </div>
          </div>
        )}

        {/* ── Season Totals Leaderboard (FAIRNESS FIRST) ── */}
        {allPlayers.length > 0 && (
          <div style={{ background: '#ffffff', borderRadius: 20, padding: '24px', border: '3px solid #e2ecfc', marginBottom: 32, boxShadow: '0 10px 30px rgba(15,45,90,0.05)' }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: '#0f2d5a', letterSpacing: 1, marginBottom: 16 }}>FAIRNESS & ROTATION TRACKER</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr>
                    {/* Fairness metrics brought to the front */}
                    {['Player','Games','Mins / Game','Bench','GK H1','GK H2','Goals','Assists','POTM','Captain','Top Positions'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: '#64748b', fontWeight: 800, fontSize: 12, borderBottom: '3px solid #e2ecfc', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allPlayers
                    .sort((a, b) => {
                      // Sort by average minutes so the fairest rotation sits at the top
                      const avgA = totals[a].games > 0 ? totals[a].minutes / totals[a].games : 0;
                      const avgB = totals[b].games > 0 ? totals[b].minutes / totals[b].games : 0;
                      return avgB - avgA;
                    })
                    .map(p => {
                      const t = totals[p];
                      const avgMins = t.games > 0 ? Math.round(t.minutes / t.games) : 0;
                      
                      // Pull the top 3 positions this kid has played
                      const topPositions = Object.entries(t.posCount)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(entry => entry[0])
                        .join(', ');

                      return (
                        <tr key={p}>
                          {/* Player name */}
                          <td style={{ padding: '12px', borderBottom: '1px solid #e2ecfc', whiteSpace: 'nowrap' }}>
                            <div style={{ color: '#0f2d5a', fontWeight: 900, fontSize: 16 }}>{p}{t.potm > 0 ? ' ⭐' : ''}</div>
                          </td>

                          {/* Attendance */}
                          <td style={{ padding: '12px', color: '#64748b', fontWeight: 700, borderBottom: '1px solid #e2ecfc' }}>{t.games}</td>

                          {/* TRUE Fairness Metric: Avg Minutes per Game */}
                          <td style={{ padding: '12px', borderBottom: '1px solid #e2ecfc', minWidth: 160 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ color: '#0f2d5a', fontWeight: 800, width: 40 }}>{avgMins}m</span>
                              <div style={{ flex: 1, height: 8, background: '#e2ecfc', borderRadius: 4 }}>
                                <div style={{ height: '100%', borderRadius: 4, background: '#1d6fcf', width: `${maxAvgMins > 0 ? (avgMins / maxAvgMins) * 100 : 0}%`, transition: 'width 0.5s' }} />
                              </div>
                            </div>
                          </td>

                          {/* Fairness: Bench Minutes */}
                          <td style={{ padding: '12px', borderBottom: '1px solid #e2ecfc' }}>
                            <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 6, background: t.benchMins > 0 ? '#fef3c7' : '#f1f5f9', color: t.benchMins > 0 ? '#b45309' : '#94a3b8', fontWeight: 900, fontSize: 14 }}>
                              {t.benchMins > 0 ? `${t.benchMins}m` : '—'}
                            </span>
                          </td>

                          {/* Fairness: GK H1 */}
                          <td style={{ padding: '12px', borderBottom: '1px solid #e2ecfc' }}>
                            <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 6, background: t.gkH1 > 0 ? '#f3e8ff' : '#f1f5f9', color: t.gkH1 > 0 ? '#7c3aed' : '#94a3b8', fontWeight: 900, fontSize: 14 }}>
                              {t.gkH1 > 0 ? t.gkH1 : '—'}
                            </span>
                          </td>

                          {/* Fairness: GK H2 */}
                          <td style={{ padding: '12px', borderBottom: '1px solid #e2ecfc' }}>
                            <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 6, background: t.gkH2 > 0 ? '#f3e8ff' : '#f1f5f9', color: t.gkH2 > 0 ? '#7c3aed' : '#94a3b8', fontWeight: 900, fontSize: 14 }}>
                              {t.gkH2 > 0 ? t.gkH2 : '—'}
                            </span>
                          </td>

                          {/* Glory: Goals */}
                          <td style={{ padding: '12px', borderBottom: '1px solid #e2ecfc', minWidth: 100 }}>
                            {t.goals > 0 ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#d97706', fontWeight: 900, width: 20 }}>{t.goals}</span>
                                <div style={{ flex: 1, height: 6, background: '#fef3c7', borderRadius: 3 }}>
                                  <div style={{ height: '100%', borderRadius: 3, background: '#f59e0b', width: `${maxGoals > 0 ? (t.goals / maxGoals) * 100 : 0}%` }} />
                                </div>
                              </div>
                            ) : <span style={{ color: '#cbd5e1', fontWeight: 700 }}>—</span>}
                          </td>

                          {/* Glory: Assists */}
                          <td style={{ padding: '12px', borderBottom: '1px solid #e2ecfc', minWidth: 100 }}>
                            {t.assists > 0 ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#059669', fontWeight: 900, width: 20 }}>{t.assists}</span>
                                <div style={{ flex: 1, height: 6, background: '#d1fae5', borderRadius: 3 }}>
                                  <div style={{ height: '100%', borderRadius: 3, background: '#059669', width: `${maxAssists > 0 ? (t.assists / maxAssists) * 100 : 0}%` }} />
                                </div>
                              </div>
                            ) : <span style={{ color: '#cbd5e1', fontWeight: 700 }}>—</span>}
                          </td>

                          {/* POTM */}
                          <td style={{ padding: '12px', color: '#d97706', fontWeight: 900, borderBottom: '1px solid #e2ecfc' }}>
                            {t.potm > 0 ? `⭐ ×${t.potm}` : <span style={{ color: '#cbd5e1' }}>—</span>}
                          </td>

                          {/* Captain */}
                          <td style={{ padding: '12px', fontWeight: 900, borderBottom: '1px solid #e2ecfc' }}>
                            {t.captainGames > 0
                              ? <span style={{ color: '#b45309' }}>🏅 ×{t.captainGames}</span>
                              : <span style={{ color: '#cbd5e1' }}>—</span>}
                          </td>

                          {/* Top Positions */}
                          <td style={{ padding: '12px', borderBottom: '1px solid #e2ecfc', whiteSpace: 'nowrap', color: '#4a6b8a', fontWeight: 700, fontSize: 13 }}>
                            {topPositions || <span style={{ color: '#cbd5e1' }}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Game History Cards ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: '#0f2d5a', letterSpacing: 1, marginLeft: 8 }}>MATCH HISTORY</div>
          {seasonGames.map((game, idx) => {
            const isExpanded = expandedIdx === idx;
            const mins = Object.values(game.stats?.minutesMap || {});
            const minMin = mins.length ? Math.min(...mins) : 0;
            const maxMin = mins.length ? Math.max(...mins) : 0;
            const goalTotal = Object.values(game.goals || {}).reduce((s, n) => s + n, 0);
            const assistTotal = Object.values(game.assists || {}).reduce((s, n) => s + n, 0);

            return (
              <div key={idx} style={{ background: '#ffffff', borderRadius: 16, border: '3px solid #e2ecfc', overflow: 'hidden', transition: 'all 0.2s', boxShadow: isExpanded ? '0 12px 30px rgba(15,45,90,0.1)' : 'none' }}>
                
                {/* Game Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', cursor: 'pointer', background: isExpanded ? '#f8fafc' : '#fff', flexWrap: 'wrap', gap: 12 }} onClick={() => setExpandedIdx(isExpanded ? null : idx)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg, #1d6fcf, #0f2d5a)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
                      #{idx + 1}
                    </div>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: '#0f2d5a', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        {game.label || `Match ${idx + 1}`}
                        {game.result === 'W' && <span style={{ padding: '4px 10px', background: '#ecfdf5', border: '2px solid #6ee7b7', borderRadius: 8, fontSize: 13, fontWeight: 900, color: '#059669' }}>W</span>}
                        {game.result === 'D' && <span style={{ padding: '4px 10px', background: '#fffbeb', border: '2px solid #fcd34d', borderRadius: 8, fontSize: 13, fontWeight: 900, color: '#b45309' }}>D</span>}
                        {game.result === 'L' && <span style={{ padding: '4px 10px', background: '#fee2e2', border: '2px solid #fca5a5', borderRadius: 8, fontSize: 13, fontWeight: 900, color: '#dc2626' }}>L</span>}
                        {game.ourScore != null && game.oppositionScore != null && <span style={{ padding: '4px 10px', background: '#f8fafc', border: '2px solid #cbd5e1', borderRadius: 8, fontSize: 13, fontWeight: 900, color: '#0f2d5a' }}>{game.ourScore} – {game.oppositionScore}</span>}
                        {game.potm && <span style={{ padding: '4px 8px', background: '#fffbeb', border: '2px solid #fcd34d', borderRadius: 8, fontSize: 12, color: '#b45309' }}>⭐ {game.potm}</span>}
                        {game.captain && <span style={{ padding: '4px 8px', background: '#fff7ed', border: '2px solid #fdba74', borderRadius: 8, fontSize: 12, color: '#c2410c' }}>🏅 {game.captain}</span>}
                        {goalTotal > 0 && <span style={{ padding: '4px 8px', background: '#ecfdf5', border: '2px solid #6ee7b7', borderRadius: 8, fontSize: 12, color: '#047857' }}>⚽ {goalTotal} Goals</span>}
                        {assistTotal > 0 && <span style={{ padding: '4px 8px', background: '#eff6ff', border: '2px solid #93c5fd', borderRadius: 8, fontSize: 12, color: '#1d4ed8' }}>🅰️ {assistTotal} Assists</span>}
                        {game.notes && <span style={{ padding: '4px 8px', background: '#f5f3ff', border: '2px solid #c4b5fd', borderRadius: 8, fontSize: 12, color: '#7c3aed' }}>📝 Notes</span>}
                      </div>
                      <div style={{ fontSize: 14, color: '#64748b', marginTop: 4, fontWeight: 600 }}>
                        {game.date} · {game.players.length} Players {minMin === maxMin ? `· Perfectly Equal Time (${minMin}m)` : `· Spread: ${minMin}m – ${maxMin}m`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button onClick={e => { e.stopPropagation(); setEditGoals(game.goals ? { ...game.goals } : {}); setEditAssists(game.assists ? { ...game.assists } : {}); setEditPotm(game.potm || ''); setEditCaptain(game.captain || ''); setEditOurScore(game.ourScore != null ? String(game.ourScore) : ''); setEditOppScore(game.oppositionScore != null ? String(game.oppositionScore) : ''); setEditNotes(game.notes || ''); setEditIdx(idx); }} style={{ padding: '8px 16px', background: '#e2ecfc', border: 'none', borderRadius: 8, color: '#1d6fcf', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
                      ✏️ Edit
                    </button>
                    <button onClick={e => { e.stopPropagation(); setConfirmIdx(idx); }} style={{ padding: '8px 16px', background: '#fee2e2', border: 'none', borderRadius: 8, color: '#dc2626', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
                      🗑
                    </button>
                  </div>
                </div>

                {/* Expanded Player Details */}
                {isExpanded && (
                  <div style={{ padding: '16px 20px', borderTop: '3px solid #e2ecfc', background: '#fff' }}>
                    {game.notes && (
                      <div style={{ marginBottom: 16, padding: '14px 16px', borderRadius: 12, background: '#f5f3ff', border: '2px solid #c4b5fd' }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: '#7c3aed', letterSpacing: 1, marginBottom: 6 }}>📝 MATCH NOTES</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#3b1d8a', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{game.notes}</div>
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                      {game.players.map(p => {
                        const mins = game.stats?.minutesMap?.[p] ?? 0;
                        const sched = game.stats?.playerSchedule?.[p] || [];
                        const positions = [...new Set(sched.filter(s => s && s !== 'BENCH'))];
                        return (
                          <div key={p} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: '#f8fafc', borderRadius: 12, border: '1px solid #cbd5e1' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <span style={{ fontSize: 14, fontWeight: 800, color: '#0f2d5a' }}>{p} {game.potm === p && '⭐'}</span>
                              <div style={{ display: 'flex', gap: 4 }}>
                                {positions.map(pos => (
                                  <span key={pos} style={{ padding: '2px 6px', borderRadius: 6, fontSize: 10, fontWeight: 800, background: POS_BG[pos] || '#64748b', color: POS_TEXT[pos] || '#fff', border: `1px solid ${POS_BORDER[pos] || 'transparent'}` }}>{pos}</span>
                                ))}
                                {sched.some(s => s === 'BENCH') && (
                                  <span style={{ padding: '2px 6px', borderRadius: 6, fontSize: 10, fontWeight: 900, background: '#fef3c7', color: '#b45309' }}>BENCH</span>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 12, fontWeight: 800, fontSize: 14 }}>
                              <span style={{ color: '#64748b' }}>{mins}m</span>
                              {(game.goals?.[p] || 0) > 0 && <span style={{ color: '#d97706' }}>⚽ {game.goals[p]}</span>}
                              {(game.assists?.[p] || 0) > 0 && <span style={{ color: '#059669' }}>🅰️ {game.assists[p]}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>

      {/* ── Fat-Finger Edit Modal ── */}
      {editIdx !== null && seasonGames[editIdx] && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,45,90,0.85)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#ffffff', borderRadius: 24, padding: '32px', maxWidth: 480, width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: 24, fontWeight: 900, color: '#0f2d5a', marginTop: 0, marginBottom: 24 }}>
              ✏️ Edit Game {editIdx + 1}
            </h2>

            {/* POTM */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: '#64748b', marginBottom: 8, letterSpacing: 1 }}>⭐ PLAYER OF THE MATCH</label>
              <select value={editPotm} onChange={e => setEditPotm(e.target.value)} style={{ width: '100%', padding: '16px', borderRadius: 12, border: '3px solid #e2ecfc', fontSize: 16, fontWeight: 800, color: editPotm ? '#d97706' : '#64748b', outline: 'none', cursor: 'pointer' }}>
                <option value="">— None —</option>
                {seasonGames[editIdx].players.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            {/* Captain */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: '#64748b', marginBottom: 8, letterSpacing: 1 }}>🏅 CAPTAIN</label>
              <select value={editCaptain} onChange={e => setEditCaptain(e.target.value)} style={{ width: '100%', padding: '16px', borderRadius: 12, border: '3px solid #e2ecfc', fontSize: 16, fontWeight: 800, color: editCaptain ? '#c2410c' : '#64748b', outline: 'none', cursor: 'pointer' }}>
                <option value="">— None —</option>
                {seasonGames[editIdx].players.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            {/* Score */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: '#64748b', marginBottom: 12, letterSpacing: 1 }}>GAME RESULT</label>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6, textAlign: 'center' }}>OUR SCORE</div>
                  <input type="number" min="0" value={editOurScore} onChange={e => setEditOurScore(e.target.value)} placeholder="–" style={{ width: '100%', padding: '12px', borderRadius: 12, border: '3px solid #1d6fcf', fontSize: 24, fontWeight: 900, textAlign: 'center', boxSizing: 'border-box', color: '#0f2d5a', outline: 'none' }} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#4a6b8a', paddingBottom: 12, flexShrink: 0 }}>–</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6, textAlign: 'center' }}>OPPOSITION</div>
                  <input type="number" min="0" value={editOppScore} onChange={e => setEditOppScore(e.target.value)} placeholder="–" style={{ width: '100%', padding: '12px', borderRadius: 12, border: '3px solid #e2ecfc', fontSize: 24, fontWeight: 900, textAlign: 'center', boxSizing: 'border-box', color: '#64748b', outline: 'none' }} />
                </div>
              </div>
            </div>

            {/* Goals & Assists List */}
            <div style={{ marginBottom: 32 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: '#64748b', marginBottom: 12, letterSpacing: 1 }}>⚽ GOALS & 🅰️ ASSISTS</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {seasonGames[editIdx].players.map(p => (
                  <div key={p} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: '#f8fafc', borderRadius: 12, border: '2px solid #e2ecfc', gap: 12 }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#0f2d5a', flex: '1 1 auto', minWidth: '80px' }}>{p}</span>
                    
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      {/* Goals Stepper */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#d97706' }}>⚽</span>
                        <button onClick={() => setEditGoals(g => ({ ...g, [p]: Math.max(0, (g[p] || 0) - 1) }))} style={{ width: 36, height: 36, borderRadius: 8, background: '#fff', border: '2px solid #fcd34d', color: '#d97706', fontSize: 20, fontWeight: 900, cursor: 'pointer' }}>−</button>
                        <span style={{ fontSize: 18, fontWeight: 900, color: (editGoals[p] || 0) > 0 ? '#b45309' : '#cbd5e1', width: 24, textAlign: 'center' }}>{editGoals[p] || 0}</span>
                        <button onClick={() => setEditGoals(g => ({ ...g, [p]: (g[p] || 0) + 1 }))} style={{ width: 36, height: 36, borderRadius: 8, background: '#f59e0b', border: 'none', color: '#fff', fontSize: 20, fontWeight: 900, cursor: 'pointer' }}>+</button>
                      </div>

                      {/* Assists Stepper */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#059669' }}>🅰️</span>
                        <button onClick={() => setEditAssists(a => ({ ...a, [p]: Math.max(0, (a[p] || 0) - 1) }))} style={{ width: 36, height: 36, borderRadius: 8, background: '#fff', border: '2px solid #6ee7b7', color: '#059669', fontSize: 20, fontWeight: 900, cursor: 'pointer' }}>−</button>
                        <span style={{ fontSize: 18, fontWeight: 900, color: (editAssists[p] || 0) > 0 ? '#047857' : '#cbd5e1', width: 24, textAlign: 'center' }}>{editAssists[p] || 0}</span>
                        <button onClick={() => setEditAssists(a => ({ ...a, [p]: (a[p] || 0) + 1 }))} style={{ width: 36, height: 36, borderRadius: 8, background: '#10b981', border: 'none', color: '#fff', fontSize: 20, fontWeight: 900, cursor: 'pointer' }}>+</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: '#64748b', marginBottom: 8, letterSpacing: 1 }}>📝 MATCH NOTES</label>
              <textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                placeholder="Tactics, HT talk, training focus..."
                style={{ width: '100%', minHeight: 100, padding: 14, borderRadius: 12, border: '3px solid #e2ecfc', fontSize: 15, fontWeight: 600, color: '#0f2d5a', background: '#f8fafc', resize: 'vertical', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setEditIdx(null)} style={{ flex: 1, padding: 16, background: '#f1f5f9', border: 'none', borderRadius: 12, color: '#64748b', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => {
                  const goals = Object.fromEntries(Object.entries(editGoals).filter(([, v]) => v > 0).map(([k, v]) => [k, Number(v)]));
                  const assists = Object.fromEntries(Object.entries(editAssists).filter(([, v]) => v > 0).map(([k, v]) => [k, Number(v)]));
                  const ourSc = editOurScore !== '' ? Number(editOurScore) : null;
                  const oppSc = editOppScore !== '' ? Number(editOppScore) : null;
                  const result = (ourSc != null && oppSc != null) ? (ourSc > oppSc ? 'W' : ourSc < oppSc ? 'L' : 'D') : null;
                  onUpdateGame(editIdx, { goals, assists, potm: editPotm || null, captain: editCaptain || null, ourScore: ourSc, oppositionScore: oppSc, result, notes: editNotes });
                  setEditIdx(null);
                }} style={{ flex: 2, padding: 16, background: '#1d6fcf', border: 'none', borderRadius: 12, color: '#fff', fontSize: 16, fontWeight: 900, cursor: 'pointer' }}>
                💾 Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Delete Modal ── */}
      {confirmIdx !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,45,90,0.85)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#ffffff', borderRadius: 24, padding: '32px', maxWidth: 400, width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.3)', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🗑️</div>
            <h2 style={{ fontSize: 24, fontWeight: 900, color: '#0f2d5a', marginTop: 0, marginBottom: 12 }}>
              {confirmIdx === 'all' 
                ? 'Reset Entire Season?' 
                : `Delete Match ${confirmIdx + 1}${seasonGames[confirmIdx]?.label ? ` (${seasonGames[confirmIdx].label})` : ''}?`}
            </h2>
            <p style={{ fontSize: 16, color: '#64748b', fontWeight: 600, marginBottom: 32 }}>This cannot be undone.</p>
            
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setConfirmIdx(null)} style={{ flex: 1, padding: 16, background: '#f1f5f9', border: 'none', borderRadius: 12, color: '#64748b', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => {
                  if (confirmIdx === 'all') onClearAll();
                  else {
                    if (expandedIdx === confirmIdx) setExpandedIdx(null);
                    else if (expandedIdx > confirmIdx) setExpandedIdx(expandedIdx - 1);
                    onDeleteGame(confirmIdx);
                  }
                  setConfirmIdx(null);
                }} style={{ flex: 1, padding: 16, background: '#dc2626', border: 'none', borderRadius: 12, color: '#fff', fontSize: 16, fontWeight: 900, cursor: 'pointer' }}>
                {confirmIdx === 'all' ? 'Reset All' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}