/**
 * SeasonView — the Season Tracker screen.
 *
 * Session 14: the 11-column table is gone. It could not be read on a phone or
 * in sun, which meant the fairness data — the whole point of the app — was
 * effectively invisible. It is replaced by one sorted list per tab. Nothing was
 * deleted; bench minutes, GK splits, goals, assists, POTM, captain and top
 * positions all moved to the HONOURS / GOALS tabs and the per-match expansion.
 */
import { useState, useRef, useMemo } from 'react';
import { POS_BG, STORAGE_KEY, UI } from '../constants.js';
import useScale from '../useScale.js';

export default function SeasonView({ seasonGames, onBack, onDeleteGame, onClearAll, onUpdateGame, onGoSetup }) {
  const { s } = useScale();

  const [tab, setTab]                   = useState('fairness');
  const [confirmIdx, setConfirmIdx]     = useState(null);
  const [editIdx, setEditIdx]           = useState(null);
  const [expandedIdx, setExpandedIdx]   = useState(null);
  const [editGoals, setEditGoals]       = useState({});
  const [editAssists, setEditAssists]   = useState({});
  const [editPotm, setEditPotm]         = useState('');
  const [editCaptain, setEditCaptain]   = useState('');
  const [editOurScore, setEditOurScore] = useState('');
  const [editOppScore, setEditOppScore] = useState('');
  const [editNotes, setEditNotes]       = useState('');
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
  const { allPlayers, totals, record, goalsFor, goalsAgainst } = useMemo(() => {
    const names  = [...new Set(seasonGames.flatMap(g => g.players))];
    const tot    = Object.fromEntries(names.map(p => [p, {
      minutes: 0, benchMins: 0, gkH1: 0, gkH2: 0, games: 0, goals: 0, assists: 0, potm: 0,
      captainGames: 0, posCount: {},
    }]));

    seasonGames.forEach(game => {
      const { minutesMap, playerSchedule } = game.stats || {};

      // Per-game GK by half (Sets avoid double-counting multi-seg halves)
      const gkH1Set = new Set(
        (game.segments || []).filter(sg => sg.half === 1).map(sg => sg.assignment?.GK).filter(Boolean)
      );
      const gkH2Set = new Set(
        (game.segments || []).filter(sg => sg.half === 2).map(sg => sg.assignment?.GK).filter(Boolean)
      );

      game.players.forEach(p => {
        if (!tot[p]) return;
        if (minutesMap?.[p] != null) {
          tot[p].minutes += minutesMap[p];
          tot[p].games   += 1;
          if (gkH1Set.has(p)) tot[p].gkH1++;
          if (gkH2Set.has(p)) tot[p].gkH2++;
          // Bench minutes: sum duration of every segment where this player is benched
          (game.segments || []).forEach(sg => {
            if (sg.bench?.includes(p)) tot[p].benchMins += (sg.duration || 0);
          });
          new Set((playerSchedule?.[p] || []).filter(x => x && x !== 'BENCH')).forEach(pos => {
            tot[p].posCount[pos] = (tot[p].posCount[pos] || 0) + 1;
          });
        }
      });
      if (game.goals)   Object.entries(game.goals).forEach(([p, n]) => { if (tot[p]) tot[p].goals += n; });
      if (game.assists) Object.entries(game.assists).forEach(([p, n]) => { if (tot[p]) tot[p].assists += n; });
      if (game.potm    && tot[game.potm])    tot[game.potm].potm++;
      if (game.captain && tot[game.captain]) tot[game.captain].captainGames++;
    });

    const rec = seasonGames.reduce((acc, g) => {
      if (g.result === 'W') acc.w++;
      else if (g.result === 'D') acc.d++;
      else if (g.result === 'L') acc.l++;
      return acc;
    }, { w: 0, d: 0, l: 0 });

    const gf = seasonGames.reduce((n, g) => n + (g.ourScore ?? 0), 0);
    const ga = seasonGames.reduce((n, g) => n + (g.oppositionScore ?? 0), 0);

    return { allPlayers: names, totals: tot, record: rec, goalsFor: gf, goalsAgainst: ga };
  }, [seasonGames]);

  const avgOf = (p) => (totals[p]?.games > 0 ? totals[p].minutes / totals[p].games : 0);

  // Fairness list — descending by average minutes, so the player who has been
  // shortchanged sits at the bottom and is flagged.
  const fairness = useMemo(() => {
    const rows = allPlayers
      .map(p => ({ name: p, avg: Math.round(avgOf(p)), t: totals[p] }))
      .sort((a, b) => b.avg - a.avg);
    return rows;
  }, [allPlayers, totals]);

  const maxAvg = fairness.length ? Math.max(...fairness.map(r => r.avg), 1) : 1;
  const lowAvg = fairness.length ? fairness[fairness.length - 1].avg : 0;
  const targetAvg = fairness.length
    ? Math.round(fairness.reduce((n, r) => n + r.avg, 0) / fairness.length)
    : 0;

  // The three players furthest behind on minutes. Deliberately worded as a
  // statement of fact, not a promise about what buildSchedule will do — the
  // generator shuffles positions and the coach can override any of it.
  const behind = useMemo(
    () => [...fairness].reverse().slice(0, 3).map(r => r.name),
    [fairness]
  );

  // Most-played position, for the wristband swatch on each row.
  const topPos = (p) => {
    const counts = totals[p]?.posCount || {};
    const entry = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return entry ? entry[0] : null;
  };

  // ── Shared styles ─────────────────────────────────────────────────────────
  const sectionLabel = {
    fontSize: Math.max(13, s(18)), fontWeight: 900, letterSpacing: s(2),
    color: UI.label, textTransform: 'uppercase',
  };
  const card = {
    background: '#fff', border: `2px solid ${UI.blueLine}`, borderRadius: s(12),
  };
  const btnOnNavy = {
    border: `2px solid ${UI.onNavyBorder}`, borderRadius: s(10),
    padding: `${s(12)}px ${s(22)}px`, fontSize: Math.max(15, s(20)),
    fontWeight: 800, color: '#fff', background: 'transparent',
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  };
  const btnGhost = {
    padding: s(16), borderRadius: s(12), background: '#fff',
    border: `3px solid ${UI.blueLine}`, color: UI.bodyText,
    fontSize: Math.max(15, s(20)), fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
  };
  const btnSolid = (bg) => ({
    padding: s(16), borderRadius: s(12), background: bg, border: 'none',
    color: '#fff', fontSize: Math.max(15, s(20)), fontWeight: 900,
    cursor: 'pointer', fontFamily: 'inherit',
  });
  const inputStyle = {
    width: '100%', padding: s(14), borderRadius: s(12),
    border: `3px solid ${UI.blueLine}`, fontSize: Math.max(16, s(22)),
    fontWeight: 700, color: UI.navy, background: '#fff',
    boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
  };
  const modalBackdrop = {
    position: 'fixed', inset: 0, background: UI.backdrop, zIndex: 999,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: s(24), boxSizing: 'border-box',
  };
  const modalCard = {
    background: '#fff', borderRadius: s(24), padding: s(30), maxWidth: s(560),
    width: '100%', maxHeight: '88vh', overflowY: 'auto', boxSizing: 'border-box',
  };

  const swatch = (pos) => ({
    width: s(14), height: s(34), borderRadius: s(4), flexShrink: 0,
    background: POS_BG[pos] || UI.track,
    boxShadow: (POS_BG[pos] || '').toLowerCase() === '#ffffff'
      ? `inset 0 0 0 2px ${UI.blueLine}` : 'none',
  });

  // ── Empty state ───────────────────────────────────────────────────────────
  if (seasonGames.length === 0) return (
    <div style={{
      padding: s(40), textAlign: 'center', color: UI.bodyText, minHeight: '100vh',
      background: UI.page, fontFamily: 'system-ui, "Segoe UI", sans-serif',
    }}>
      <div style={{ fontSize: s(48), marginBottom: s(12) }}>📅</div>
      <div style={{ fontSize: Math.max(22, s(34)), fontWeight: 800, color: UI.navy, marginBottom: s(8) }}>
        No games recorded yet
      </div>
      <div style={{ fontSize: Math.max(15, s(20)), color: UI.bodyText, fontWeight: 700 }}>
        Play a game and hit SAVE to build your season.
      </div>
      <button onClick={onBack} style={{ ...btnSolid(UI.navy), marginTop: s(24), padding: `${s(16)}px ${s(32)}px` }}>
        ← Back to Match Setup
      </button>
    </div>
  );

  const tabs = [
    { key: 'fairness', label: 'FAIRNESS' },
    { key: 'matches',  label: 'MATCHES' },
    { key: 'honours',  label: 'HONOURS' },
    { key: 'goals',    label: 'GOALS' },
  ];

  return (
    <div style={{
      minHeight: '100vh', background: UI.page, color: UI.navy,
      fontFamily: 'system-ui, "Segoe UI", sans-serif',
      fontVariantNumeric: 'tabular-nums',
      display: 'flex', flexDirection: 'column',
    }}>

      {/* ══ Header ══ */}
      <header style={{ background: UI.navy, padding: `${s(22)}px ${s(26)}px ${s(20)}px`, flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: s(12), flexWrap: 'wrap' }}>
          <button onClick={onBack} style={btnOnNavy}>← Back to game</button>
          <div style={{ display: 'flex', gap: s(10) }}>
            <button onClick={handleExport} style={btnOnNavy}>📤 Export</button>
            <label style={{ ...btnOnNavy, display: 'inline-block' }}>
              📥 Import
              <input ref={importRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
            </label>
          </div>
        </div>

        <h1 style={{
          margin: `${s(14)}px 0 ${s(8)}px`, fontSize: Math.max(30, s(46)), fontWeight: 800,
          color: '#fff', letterSpacing: -1,
        }}>
          Season {new Date().getFullYear()}
        </h1>
        <div style={{ display: 'flex', gap: s(20), alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: Math.max(16, s(24)), fontWeight: 700, color: UI.onNavyMuted }}>
            {seasonGames.length} game{seasonGames.length !== 1 ? 's' : ''}
          </span>
          <span style={{ fontSize: Math.max(16, s(24)), fontWeight: 800, color: '#fff' }}>
            {record.w} W · {record.d} D · {record.l} L
          </span>
          <span style={{ fontSize: Math.max(16, s(24)), fontWeight: 700, color: UI.onNavyMuted }}>
            {goalsFor} goals for · {goalsAgainst} against
          </span>
        </div>
      </header>

      {/* ══ Tabs ══ */}
      <div style={{
        background: '#fff', padding: `${s(14)}px ${s(20)}px`,
        borderBottom: `2px solid ${UI.blueLine}`, flexShrink: 0,
        display: 'flex', gap: s(10), overflowX: 'auto',
      }}>
        {tabs.map(t => {
          const on = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              background: on ? UI.navy : '#fff',
              border: on ? '2px solid transparent' : `2px solid ${UI.blueLine}`,
              color: on ? '#fff' : UI.bodyText,
              fontWeight: on ? 900 : 800,
              borderRadius: s(10), padding: `${s(14)}px ${s(28)}px`,
              fontSize: Math.max(16, s(22)), cursor: 'pointer',
              fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {importMsg && (
        <div style={{
          margin: `${s(14)}px ${s(20)}px 0`, padding: `${s(14)}px ${s(18)}px`, borderRadius: s(12),
          background: importMsg.type === 'err' ? '#fdecec' : UI.goTint,
          border: `2px solid ${importMsg.type === 'err' ? UI.stop : UI.go}`,
          color: importMsg.type === 'err' ? UI.stop : UI.go,
          fontSize: Math.max(14, s(19)), fontWeight: 800, textAlign: 'center', flexShrink: 0,
        }}>
          {importMsg.msg}
        </div>
      )}

      {/* ══ Body ══ */}
      <div style={{ flex: 1, minHeight: 0, padding: `${s(20)}px ${s(20)}px ${s(8)}px`, overflowY: 'auto' }}>

        {/* ── FAIRNESS ── */}
        {tab === 'fairness' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: s(12), gap: s(12), flexWrap: 'wrap' }}>
              <span style={sectionLabel}>Average minutes per game</span>
              <span style={{ fontSize: Math.max(14, s(18)), fontWeight: 800, color: UI.bodyText }}>
                Spread {lowAvg}–{maxAvg}m · target {targetAvg}m
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: s(9) }}>
              {fairness.map((row, i) => {
                const isLowest = i === fairness.length - 1 && fairness.length > 1;
                return (
                  <div key={row.name} style={{
                    ...card,
                    border: isLowest ? `4px solid ${UI.stop}` : `2px solid ${UI.blueLine}`,
                    padding: `${s(9)}px ${s(16)}px`,
                    display: 'flex', alignItems: 'center', gap: s(16),
                  }}>
                    <div style={swatch(topPos(row.name))} />
                    <div style={{ width: s(150), flexShrink: 0, fontSize: Math.max(18, s(27)), fontWeight: 800, color: UI.navy }}>
                      {row.name}
                    </div>
                    <div style={{ flex: 1, height: s(26), background: UI.track, borderRadius: s(5), minWidth: s(40) }}>
                      <div style={{
                        height: '100%', borderRadius: s(5),
                        background: isLowest ? UI.stop : UI.navy,
                        width: `${maxAvg > 0 ? (row.avg / maxAvg) * 100 : 0}%`,
                      }} />
                    </div>
                    <div style={{
                      width: s(74), flexShrink: 0, textAlign: 'right',
                      fontSize: Math.max(17, s(25)), fontWeight: 800,
                      color: isLowest ? UI.stop : UI.navy,
                    }}>
                      {row.avg}m
                    </div>
                    <div style={{
                      width: s(134), flexShrink: 0, textAlign: 'right', whiteSpace: 'nowrap',
                      fontSize: Math.max(13, s(17)), fontWeight: 700,
                      color: isLowest ? UI.stop : UI.label,
                    }}>
                      {isLowest ? 'lowest · ' : ''}{row.t.games} game{row.t.games !== 1 ? 's' : ''}
                      {row.t.gkH1 + row.t.gkH2 > 0 ? ` · GK ×${row.t.gkH1 + row.t.gkH2}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── HONOURS ── */}
        {tab === 'honours' && (
          <>
            <div style={{ ...sectionLabel, marginBottom: s(12) }}>Player of the week · captain · bench · goalkeeper</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: s(9) }}>
              {[...allPlayers].sort((a, b) => {
                const at = totals[a].potm + totals[a].captainGames;
                const bt = totals[b].potm + totals[b].captainGames;
                if (at !== bt) return bt - at;
                return a.localeCompare(b);
              }).map(p => {
                const t = totals[p];
                const dim = '#a8c0d8';
                return (
                  <div key={p} style={{
                    ...card, padding: `${s(14)}px ${s(16)}px`,
                    display: 'flex', alignItems: 'center', gap: s(16), flexWrap: 'wrap',
                  }}>
                    <div style={swatch(topPos(p))} />
                    <div style={{ width: s(150), flexShrink: 0, fontSize: Math.max(18, s(27)), fontWeight: 800, color: UI.navy }}>
                      {p}
                    </div>
                    <div style={{
                      display: 'flex', gap: s(20), marginLeft: 'auto', flexWrap: 'wrap',
                      fontSize: Math.max(14, s(20)), fontWeight: 800, color: UI.bodyText, whiteSpace: 'nowrap',
                    }}>
                      <span style={{ color: t.potm ? UI.bodyText : dim }}>⭐ {t.potm || '—'}</span>
                      <span style={{ color: t.captainGames ? UI.bodyText : dim }}>🏅 {t.captainGames || '—'}</span>
                      <span style={{ color: t.gkH1 || t.gkH2 ? UI.bodyText : dim }}>🧤 H1 {t.gkH1 || '—'} · H2 {t.gkH2 || '—'}</span>
                      <span style={{ color: t.benchMins ? UI.bodyText : dim }}>🪑 {t.benchMins ? `${t.benchMins}m` : '—'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── GOALS ── */}
        {tab === 'goals' && (() => {
          const maxG = Math.max(1, ...allPlayers.map(p => totals[p].goals));
          const sorted = [...allPlayers].sort((a, b) => {
            if (totals[b].goals !== totals[a].goals) return totals[b].goals - totals[a].goals;
            if (totals[b].assists !== totals[a].assists) return totals[b].assists - totals[a].assists;
            return a.localeCompare(b);
          });
          return (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: s(12), gap: s(12), flexWrap: 'wrap' }}>
                <span style={sectionLabel}>Goals and assists</span>
                <span style={{ fontSize: Math.max(14, s(18)), fontWeight: 800, color: UI.bodyText }}>
                  {allPlayers.reduce((n, p) => n + totals[p].goals, 0)} goals · {allPlayers.reduce((n, p) => n + totals[p].assists, 0)} assists
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: s(9) }}>
                {sorted.map(p => {
                  const t = totals[p];
                  return (
                    <div key={p} style={{ ...card, padding: `${s(9)}px ${s(16)}px`, display: 'flex', alignItems: 'center', gap: s(16) }}>
                      <div style={swatch(topPos(p))} />
                      <div style={{ width: s(150), flexShrink: 0, fontSize: Math.max(18, s(27)), fontWeight: 800, color: UI.navy }}>
                        {p}
                      </div>
                      <div style={{ flex: 1, height: s(26), background: UI.track, borderRadius: s(5), minWidth: s(40) }}>
                        <div style={{ height: '100%', borderRadius: s(5), background: UI.navy, width: `${(t.goals / maxG) * 100}%` }} />
                      </div>
                      <div style={{ width: s(74), flexShrink: 0, textAlign: 'right', fontSize: Math.max(17, s(25)), fontWeight: 800, color: UI.navy }}>
                        {t.goals ? `${t.goals}⚽` : '—'}
                      </div>
                      <div style={{ width: s(134), flexShrink: 0, textAlign: 'right', whiteSpace: 'nowrap', fontSize: Math.max(13, s(17)), fontWeight: 700, color: UI.label }}>
                        {t.assists ? `${t.assists} assist${t.assists !== 1 ? 's' : ''}` : 'no assists'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}

        {/* ── MATCHES ── */}
        {tab === 'matches' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: s(12) }}>
            {seasonGames.map((game, idx) => {
              const isExpanded = expandedIdx === idx;
              const mins = Object.values(game.stats?.minutesMap || {});
              const minMin = mins.length ? Math.min(...mins) : 0;
              const maxMin = mins.length ? Math.max(...mins) : 0;
              const goalTotal = Object.values(game.goals || {}).reduce((n, x) => n + x, 0);
              const assistTotal = Object.values(game.assists || {}).reduce((n, x) => n + x, 0);
              const resultColour = game.result === 'W' ? UI.go : game.result === 'L' ? UI.stop : UI.label;

              return (
                <div key={game.id || idx} style={{ ...card, overflow: 'hidden' }}>
                  <div
                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: `${s(14)}px ${s(18)}px`, cursor: 'pointer', gap: s(12), flexWrap: 'wrap',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: s(14), minWidth: 0 }}>
                      {game.result && (
                        <div style={{
                          width: s(44), height: s(44), borderRadius: s(10), flexShrink: 0,
                          background: resultColour, color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: Math.max(16, s(22)), fontWeight: 900,
                        }}>{game.result}</div>
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: Math.max(18, s(27)), fontWeight: 800, color: UI.navy }}>
                          {game.label || `Match ${idx + 1}`}
                          {game.ourScore != null && game.oppositionScore != null && (
                            <span style={{ color: UI.bodyText, fontWeight: 700 }}> · {game.ourScore}–{game.oppositionScore}</span>
                          )}
                        </div>
                        <div style={{ fontSize: Math.max(13, s(18)), color: UI.label, fontWeight: 700, marginTop: s(2) }}>
                          {game.date} · {game.players.length} players · {minMin === maxMin ? `all ${minMin}m` : `spread ${minMin}–${maxMin}m`}
                          {game.potm ? ` · ⭐ ${game.potm}` : ''}
                          {game.captain ? ` · 🏅 ${game.captain}` : ''}
                          {goalTotal > 0 ? ` · ⚽ ${goalTotal}` : ''}
                          {assistTotal > 0 ? ` · 👟 ${assistTotal}` : ''}
                          {game.notes ? ' · 📝' : ''}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: s(10), alignItems: 'center', flexShrink: 0 }}>
                      <button onClick={e => {
                        e.stopPropagation();
                        setEditGoals(game.goals ? { ...game.goals } : {});
                        setEditAssists(game.assists ? { ...game.assists } : {});
                        setEditPotm(game.potm || '');
                        setEditCaptain(game.captain || '');
                        setEditOurScore(game.ourScore != null ? String(game.ourScore) : '');
                        setEditOppScore(game.oppositionScore != null ? String(game.oppositionScore) : '');
                        setEditNotes(game.notes || '');
                        setEditIdx(idx);
                      }} style={{ ...btnGhost, padding: `${s(10)}px ${s(18)}px` }}>✏️ Edit</button>
                      <button onClick={e => { e.stopPropagation(); setConfirmIdx(idx); }}
                        style={{ ...btnGhost, padding: `${s(10)}px ${s(18)}px`, borderColor: UI.stop, color: UI.stop }}>🗑</button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: `${s(16)}px ${s(18)}px`, borderTop: `2px solid ${UI.blueLine}` }}>
                      {game.notes && (
                        <div style={{
                          marginBottom: s(16), padding: `${s(14)}px ${s(16)}px`, borderRadius: s(12),
                          background: UI.page, border: `2px solid ${UI.blueLine}`,
                        }}>
                          <div style={{ ...sectionLabel, marginBottom: s(6) }}>📝 Match notes</div>
                          <div style={{ fontSize: Math.max(14, s(19)), fontWeight: 700, color: UI.navy, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                            {game.notes}
                          </div>
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${s(280)}px, 1fr))`, gap: s(10) }}>
                        {game.players.map(p => {
                          const pm = game.stats?.minutesMap?.[p] ?? 0;
                          const sched = game.stats?.playerSchedule?.[p] || [];
                          const positions = [...new Set(sched.filter(x => x && x !== 'BENCH'))];
                          return (
                            <div key={p} style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: s(12), background: UI.page, borderRadius: s(10),
                              border: `2px solid ${UI.blueLine}`, gap: s(10),
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: s(10), minWidth: 0 }}>
                                <span style={{ fontSize: Math.max(14, s(19)), fontWeight: 800, color: UI.navy }}>
                                  {p}{game.potm === p ? ' ⭐' : ''}
                                </span>
                                <div style={{ display: 'flex', gap: s(4) }}>
                                  {positions.map(pos => (
                                    <span key={pos} style={{
                                      padding: `${s(2)}px ${s(6)}px`, borderRadius: s(6),
                                      fontSize: Math.max(11, s(14)), fontWeight: 800,
                                      background: POS_BG[pos] || UI.track, color: '#111827',
                                      border: `1px solid ${UI.navy}`,
                                    }}>{pos}</span>
                                  ))}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: s(10), fontWeight: 800, fontSize: Math.max(13, s(18)), whiteSpace: 'nowrap' }}>
                                <span style={{ color: UI.bodyText }}>{pm}m</span>
                                {(game.goals?.[p] || 0) > 0 && <span style={{ color: UI.navy }}>⚽ {game.goals[p]}</span>}
                                {(game.assists?.[p] || 0) > 0 && <span style={{ color: UI.navy }}>👟 {game.assists[p]}</span>}
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

            {/* Reset season lives here, not in the header — it used to sit one
                tap away from a destructive wipe of the whole season. */}
            <button onClick={() => setConfirmIdx('all')} style={{
              ...btnGhost, borderColor: UI.stop, color: UI.stop, marginTop: s(10),
            }}>
              🗑 Reset the whole season
            </button>
          </div>
        )}
      </div>

      {/* ══ Footer — sibling of the body so it never gets clipped ══ */}
      {tab === 'fairness' && behind.length > 0 && (
        <div style={{
          ...card, flexShrink: 0, margin: `0 ${s(20)}px ${s(18)}px`,
          padding: `${s(14)}px ${s(18)}px`, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: s(16), flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: Math.max(15, s(20)), fontWeight: 700, color: UI.bodyText }}>
            {behind.join(', ')} {behind.length > 1 ? 'are' : 'is'} furthest behind on minutes — the planner will favour {behind.length > 1 ? 'them' : 'them'} next game.
          </span>
          {onGoSetup && (
            <button onClick={onGoSetup} style={{ ...btnSolid(UI.navy), padding: `${s(14)}px ${s(24)}px`, whiteSpace: 'nowrap' }}>
              NEW MATCH →
            </button>
          )}
        </div>
      )}

      {/* ── Edit game modal ── */}
      {editIdx !== null && seasonGames[editIdx] && (
        <div style={modalBackdrop}>
          <div style={modalCard}>
            <h2 style={{ fontSize: Math.max(22, s(34)), fontWeight: 800, color: UI.navy, marginTop: 0, marginBottom: s(24) }}>
              ✏️ Edit {seasonGames[editIdx].label || `Match ${editIdx + 1}`}
            </h2>

            <div style={{ marginBottom: s(20) }}>
              <label style={{ ...sectionLabel, display: 'block', marginBottom: s(8) }}>⭐ Player of the match</label>
              <select value={editPotm} onChange={e => setEditPotm(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">— None —</option>
                {seasonGames[editIdx].players.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: s(20) }}>
              <label style={{ ...sectionLabel, display: 'block', marginBottom: s(8) }}>🏅 Captain</label>
              <select value={editCaptain} onChange={e => setEditCaptain(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">— None —</option>
                {seasonGames[editIdx].players.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: s(24) }}>
              <label style={{ ...sectionLabel, display: 'block', marginBottom: s(10) }}>Score</label>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: s(14) }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: Math.max(12, s(16)), fontWeight: 800, color: UI.label, marginBottom: s(6), textAlign: 'center' }}>US</div>
                  <input type="number" min="0" value={editOurScore} onChange={e => setEditOurScore(e.target.value)} placeholder="–"
                    style={{ ...inputStyle, border: `4px solid ${UI.navy}`, fontSize: Math.max(26, s(40)), fontWeight: 800, textAlign: 'center' }} />
                </div>
                <div style={{ fontSize: Math.max(20, s(30)), fontWeight: 800, color: UI.label, paddingBottom: s(14) }}>–</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: Math.max(12, s(16)), fontWeight: 800, color: UI.label, marginBottom: s(6), textAlign: 'center' }}>THEM</div>
                  <input type="number" min="0" value={editOppScore} onChange={e => setEditOppScore(e.target.value)} placeholder="–"
                    style={{ ...inputStyle, fontSize: Math.max(26, s(40)), fontWeight: 800, textAlign: 'center' }} />
                </div>
              </div>
            </div>

            <div style={{ marginBottom: s(28) }}>
              <label style={{ ...sectionLabel, display: 'block', marginBottom: s(12) }}>⚽ Goals &amp; 👟 assists</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: s(10) }}>
                {seasonGames[editIdx].players.map(p => (
                  <div key={p} style={{
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
                    padding: s(12), background: UI.page, borderRadius: s(12),
                    border: `2px solid ${UI.blueLine}`, gap: s(12),
                  }}>
                    <span style={{ fontSize: Math.max(16, s(22)), fontWeight: 800, color: UI.navy, flex: '1 1 auto', minWidth: s(80) }}>{p}</span>
                    <div style={{ display: 'flex', gap: s(16), flexWrap: 'wrap' }}>
                      {[
                        { icon: '⚽', get: editGoals, set: setEditGoals },
                        { icon: '👟', get: editAssists, set: setEditAssists },
                      ].map(({ icon, get, set }) => (
                        <div key={icon} style={{ display: 'flex', alignItems: 'center', gap: s(8) }}>
                          <span style={{ fontSize: Math.max(13, s(17)) }}>{icon}</span>
                          <button onClick={() => set(g => ({ ...g, [p]: Math.max(0, (g[p] || 0) - 1) }))}
                            style={{ width: s(44), height: s(44), borderRadius: s(10), background: '#fff', border: `3px solid ${UI.blueLine}`, color: UI.bodyText, fontSize: Math.max(18, s(24)), fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>−</button>
                          <span style={{ fontSize: Math.max(16, s(22)), fontWeight: 800, color: (get[p] || 0) > 0 ? UI.navy : '#a8c0d8', width: s(24), textAlign: 'center' }}>{get[p] || 0}</span>
                          <button onClick={() => set(g => ({ ...g, [p]: (g[p] || 0) + 1 }))}
                            style={{ width: s(44), height: s(44), borderRadius: s(10), background: UI.navy, border: 'none', color: '#fff', fontSize: Math.max(18, s(24)), fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>+</button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: s(24) }}>
              <label style={{ ...sectionLabel, display: 'block', marginBottom: s(8) }}>📝 Match notes</label>
              <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)}
                placeholder="Tactics, HT talk, training focus..."
                style={{ ...inputStyle, minHeight: s(100), resize: 'vertical', lineHeight: 1.5 }} />
            </div>

            <div style={{ display: 'flex', gap: s(12) }}>
              <button onClick={() => setEditIdx(null)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
              <button onClick={() => {
                const goals = Object.fromEntries(Object.entries(editGoals).filter(([, v]) => v > 0).map(([k, v]) => [k, Number(v)]));
                const assists = Object.fromEntries(Object.entries(editAssists).filter(([, v]) => v > 0).map(([k, v]) => [k, Number(v)]));
                const ourSc = editOurScore !== '' ? Number(editOurScore) : null;
                const oppSc = editOppScore !== '' ? Number(editOppScore) : null;
                const result = (ourSc != null && oppSc != null) ? (ourSc > oppSc ? 'W' : ourSc < oppSc ? 'L' : 'D') : null;
                onUpdateGame(editIdx, { goals, assists, potm: editPotm || null, captain: editCaptain || null, ourScore: ourSc, oppositionScore: oppSc, result, notes: editNotes });
                setEditIdx(null);
              }} style={{ ...btnSolid(UI.go), flex: 2 }}>
                💾 Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm delete ── */}
      {confirmIdx !== null && (
        <div style={modalBackdrop}>
          <div style={{ ...modalCard, maxWidth: s(440), textAlign: 'center' }}>
            <div style={{ fontSize: s(48), marginBottom: s(16) }}>🗑️</div>
            <h2 style={{ fontSize: Math.max(20, s(30)), fontWeight: 800, color: UI.navy, marginTop: 0, marginBottom: s(12) }}>
              {confirmIdx === 'all'
                ? 'Reset the entire season?'
                : `Delete ${seasonGames[confirmIdx]?.label || `match ${confirmIdx + 1}`}?`}
            </h2>
            <p style={{ fontSize: Math.max(15, s(20)), color: UI.bodyText, fontWeight: 700, marginBottom: s(28) }}>
              This cannot be undone.{confirmIdx === 'all' ? ' Export a backup first if you are not certain.' : ''}
            </p>
            <div style={{ display: 'flex', gap: s(12) }}>
              <button onClick={() => setConfirmIdx(null)} style={{ ...btnGhost, flex: 1 }}>Cancel</button>
              <button onClick={() => {
                if (confirmIdx === 'all') onClearAll();
                else {
                  if (expandedIdx === confirmIdx) setExpandedIdx(null);
                  else if (expandedIdx > confirmIdx) setExpandedIdx(expandedIdx - 1);
                  onDeleteGame(confirmIdx);
                }
                setConfirmIdx(null);
              }} style={{ ...btnSolid(UI.stop), flex: 1 }}>
                {confirmIdx === 'all' ? 'Reset all' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
