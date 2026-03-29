/**
 * SeasonView — the Season Tracker screen.
 * Lists all saved games, shows aggregate stats, and handles
 * export / import / delete / edit-goals.
 */
import { useState, useRef } from 'react';
import { POSITIONS, POS_BG, POS_TEXT, POS_BORDER, STORAGE_KEY } from '../constants.js';

export default function SeasonView({ seasonGames, onBack, onDeleteGame, onClearAll, onUpdateGame }) {
  const [confirmIdx, setConfirmIdx]     = useState(null); // index or 'all'
  const [editIdx, setEditIdx]           = useState(null); // game index being edited
  const [expandedIdx, setExpandedIdx]   = useState(null); // expanded game card
  const [editGoals, setEditGoals]       = useState({});
  const [editAssists, setEditAssists]   = useState({});
  const [editPotm, setEditPotm]         = useState('');
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
    minutes: 0, benchSegs: 0, gkGames: 0, games: 0, goals: 0, assists: 0, potm: 0,
    posCount: {},
  }]));

  seasonGames.forEach(game => {
    const { minutesMap, gkDutyMap, playerSchedule } = game.stats || {};
    game.players.forEach(p => {
      if (!totals[p]) return;
      if (minutesMap?.[p] != null) {
        totals[p].minutes   += minutesMap[p];
        totals[p].benchSegs += (playerSchedule?.[p] || []).filter(s => s === 'BENCH').length;
        totals[p].gkGames   += game.segments.some(seg => seg.assignment?.GK === p) ? 1 : 0;
        totals[p].games     += 1;
        new Set((playerSchedule?.[p] || []).filter(s => s && s !== 'BENCH')).forEach(pos => {
          totals[p].posCount[pos] = (totals[p].posCount[pos] || 0) + 1;
        });
      }
    });
    if (game.goals) Object.entries(game.goals).forEach(([p, n]) => { if (totals[p]) totals[p].goals += n; });
    if (game.assists) Object.entries(game.assists).forEach(([p, n]) => { if (totals[p]) totals[p].assists += n; });
    if (game.potm && totals[game.potm]) totals[game.potm].potm++;
  });

  const maxMins    = Math.max(...allPlayers.map(p => totals[p]?.minutes || 0));
  const maxGoals   = Math.max(...allPlayers.map(p => totals[p]?.goals   || 0));
  const maxAssists = Math.max(...allPlayers.map(p => totals[p]?.assists || 0));

  // ── Empty state ───────────────────────────────────────────────────────────
  if (seasonGames.length === 0) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#4a6b8a' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>📅</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#7a96b0', marginBottom: 8 }}>
        No games saved yet
      </div>
      <div style={{ fontSize: 12, color: '#4a6b8a' }}>
        Generate a team sheet and click "Save to Season" to start tracking
      </div>
      <button onClick={onBack} style={{ marginTop: 20, background: '#ffffff',
        border: '1px solid #c7daf7', borderRadius: 8, color: '#7a96b0',
        padding: '8px 18px', cursor: 'pointer', fontSize: 13 }}>
        ← Back
      </button>
    </div>
  );

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 50% 0%, #d6e8ff 0%, #f0f6ff 70%)',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      padding: '14px 12px 40px',
    }}>
      <div style={{ maxWidth: 840, margin: '0 auto' }}>

        {/* ── Confirm delete modal ── */}
        {confirmIdx !== null && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                        zIndex: 999, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', padding: 20 }}>
            <div style={{ background: '#ffffff', border: '1px solid #fca5a5',
                          borderRadius: 14, padding: '24px 28px', maxWidth: 340,
                          width: '100%', boxShadow: '0 16px 48px rgba(0,40,100,0.15)' }}>
              <div style={{ fontSize: 22, marginBottom: 10, textAlign: 'center' }}>🗑</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f2d5a',
                            marginBottom: 8, textAlign: 'center' }}>
                {confirmIdx === 'all'
                  ? 'Clear all saved games?'
                  : `Delete Game ${confirmIdx + 1}${seasonGames[confirmIdx]?.label ? ` — ${seasonGames[confirmIdx].label}` : ''}?`}
              </div>
              <div style={{ fontSize: 12, color: '#4a6b8a', marginBottom: 20, textAlign: 'center' }}>
                This cannot be undone.
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setConfirmIdx(null)}
                  style={{ flex: 1, padding: 10, background: '#ffffff',
                           border: '1px solid #c7daf7', borderRadius: 8,
                           color: '#4a6b8a', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={() => {
                    if (confirmIdx === 'all') {
                      onClearAll();
                    } else {
                      if (expandedIdx === confirmIdx) setExpandedIdx(null);
                      else if (expandedIdx > confirmIdx) setExpandedIdx(expandedIdx - 1);
                      onDeleteGame(confirmIdx);
                    }
                    setConfirmIdx(null);
                  }}
                  style={{ flex: 1, padding: 10, background: '#fee2e2',
                           border: '1px solid #f87171', borderRadius: 8,
                           color: '#dc2626', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  {confirmIdx === 'all' ? 'Clear All' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Edit goals / POTM modal ── */}
        {editIdx !== null && seasonGames[editIdx] && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
                        zIndex: 999, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', padding: 20 }}>
            <div style={{ background: '#ffffff', border: '1px solid #1d6fcf',
                          borderRadius: 14, padding: '22px 24px', maxWidth: 360,
                          width: '100%', boxShadow: '0 16px 48px rgba(0,40,100,0.15)',
                          maxHeight: '85vh', overflowY: 'auto' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f2d5a', marginBottom: 16 }}>
                ✏️ Edit Game {editIdx + 1}{seasonGames[editIdx].label ? ` — ${seasonGames[editIdx].label}` : ''}
              </div>

              {/* POTM */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#4a6b8a',
                              letterSpacing: 1, marginBottom: 6 }}>⭐ PLAYER OF THE MATCH</div>
                <select value={editPotm} onChange={e => setEditPotm(e.target.value)}
                  style={{ width: '100%', background: '#ffffff', border: '1px solid #c7daf7',
                           borderRadius: 8, padding: '8px 12px',
                           color: editPotm ? '#92400e' : '#4a6b8a',
                           fontSize: 12, outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}>
                  <option value="">— None —</option>
                  {seasonGames[editIdx].players.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              {/* Goals */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#4a6b8a',
                              letterSpacing: 1, marginBottom: 6 }}>⚽ GOALS SCORED</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {seasonGames[editIdx].players.map(p => (
                    <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: '#4a6b8a', flex: 1 }}>{p}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button onClick={() => setEditGoals(g => ({ ...g, [p]: Math.max(0, (g[p] || 0) - 1) }))}
                          style={{ width: 28, height: 28, borderRadius: 6, background: '#f5f9ff',
                                   border: '1px solid #c7daf7', color: '#4a6b8a', fontSize: 16,
                                   cursor: 'pointer', lineHeight: 1 }}>−</button>
                        <span style={{ fontSize: 14, fontWeight: 700,
                                       color: (editGoals[p] || 0) > 0 ? '#d97706' : '#7a96b0',
                                       minWidth: 20, textAlign: 'center' }}>
                          {editGoals[p] || 0}
                        </span>
                        <button onClick={() => setEditGoals(g => ({ ...g, [p]: (g[p] || 0) + 1 }))}
                          style={{ width: 28, height: 28, borderRadius: 6, background: '#f5f9ff',
                                   border: '1px solid #c7daf7', color: '#4a6b8a', fontSize: 16,
                                   cursor: 'pointer', lineHeight: 1 }}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Assists */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#4a6b8a',
                              letterSpacing: 1, marginBottom: 6 }}>🅰️ ASSISTS</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {seasonGames[editIdx].players.map(p => (
                    <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: '#4a6b8a', flex: 1 }}>{p}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button onClick={() => setEditAssists(a => ({ ...a, [p]: Math.max(0, (a[p] || 0) - 1) }))}
                          style={{ width: 28, height: 28, borderRadius: 6, background: '#f5f9ff',
                                   border: '1px solid #c7daf7', color: '#4a6b8a', fontSize: 16,
                                   cursor: 'pointer', lineHeight: 1 }}>−</button>
                        <span style={{ fontSize: 14, fontWeight: 700,
                                       color: (editAssists[p] || 0) > 0 ? '#059669' : '#7a96b0',
                                       minWidth: 20, textAlign: 'center' }}>
                          {editAssists[p] || 0}
                        </span>
                        <button onClick={() => setEditAssists(a => ({ ...a, [p]: (a[p] || 0) + 1 }))}
                          style={{ width: 28, height: 28, borderRadius: 6, background: '#f5f9ff',
                                   border: '1px solid #c7daf7', color: '#4a6b8a', fontSize: 16,
                                   cursor: 'pointer', lineHeight: 1 }}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setEditIdx(null)}
                  style={{ flex: 1, padding: 10, background: '#ffffff',
                           border: '1px solid #c7daf7', borderRadius: 8,
                           color: '#4a6b8a', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={() => {
                    const goals = Object.fromEntries(
                      Object.entries(editGoals).filter(([, v]) => v > 0).map(([k, v]) => [k, Number(v)])
                    );
                    const assists = Object.fromEntries(
                      Object.entries(editAssists).filter(([, v]) => v > 0).map(([k, v]) => [k, Number(v)])
                    );
                    onUpdateGame(editIdx, { goals, assists, potm: editPotm || null });
                    setEditIdx(null);
                  }}
                  style={{ flex: 1, padding: 10, background: 'linear-gradient(135deg, #1558b0, #1d6fcf)',
                           border: 'none', borderRadius: 8, color: '#fff',
                           fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: '#0f2d5a' }}>
              📅 Season Tracker
            </h1>
            <p style={{ margin: 0, fontSize: 11, color: '#4a6b8a' }}>
              {seasonGames.length} game{seasonGames.length !== 1 ? 's' : ''} recorded
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={onBack}
              style={{ background: '#ffffff', border: '1px solid #c7daf7', borderRadius: 8,
                       color: '#7a96b0', padding: '7px 14px', cursor: 'pointer',
                       fontSize: 12, fontWeight: 600 }}>
              ← Back
            </button>
            <button onClick={() => setConfirmIdx('all')}
              style={{ background: '#ffffff', border: '1px solid #fca5a5', borderRadius: 8,
                       color: '#f87171', padding: '7px 14px', cursor: 'pointer',
                       fontSize: 12, fontWeight: 600 }}>
              🗑 Clear All
            </button>
            <button onClick={handleExport}
              style={{ background: '#ffffff', border: '1px solid #059669', borderRadius: 8,
                       color: '#059669', padding: '7px 14px', cursor: 'pointer',
                       fontSize: 12, fontWeight: 600 }}>
              📤 Export
            </button>
            <label style={{ background: '#ffffff', border: '1px solid #1d6fcf', borderRadius: 8,
                            color: '#1d6fcf', padding: '7px 14px', cursor: 'pointer',
                            fontSize: 12, fontWeight: 600, display: 'inline-block' }}>
              📥 Import
              <input ref={importRef} type="file" accept=".json"
                     onChange={handleImport} style={{ display: 'none' }} />
            </label>
          </div>
        </div>

        {importMsg && (
          <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10,
                        background: importMsg.type === 'err' ? '#fee2e2' : '#ecfdf5',
                        border: `1px solid ${importMsg.type === 'err' ? '#f87171' : '#059669'}`,
                        color: importMsg.type === 'err' ? '#b91c1c' : '#059669',
                        fontSize: 13, fontWeight: 700, textAlign: 'center' }}>
            {importMsg.msg}
          </div>
        )}

        {/* ── Season Totals table ── */}
        {allPlayers.length > 0 && (
          <div style={{ background: '#ffffff', borderRadius: 12, padding: '16px 18px',
                        border: '1px solid #c7daf7', marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#4a6b8a',
                          letterSpacing: 1, marginBottom: 12 }}>SEASON TOTALS</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Player','Games','Minutes','Bench','GK games','Goals','Assists','POTM'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '4px 8px',
                                           color: '#4a6b8a', fontWeight: 700,
                                           fontSize: 10, letterSpacing: 0.5,
                                           borderBottom: '1px solid #e2ecfc' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allPlayers
                    .sort((a, b) => (totals[b]?.minutes || 0) - (totals[a]?.minutes || 0))
                    .map(p => {
                      const t = totals[p];
                      return (
                        <tr key={p}>
                          <td style={{ padding: '5px 8px', color: '#0f2d5a', fontWeight: 600,
                                       borderBottom: '1px solid #e2ecfc' }}>
                            {p}{t.potm > 0 ? ' ⭐' : ''}
                          </td>
                          <td style={{ padding: '5px 8px', color: '#4a6b8a',
                                       borderBottom: '1px solid #e2ecfc' }}>{t.games}</td>
                          <td style={{ padding: '5px 8px', borderBottom: '1px solid #e2ecfc' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ color: '#0f2d5a', fontWeight: 600 }}>{t.minutes}m</span>
                              <div style={{ flex: 1, height: 4, background: '#e2ecfc', borderRadius: 2, minWidth: 40 }}>
                                <div style={{ height: '100%', borderRadius: 2,
                                              background: '#1d6fcf',
                                              width: `${maxMins > 0 ? (t.minutes / maxMins) * 100 : 0}%`,
                                              transition: 'width 0.5s' }} />
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '5px 8px', color: '#b45309',
                                       borderBottom: '1px solid #e2ecfc' }}>{t.benchSegs}</td>
                          <td style={{ padding: '5px 8px', color: '#7c3aed',
                                       borderBottom: '1px solid #e2ecfc' }}>{t.gkGames}</td>
                          <td style={{ padding: '5px 8px', borderBottom: '1px solid #e2ecfc' }}>
                            {t.goals > 0 ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ color: '#d97706', fontWeight: 700 }}>{t.goals} ⚽</span>
                                <div style={{ flex: 1, height: 4, background: '#fef3c7', borderRadius: 2, minWidth: 30 }}>
                                  <div style={{ height: '100%', borderRadius: 2, background: '#f59e0b',
                                                width: `${maxGoals > 0 ? (t.goals / maxGoals) * 100 : 0}%`,
                                                transition: 'width 0.5s' }} />
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: '#c7daf7' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '5px 8px', borderBottom: '1px solid #e2ecfc' }}>
                            {t.assists > 0 ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ color: '#059669', fontWeight: 700 }}>{t.assists}</span>
                                <div style={{ flex: 1, height: 4, background: '#d1fae5', borderRadius: 2, minWidth: 30 }}>
                                  <div style={{ height: '100%', borderRadius: 2, background: '#059669',
                                                width: `${maxAssists > 0 ? (t.assists / maxAssists) * 100 : 0}%`,
                                                transition: 'width 0.5s' }} />
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: '#c7daf7' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '5px 8px', color: '#d97706',
                                       borderBottom: '1px solid #e2ecfc' }}>
                            {t.potm > 0 ? `⭐ ×${t.potm}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Game list ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {seasonGames.map((game, idx) => {
            const isExpanded = expandedIdx === idx;
            const mins = Object.values(game.stats?.minutesMap || {});
            const minMin = mins.length ? Math.min(...mins) : 0;
            const maxMin = mins.length ? Math.max(...mins) : 0;
            const goalTotal = Object.values(game.goals || {}).reduce((s, n) => s + n, 0);
            const assistTotal = Object.values(game.assists || {}).reduce((s, n) => s + n, 0);

            return (
              <div key={idx} style={{ background: '#ffffff', borderRadius: 12,
                                      border: '1px solid #c7daf7', overflow: 'hidden' }}>
                {/* Game header row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '12px 16px', cursor: 'pointer', gap: 8 }}
                     onClick={() => setExpandedIdx(isExpanded ? null : idx)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8,
                                  background: 'linear-gradient(135deg, #1558b0, #1d6fcf)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                      {idx + 1}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0f2d5a' }}>
                        {game.label || `Game ${idx + 1}`}
                        {game.potm && <span style={{ marginLeft: 6, fontSize: 11, color: '#d97706' }}>⭐ {game.potm}</span>}
                        {goalTotal > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: '#059669' }}>⚽ {goalTotal}</span>}
                        {assistTotal > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: '#059669' }}>🅰️ {assistTotal}</span>}
                      </div>
                      <div style={{ fontSize: 10, color: '#7a96b0', marginTop: 1 }}>
                        {game.date} · {game.players.length} players
                        {minMin === maxMin ? ` · ${minMin} min each` : ` · ${minMin}–${maxMin} min`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button onClick={e => { e.stopPropagation();
                        setEditGoals(game.goals ? { ...game.goals } : {});
                        setEditAssists(game.assists ? { ...game.assists } : {});
                        setEditPotm(game.potm || '');
                        setEditIdx(idx); }}
                      style={{ padding: '5px 10px', background: '#f5f9ff',
                               border: '1px solid #c7daf7', borderRadius: 6,
                               color: '#4a6b8a', fontSize: 11, cursor: 'pointer' }}>
                      ✏️ Edit
                    </button>
                    <button onClick={e => { e.stopPropagation(); setConfirmIdx(idx); }}
                      style={{ padding: '5px 10px', background: '#fff5f5',
                               border: '1px solid #fca5a5', borderRadius: 6,
                               color: '#f87171', fontSize: 11, cursor: 'pointer' }}>
                      🗑
                    </button>
                    <span style={{ fontSize: 12, color: '#c7daf7' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Expanded: player minutes */}
                {isExpanded && (
                  <div style={{ padding: '0 16px 14px', borderTop: '1px solid #e2ecfc' }}>
                    <div style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {game.players.map(p => {
                        const mins = game.stats?.minutesMap?.[p] ?? 0;
                        const sched = game.stats?.playerSchedule?.[p] || [];
                        const positions = [...new Set(sched.filter(s => s && s !== 'BENCH'))];
                        const wasGK = game.segments.some(seg => seg.assignment?.GK === p);
                        return (
                          <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#0f2d5a', minWidth: 70 }}>{p}</span>
                            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', flex: 1 }}>
                              {positions.map(pos => (
                                <span key={pos} style={{
                                  display: 'inline-block', padding: '2px 6px', borderRadius: 4,
                                  fontSize: 9, fontWeight: 700,
                                  background: POS_BG[pos] || '#4a6b8a',
                                  color: POS_TEXT[pos] || '#fff',
                                  border: `1px solid ${POS_BORDER[pos] || 'transparent'}`,
                                }}>
                                  {pos}
                                </span>
                              ))}
                              {sched.some(s => s === 'BENCH') && (
                                <span style={{ display: 'inline-block', padding: '2px 6px',
                                               borderRadius: 4, fontSize: 9, fontWeight: 700,
                                               background: '#fef3c7', color: '#b45309' }}>BENCH</span>
                              )}
                            </div>
                            <span style={{ fontSize: 11, color: '#4a6b8a', flexShrink: 0 }}>{mins}m</span>
                            {(game.goals?.[p] || 0) > 0 && (
                              <span style={{ fontSize: 11, color: '#d97706' }}>⚽{game.goals[p]}</span>
                            )}
                            {(game.assists?.[p] || 0) > 0 && (
                              <span style={{ fontSize: 11, color: '#059669' }}>🅰️{game.assists[p]}</span>
                            )}
                            {game.potm === p && <span style={{ fontSize: 11 }}>⭐</span>}
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

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 10, color: '#c7daf7' }}>
          Ctrl+P to save as PDF for matchday
        </p>
      </div>
    </div>
  );
}
