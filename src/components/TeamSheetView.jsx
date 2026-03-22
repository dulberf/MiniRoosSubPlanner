/**
 * TeamSheetView — the main result screen.
 * Tabs: Field · Schedule · Stats
 */
import { useState, useMemo } from 'react';
import FieldView from './FieldView.jsx';
import { calcStats } from '../scheduler.js';
import { POSITIONS, POS_BG, POS_TEXT, POS_BORDER } from '../constants.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStartMin(segments, idx) {
  let t = 0;
  for (let i = 0; i < idx; i++) t += segments[i].duration;
  return t;
}

function getSubChanges(prev, curr) {
  const changes = [];
  const prevBenchSet = new Set(prev.bench);
  const currBenchSet = new Set(curr.bench);

  const comingOn = [...new Set(Object.values(curr.assignment).filter(Boolean))]
    .filter(p => prevBenchSet.has(p));
  const goingOff = [...new Set(Object.values(prev.assignment).filter(Boolean))]
    .filter(p => currBenchSet.has(p));

  comingOn.forEach(onPlayer => {
    const pos = Object.entries(curr.assignment).find(([, n]) => n === onPlayer)?.[0];
    const offPlayer = prev.assignment[pos];
    if (pos) changes.push({ type: 'sub', on: onPlayer, off: offPlayer || null, pos });
  });

  if (prev.gkName !== curr.gkName &&
      !changes.some(c => c.on === curr.gkName || c.off === prev.gkName)) {
    changes.push({ type: 'gk', on: curr.gkName, off: prev.gkName });
  }

  Object.entries(curr.assignment).forEach(([pos, name]) => {
    if (name && !comingOn.includes(name) && prev.assignment[pos] !== name) {
      const prevPos = Object.entries(prev.assignment).find(([, n]) => n === name)?.[0];
      if (prevPos && prevPos !== pos) {
        changes.push({ type: 'poschange', player: name, from: prevPos, to: pos });
      }
    }
  });

  return changes;
}

function PosBadge({ pos }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 5px', borderRadius: 4,
      fontSize: 9, fontWeight: 800,
      background: POS_BG[pos] || '#64748b',
      color: POS_TEXT[pos] || '#fff',
      border: `1px solid ${POS_BORDER[pos] || 'transparent'}`,
      verticalAlign: 'middle',
    }}>{pos}</span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TeamSheetView({
  players, segments, lockGK,
  seasonGames, onSwap,
  onSave, onReorder, onGoSeason, onGoSetup,
  isSaved, toast,
}) {
  const [tab,        setTab]        = useState('field');
  const [currentSeg, setCurrentSeg] = useState(0);
  const [editMode,   setEditMode]   = useState(false);
  const [swapFrom,   setSwapFrom]   = useState(null); // { type, pos?, name } | null
  const [highlight,  setHighlight]  = useState(null); // player name
  const [saveOpen,   setSaveOpen]   = useState(false);
  const [matchLabel, setMatchLabel] = useState('');
  const [goals,      setGoals]      = useState({});
  const [potm,       setPotm]       = useState('');

  const seg       = segments[currentSeg];
  const benchSize = players.length - 9;
  const hasEdits  = segments.some(s => s.edited);

  const { minutesMap, gkDutyMap, playerSchedule } = useMemo(
    () => calcStats(segments, players),
    [segments, players]
  );

  const minMins = Math.min(...Object.values(minutesMap));
  const maxMins = Math.max(...Object.values(minutesMap));

  // Bench count per player (from playerSchedule)
  const benchCountMap = useMemo(() => {
    const m = {};
    players.forEach(p => {
      m[p] = (playerSchedule[p] || []).filter(s => s === 'BENCH').length;
    });
    return m;
  }, [players, playerSchedule]);

  // ── Navigation ─────────────────────────────────────────────────────────────
  const goToSeg = (i) => {
    setCurrentSeg(i);
    setSwapFrom(null);
    // keep editMode, just clear selection
  };

  const toggleEdit = () => {
    setEditMode(m => !m);
    setSwapFrom(null);
    setHighlight(null);
  };

  // ── Click handler (shared by left panel & field) ───────────────────────────
  const handleClick = ({ type, pos, name }) => {
    if (!editMode) {
      // View mode: toggle highlight
      setHighlight(h => (h === name ? null : name));
      return;
    }

    // Edit mode — swap logic
    const locked = type === 'pos' && pos === 'GK' && lockGK;
    if (locked) return;

    if (!swapFrom) {
      setSwapFrom({ type, pos, name });
      return;
    }

    // Cancel if same item tapped again
    const isSame =
      (type === 'pos'   && swapFrom.type === 'pos'   && swapFrom.pos  === pos)  ||
      (type === 'bench' && swapFrom.type === 'bench' && swapFrom.name === name);
    if (isSame) { setSwapFrom(null); return; }

    // Block locked GK as target
    if (type === 'pos' && pos === 'GK' && lockGK) { setSwapFrom(null); return; }

    onSwap(currentSeg, { from: swapFrom, to: { type, pos, name } });
    setSwapFrom(null);
  };

  const handleFieldClick = (name, pos) => handleClick({ type: 'pos', pos, name });

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = () => {
    onSave({ label: matchLabel, goals, potm });
    setSaveOpen(false);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Left panel — position list + bench + journey */
  function renderLeftPanel() {
    const { assignment, bench } = seg;

    return (
      <div style={{ width: 162, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>

        {/* Edit mode banner */}
        {editMode && (
          <div style={{
            padding: '6px 8px', background: '#ddeeff', borderRadius: 8,
            border: '1px solid #1d6fcf', marginBottom: 2,
            fontSize: 10, fontWeight: 700, color: '#1558b0', lineHeight: 1.4,
          }}>
            ✏️ Editing {seg.label}
            <div style={{ fontWeight: 400, color: '#4a6b8a', marginTop: 1, fontSize: 9 }}>
              Changes only affect this period
            </div>
          </div>
        )}

        {/* Swap status bar */}
        {editMode && swapFrom && (
          <div style={{
            padding: '5px 8px', background: '#1558b0', borderRadius: 8,
            fontSize: 10, fontWeight: 700, color: '#fff',
            display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2,
          }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {swapFrom.type === 'pos' ? `${swapFrom.pos}: ` : '🪑 '}
              {swapFrom.name}
              <span style={{ fontWeight: 400, opacity: 0.8 }}> — tap to swap</span>
            </span>
            <button
              onClick={() => setSwapFrom(null)}
              style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 13, padding: 0, flexShrink: 0 }}
            >✕</button>
          </div>
        )}

        {/* Positions */}
        {POSITIONS.map(pos => {
          const name   = assignment[pos];
          const locked = pos === 'GK' && lockGK;
          const isSel  = editMode && swapFrom?.type === 'pos' && swapFrom.pos === pos;
          const isTgt  = editMode && !!swapFrom && !locked && !(swapFrom.type === 'pos' && swapFrom.pos === pos);
          const isHL   = !editMode && highlight === name && !!name;

          return (
            <div
              key={pos}
              onClick={() => !locked && handleClick({ type: 'pos', pos, name })}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: isSel ? '#ddeeff' : isTgt ? '#d6f0e8' : isHL ? '#fffbeb' : '#ffffff',
                border: `2px solid ${isSel ? '#1d6fcf' : isTgt ? '#059669' : isHL ? '#d97706' : '#c7daf7'}`,
                borderRadius: 8, padding: '5px 8px',
                cursor: locked ? 'not-allowed' : 'pointer',
                opacity: locked ? 0.5 : 1,
                transition: 'all 0.12s',
              }}
            >
              <div style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                background: POS_BG[pos], border: `1.5px solid ${POS_BORDER[pos]}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 7, fontWeight: 800, color: POS_TEXT[pos],
              }}>
                {pos}
              </div>
              <span style={{
                fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: isSel ? '#1558b0' : isTgt ? '#065f46' : isHL ? '#92400e' : '#0f2d5a',
              }}>
                {name || '—'}
              </span>
              {locked && <span style={{ fontSize: 9 }}>🔒</span>}
            </div>
          );
        })}

        {/* Bench */}
        {bench.length > 0 && (
          <>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#92400e', letterSpacing: 0.8, padding: '4px 2px 1px' }}>
              🪑 BENCH
            </div>
            {bench.map(name => {
              const isSel = editMode && swapFrom?.type === 'bench' && swapFrom.name === name;
              const isTgt = editMode && !!swapFrom && !(swapFrom.type === 'bench' && swapFrom.name === name);
              const isHL  = !editMode && highlight === name;
              return (
                <div
                  key={name}
                  onClick={() => handleClick({ type: 'bench', name })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: isSel ? '#ddeeff' : isTgt ? '#d6f0e8' : isHL ? '#fffbeb' : '#fef3c7',
                    border: `2px solid ${isSel ? '#1d6fcf' : isTgt ? '#059669' : isHL ? '#d97706' : '#fcd34d'}`,
                    borderRadius: 8, padding: '5px 8px', cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                >
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                    background: '#fde68a', border: '1.5px solid #f59e0b',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 7, fontWeight: 800, color: '#92400e',
                  }}>SUB</div>
                  <span style={{
                    fontSize: 12, fontWeight: 600, flex: 1,
                    color: isSel ? '#1558b0' : isTgt ? '#065f46' : '#92400e',
                  }}>
                    {name}
                  </span>
                </div>
              );
            })}
          </>
        )}

        {/* Journey panel — shown when a player is highlighted in view mode */}
        {!editMode && highlight && playerSchedule[highlight] && (
          <div style={{
            marginTop: 5, padding: '8px 9px',
            background: '#f5f9ff', borderRadius: 8,
            border: '1px solid #c7daf7',
          }}>
            {/* Player name + dismiss */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#4a6b8a', letterSpacing: 0.8 }}>
                {highlight} — JOURNEY
              </div>
              <button
                onClick={() => setHighlight(null)}
                style={{ background: 'none', border: 'none', color: '#7a96b0', cursor: 'pointer', fontSize: 12, padding: 0 }}
              >✕</button>
            </div>

            {/* Goals counter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: '#4a6b8a' }}>⚽ Goals</span>
              <button
                onClick={() => setGoals(g => ({ ...g, [highlight]: Math.max(0, (g[highlight] || 0) - 1) }))}
                style={{
                  width: 22, height: 22, borderRadius: 5, background: '#fff',
                  border: '1px solid #c7daf7', color: '#4a6b8a',
                  cursor: 'pointer', fontSize: 14, lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>−</button>
              <span style={{
                fontSize: 14, fontWeight: 800, minWidth: 18, textAlign: 'center',
                color: (goals[highlight] || 0) > 0 ? '#d97706' : '#94a3b8',
              }}>
                {goals[highlight] || 0}
              </span>
              <button
                onClick={() => setGoals(g => ({ ...g, [highlight]: (g[highlight] || 0) + 1 }))}
                style={{
                  width: 22, height: 22, borderRadius: 5, background: '#fff',
                  border: '1px solid #c7daf7', color: '#4a6b8a',
                  cursor: 'pointer', fontSize: 14, lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>+</button>
            </div>

            {/* Segment-by-segment positions (scrollable) */}
            <div style={{ display: 'flex', gap: 3, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2 }}>
              {segments.map((s, i) => {
                const role     = playerSchedule[highlight][i];
                const isActive = i === currentSeg;
                return (
                  <div
                    key={i}
                    onClick={() => goToSeg(i)}
                    style={{ flexShrink: 0, textAlign: 'center', cursor: 'pointer' }}
                  >
                    <div style={{ fontSize: 7, color: isActive ? '#1d6fcf' : '#94a3b8', marginBottom: 2 }}>
                      {s.duration}m
                    </div>
                    <div style={{
                      padding: '2px 4px', borderRadius: 3, fontSize: 8, fontWeight: 700, minWidth: 22,
                      background: role === 'BENCH' ? '#fde68a' : (POS_BG[role] || '#e2e8f0'),
                      color: role === 'BENCH' ? '#92400e' : (POS_TEXT[role] || '#0f2d5a'),
                      border: isActive ? '2px solid #1d6fcf' : '1.5px solid transparent',
                      boxSizing: 'border-box',
                    }}>
                      {role || '?'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  /** Timeline: progress bar + segment pills + transition summary */
  function renderTimeline() {
    const totalMins = 50;

    return (
      <div style={{ marginBottom: 8 }}>
        {/* Progress bar */}
        <div style={{
          position: 'relative', height: 20, borderRadius: 10,
          background: '#e2ecfc', overflow: 'hidden', marginBottom: 5,
        }}>
          {segments.map((s, i) => {
            const startPct = (getStartMin(segments, i) / totalMins) * 100;
            const widthPct = (s.duration / totalMins) * 100;
            const isActive = i === currentSeg;
            return (
              <div
                key={i}
                onClick={() => goToSeg(i)}
                title={s.label}
                style={{
                  position: 'absolute', left: `${startPct}%`, width: `${widthPct}%`,
                  top: 0, height: '100%', cursor: 'pointer',
                  background: isActive
                    ? (s.half === 2 ? '#059669' : '#1558b0')
                    : (s.half === 2 ? 'rgba(5,150,105,0.32)' : 'rgba(21,88,176,0.28)'),
                  borderRight: '1px solid rgba(255,255,255,0.4)',
                  transition: 'background 0.2s',
                }}
              />
            );
          })}
          {/* HT vertical line */}
          <div style={{
            position: 'absolute', left: '50%', top: 0, bottom: 0,
            width: 2, background: '#f59e0b', zIndex: 5, pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', left: '50%', top: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: 7, fontWeight: 800, color: '#92400e', zIndex: 6,
            background: 'rgba(255,248,220,0.9)', padding: '0 3px', borderRadius: 2,
            pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>HT</div>
        </div>

        {/* Segment pills */}
        <div style={{
          display: 'flex', gap: 3, overflowX: 'auto',
          scrollbarWidth: 'none', paddingBottom: 2,
        }}>
          {segments.map((s, i) => (
            <button
              key={i}
              onClick={() => goToSeg(i)}
              style={{
                flexShrink: 0, padding: '5px 8px',
                background: i === currentSeg
                  ? (s.half === 2 ? '#059669' : 'linear-gradient(135deg, #1558b0, #1d6fcf)')
                  : '#ffffff',
                border: `1px solid ${i === currentSeg ? 'transparent' : s.htBefore ? '#f59e0b' : '#c7daf7'}`,
                borderRadius: 12, cursor: 'pointer',
                fontSize: 10, fontWeight: 700,
                color: i === currentSeg ? '#fff' : s.htBefore ? '#92400e' : '#4a6b8a',
                whiteSpace: 'nowrap',
              }}
            >
              {s.htBefore ? '⏸ ' : ''}{s.label}{s.edited ? ' ✏️' : ''}
            </button>
          ))}
        </div>

        {/* Transition summary (next segment changes) */}
        {currentSeg < segments.length - 1 && (() => {
          const changes = getSubChanges(segments[currentSeg], segments[currentSeg + 1]);
          if (!changes.length) return null;
          const nextSeg  = segments[currentSeg + 1];
          const nextTime = getStartMin(segments, currentSeg + 1);
          return (
            <div style={{
              marginTop: 4, padding: '6px 8px',
              background: '#fffbeb', borderRadius: 7,
              border: '1px solid #fde68a', fontSize: 10,
              display: 'flex', flexWrap: 'wrap', gap: '2px 6px', alignItems: 'center',
            }}>
              <span style={{ fontWeight: 700, color: '#92400e', flexShrink: 0 }}>
                {nextSeg.htBefore ? '⏸ HT:' : `${nextTime} min:`}
              </span>
              {changes.slice(0, 3).map((c, ci) => (
                <span key={ci} style={{ color: '#4a6b8a' }}>
                  {c.type === 'sub'       && <><PosBadge pos={c.pos} /> ▲{c.on} ▼{c.off}</>}
                  {c.type === 'gk'        && <>🧤 ▲{c.on} ▼{c.off}</>}
                  {c.type === 'poschange' && <>{c.player}: <PosBadge pos={c.from} />→<PosBadge pos={c.to} /></>}
                </span>
              ))}
              {changes.length > 3 && <span style={{ color: '#7a96b0' }}>+{changes.length - 3} more</span>}
            </div>
          );
        })()}
      </div>
    );
  }

  /** Schedule tab: player×segment grid + sub instructions */
  function renderScheduleTab() {
    // Build sub instructions for each transition
    const transitions = segments.slice(1).map((s, i) => ({
      segIdx: i + 1,
      seg: s,
      changes: getSubChanges(segments[i], s),
      time: getStartMin(segments, i + 1),
    })).filter(t => t.changes.length > 0);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Grid table */}
        <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #c7daf7', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: segments.length * 60 + 100 }}>
              <thead>
                <tr>
                  <th style={{
                    padding: '8px 10px', background: '#f5f9ff', fontSize: 10,
                    fontWeight: 700, color: '#4a6b8a', textAlign: 'left',
                    borderBottom: '1px solid #e2ecfc', borderRight: '1px solid #e2ecfc',
                    position: 'sticky', left: 0, zIndex: 2, minWidth: 80,
                  }}>
                    Player
                  </th>
                  {segments.map((s, i) => (
                    <th
                      key={i}
                      style={{
                        padding: '5px 6px', background: s.half === 2 ? '#f0faf5' : '#f5f9ff',
                        fontSize: 9, fontWeight: 700, color: s.half === 2 ? '#059669' : '#4a6b8a',
                        textAlign: 'center', borderBottom: '1px solid #e2ecfc',
                        borderLeft: s.htBefore ? '3px solid #059669' : '1px solid #e2ecfc',
                        minWidth: 52, whiteSpace: 'nowrap',
                      }}
                    >
                      {s.htBefore ? '⏸ ' : ''}{s.label}
                      <div style={{ fontSize: 8, fontWeight: 400, color: '#7a96b0' }}>
                        {s.duration} min
                      </div>
                    </th>
                  ))}
                  <th style={{
                    padding: '5px 6px', background: '#f5f9ff', fontSize: 9,
                    fontWeight: 700, color: '#4a6b8a', textAlign: 'center',
                    borderBottom: '1px solid #e2ecfc', borderLeft: '2px solid #c7daf7',
                    minWidth: 44,
                  }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p, pi) => (
                  <tr
                    key={p}
                    onClick={() => setHighlight(h => h === p ? null : p)}
                    style={{
                      background: highlight === p ? '#fffbeb' : pi % 2 === 0 ? '#ffffff' : '#fafcff',
                      cursor: 'pointer', transition: 'background 0.1s',
                    }}
                  >
                    {/* Player name cell */}
                    <td style={{
                      padding: '5px 10px', fontSize: 11, fontWeight: 600,
                      color: '#0f2d5a', borderBottom: '1px solid #f0f4fa',
                      borderRight: '1px solid #e2ecfc',
                      position: 'sticky', left: 0,
                      background: highlight === p ? '#fffbeb' : pi % 2 === 0 ? '#ffffff' : '#fafcff',
                      zIndex: 1,
                      whiteSpace: 'nowrap',
                    }}>
                      {gkDutyMap[p] ? '🧤 ' : ''}{p}
                    </td>

                    {/* Segment cells */}
                    {segments.map((s, si) => {
                      const role = playerSchedule[p][si];
                      const isBench = role === 'BENCH';
                      return (
                        <td key={si} style={{
                          padding: '4px 3px', textAlign: 'center',
                          borderBottom: '1px solid #f0f4fa',
                          borderLeft: s.htBefore ? '3px solid #059669' : '1px solid #e2ecfc',
                        }}>
                          <div style={{
                            display: 'inline-block', padding: '2px 4px', borderRadius: 4,
                            fontSize: 9, fontWeight: 700,
                            background: isBench ? '#fde68a' : (POS_BG[role] || '#e2e8f0'),
                            color: isBench ? '#92400e' : (POS_TEXT[role] || '#0f2d5a'),
                            border: `1px solid ${isBench ? '#f59e0b' : (POS_BORDER[role] || '#c7daf7')}`,
                            minWidth: 28,
                          }}>
                            {role || '—'}
                          </div>
                        </td>
                      );
                    })}

                    {/* Total minutes */}
                    <td style={{
                      padding: '5px 6px', textAlign: 'center',
                      fontSize: 11, fontWeight: 700, color: '#0f2d5a',
                      borderBottom: '1px solid #f0f4fa',
                      borderLeft: '2px solid #c7daf7',
                    }}>
                      {minutesMap[p] || 0}m
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Substitution instruction cards */}
        {transitions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#4a6b8a', letterSpacing: 1 }}>
              SUBSTITUTION INSTRUCTIONS
            </div>
            {transitions.map(({ segIdx, seg: s, changes, time }) => (
              <div key={segIdx} style={{
                background: '#ffffff', borderRadius: 10,
                border: `1px solid ${s.htBefore ? '#fcd34d' : '#c7daf7'}`,
                overflow: 'hidden',
              }}>
                {/* Card header */}
                <div style={{
                  padding: '8px 12px',
                  background: s.htBefore ? 'linear-gradient(135deg, #fef3c7, #fde68a)' : '#f5f9ff',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: s.htBefore ? '#f59e0b' : '#64748b',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 800, color: '#fff',
                  }}>
                    {s.htBefore ? '⏸' : `${time}'`}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: s.htBefore ? '#92400e' : '#0f2d5a' }}>
                    {s.htBefore ? 'Half Time' : `${time} min`}
                    {s.edited ? <span style={{ color: '#c2410c', marginLeft: 6 }}>✏️ edited</span> : null}
                  </div>
                </div>

                {/* Changes list */}
                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {changes.map((c, ci) => (
                    <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, flexWrap: 'wrap' }}>
                      {c.type === 'sub' && (
                        <>
                          <PosBadge pos={c.pos} />
                          <span style={{ color: '#059669', fontWeight: 700 }}>▲ {c.on}</span>
                          <span style={{ color: '#7a96b0' }}>replaces</span>
                          <span style={{ color: '#f87171', fontWeight: 700 }}>▼ {c.off || '—'}</span>
                        </>
                      )}
                      {c.type === 'gk' && (
                        <>
                          <span style={{
                            padding: '1px 5px', borderRadius: 4, fontSize: 9, fontWeight: 800,
                            background: '#d946ef', color: '#0f2d5a',
                          }}>GK</span>
                          <span style={{ color: '#059669', fontWeight: 700 }}>▲ {c.on}</span>
                          <span style={{ color: '#7a96b0' }}>in goal (replaces</span>
                          <span style={{ color: '#f87171', fontWeight: 700 }}>▼ {c.off})</span>
                        </>
                      )}
                      {c.type === 'poschange' && (
                        <>
                          <span style={{ color: '#4a6b8a', fontWeight: 600 }}>{c.player}</span>
                          <span style={{ color: '#7a96b0' }}>moves</span>
                          <PosBadge pos={c.from} />
                          <span style={{ color: '#7a96b0' }}>→</span>
                          <PosBadge pos={c.to} />
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  /** Stats tab: playing time bars + fairness */
  function renderStatsTab() {
    const maxBar = 50; // total game minutes
    const gap = maxMins - minMins;
    const gapColor = gap === 0 ? '#059669' : gap <= 5 ? '#059669' : gap <= 10 ? '#d97706' : '#f87171';
    const allBenched = benchSize === 0 || players.every(p => (benchCountMap[p] || 0) > 0);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Playing time */}
        <div style={{
          background: '#ffffff', borderRadius: 12,
          padding: '16px 18px', border: '1px solid #c7daf7',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#4a6b8a', letterSpacing: 1, marginBottom: 12 }}>
            PLAYING TIME
          </div>

          {players.map(p => {
            const mins    = minutesMap[p] || 0;
            const pct     = Math.round((mins / maxBar) * 100);
            const isGK    = !!gkDutyMap[p];
            const bCount  = benchCountMap[p] || 0;
            return (
              <div key={p} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 0', borderBottom: '1px solid #e2ecfc',
              }}>
                <span style={{
                  fontSize: 12, fontWeight: 600, color: '#0f2d5a',
                  minWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {p}
                </span>
                {/* Bar */}
                <div style={{ flex: 1, height: 7, background: '#e2ecfc', borderRadius: 4 }}>
                  <div style={{
                    height: '100%', borderRadius: 4,
                    background: isGK
                      ? 'linear-gradient(90deg, #d946ef, #a855f7)'
                      : 'linear-gradient(90deg, #1558b0, #1d6fcf)',
                    width: `${(mins / maxBar) * 100}%`,
                    transition: 'width 0.5s',
                  }} />
                </div>
                {/* Minutes */}
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0f2d5a', minWidth: 28, textAlign: 'right' }}>
                  {mins}m
                </span>
                {/* Pct pill */}
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10,
                  background: '#e2ecfc', color: '#4a6b8a', minWidth: 32, textAlign: 'center',
                }}>
                  {pct}%
                </span>
                {/* Badges */}
                {isGK  && <span style={{ fontSize: 10 }}>🧤</span>}
                {bCount > 0 && (
                  <span style={{ fontSize: 9, color: '#92400e', fontWeight: 700 }}>
                    🪑{bCount}
                  </span>
                )}
              </div>
            );
          })}

          {/* Fairness summary */}
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#4a6b8a' }}>⚖️ Time spread</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: gapColor }}>
                {gap === 0
                  ? 'Perfectly equal ✓'
                  : `${minMins}–${maxMins} min · ${gap} min gap`}
              </span>
            </div>
            {benchSize > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#4a6b8a' }}>🪑 All players benched</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: allBenched ? '#059669' : '#f87171' }}>
                  {allBenched ? '✓ Yes' : '✗ Not yet'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 50% 0%, #d6e8ff 0%, #f0f6ff 70%)',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      padding: '12px 10px 40px',
    }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999,
          background: toast.type === 'err' ? '#fee2e2' : '#ecfdf5',
          border: `1px solid ${toast.type === 'err' ? '#f87171' : '#059669'}`,
          borderRadius: 10, padding: '9px 18px',
          color: toast.type === 'err' ? '#b91c1c' : '#059669',
          fontSize: 13, fontWeight: 700,
          boxShadow: '0 8px 24px rgba(0,40,100,0.12)',
          whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          {toast.msg}
        </div>
      )}

      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          marginBottom: 10, flexWrap: 'wrap', gap: 8,
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f2d5a' }}>
              ⚽ Team Sheet
            </h1>
            <p style={{ margin: 0, fontSize: 11, color: '#4a6b8a', marginTop: 1 }}>
              {players.length} players · {benchSize > 0 ? `${benchSize} bench · ` : ''}9v9 · 2×25 min
              {lockGK ? ' · GK full game' : ' · GK rotates HT'}
              {hasEdits && <span style={{ color: '#b45309' }}> · ✏️ edited</span>}
            </p>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            {tab === 'field' && (
              <button
                onClick={toggleEdit}
                style={{
                  background: editMode ? '#ddeeff' : '#f5f9ff',
                  border: `1px solid ${editMode ? '#1d6fcf' : '#c7daf7'}`,
                  borderRadius: 8, color: editMode ? '#1558b0' : '#7a96b0',
                  padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  boxShadow: editMode ? '0 0 12px rgba(37,99,235,0.2)' : 'none',
                  transition: 'all 0.2s',
                }}>
                ✏️ {editMode ? 'Editing' : 'Edit'}
              </button>
            )}
            <button
              onClick={() => setSaveOpen(o => !o)}
              style={{
                background: saveOpen ? '#ecfdf5' : '#ffffff',
                border: `1px solid ${saveOpen ? '#059669' : '#c7daf7'}`,
                borderRadius: 8, color: saveOpen ? '#059669' : '#7a96b0',
                padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
              }}>
              💾 {isSaved ? 'Saved ✓' : 'Save'}
            </button>
            <button
              onClick={onGoSeason}
              style={{
                background: '#ffffff', border: '1px solid #c7daf7', borderRadius: 8,
                color: '#7a96b0', padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>
              📅 {seasonGames.length}
            </button>
            {seasonGames.length > 0 && (
              <button
                onClick={onReorder}
                style={{
                  background: '#ffffff', border: '1px solid #1d6fcf', borderRadius: 8,
                  color: '#1d6fcf', padding: '6px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                }}>
                🔀
              </button>
            )}
            <button
              onClick={onGoSetup}
              style={{
                background: '#ffffff', border: '1px solid #c7daf7', borderRadius: 8,
                color: '#7a96b0', padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>
              ← Players
            </button>
          </div>
        </div>

        {/* ── Half indicator pills ── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[1, 2].map(h => {
            const active = seg?.half === h;
            return (
              <div
                key={h}
                style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: active ? '#059669' : '#ffffff',
                  color: active ? '#ffffff' : '#4a6b8a',
                  border: `1px solid ${active ? '#059669' : '#c7daf7'}`,
                  transition: 'all 0.2s',
                }}
              >
                {h === 1 ? '① First Half 0–25 min' : '② Second Half 25–50 min'}
              </div>
            );
          })}
        </div>

        {/* ── Save panel ── */}
        {saveOpen && (
          <div style={{
            marginBottom: 12, background: '#ffffff',
            border: '1px solid #059669', borderRadius: 12, padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>💾 Save this game to season</div>
              <button
                onClick={() => setSaveOpen(false)}
                style={{ padding: '3px 9px', background: '#fff', border: '1px solid #c7daf7', borderRadius: 6, color: '#7a96b0', fontSize: 12, cursor: 'pointer' }}>
                ✕
              </button>
            </div>

            {/* Match label */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#4a6b8a', letterSpacing: 1, marginBottom: 5 }}>MATCH LABEL</div>
              <input
                value={matchLabel}
                onChange={e => setMatchLabel(e.target.value)}
                placeholder="Optional (e.g. vs Eastside FC)"
                style={{
                  width: '100%', background: '#fff', border: '1px solid #c7daf7',
                  borderRadius: 8, padding: '8px 12px', color: '#0f2d5a',
                  fontSize: 12, outline: 'none', fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* POTM */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#4a6b8a', letterSpacing: 1, marginBottom: 5 }}>⭐ PLAYER OF THE MATCH</div>
              <select
                value={potm}
                onChange={e => setPotm(e.target.value)}
                style={{
                  width: '100%', background: '#fff', border: '1px solid #c7daf7',
                  borderRadius: 8, padding: '8px 12px',
                  color: potm ? '#92400e' : '#4a6b8a',
                  fontSize: 12, outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">— None —</option>
                {players.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            {/* Goals — pre-populated from live tracking */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#4a6b8a', letterSpacing: 1, marginBottom: 6 }}>⚽ GOALS SCORED</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {players.map(p => (
                  <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{
                      fontSize: 11, color: '#4a6b8a', flex: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{p}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                      <button
                        onClick={() => setGoals(g => ({ ...g, [p]: Math.max(0, (g[p] || 0) - 1) }))}
                        style={{ width: 24, height: 24, borderRadius: 5, background: '#f5f9ff', border: '1px solid #c7daf7', color: '#4a6b8a', fontSize: 13, cursor: 'pointer', lineHeight: 1 }}>−</button>
                      <span style={{
                        fontSize: 12, fontWeight: 700, minWidth: 16, textAlign: 'center',
                        color: (goals[p] || 0) > 0 ? '#d97706' : '#c7daf7',
                      }}>{goals[p] || 0}</span>
                      <button
                        onClick={() => setGoals(g => ({ ...g, [p]: (g[p] || 0) + 1 }))}
                        style={{ width: 24, height: 24, borderRadius: 5, background: '#f5f9ff', border: '1px solid #c7daf7', color: '#4a6b8a', fontSize: 13, cursor: 'pointer', lineHeight: 1 }}>+</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={handleSave}
              style={{
                width: '100%', padding: 12,
                background: 'linear-gradient(135deg, #059669, #10b981)',
                border: 'none', borderRadius: 10, color: '#fff',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>
              {isSaved ? '💾 Save Changes' : '💾 Save to Season'}
            </button>
          </div>
        )}

        {/* ── Tab bar ── */}
        <div style={{
          display: 'flex', gap: 4, marginBottom: 10,
          background: '#ffffff', borderRadius: 10, padding: 4,
          border: '1px solid #e2ecfc',
        }}>
          {[['field', '⚽ Field'], ['schedule', '📋 Schedule'], ['stats', '📊 Stats']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setTab(id); setSwapFrom(null); }}
              style={{
                flex: 1, padding: '7px 4px', borderRadius: 8, border: 'none',
                background: tab === id ? 'linear-gradient(135deg, #1558b0, #1d6fcf)' : 'transparent',
                color: tab === id ? '#fff' : '#4a6b8a',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* ══ FIELD TAB ══ */}
        {tab === 'field' && seg && (
          <>
            {/* Timeline (only when multiple segments) */}
            {segments.length > 1 && renderTimeline()}

            {/* Left panel + Field */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              {renderLeftPanel()}
              <div style={{ flex: 1, minWidth: 0 }}>
                <FieldView
                  assignment={seg.assignment}
                  highlight={editMode ? null : highlight}
                  swapFrom={editMode ? swapFrom : null}
                  onPlayerClick={handleFieldClick}
                />
              </div>
            </div>
          </>
        )}

        {/* ══ SCHEDULE TAB ══ */}
        {tab === 'schedule' && renderScheduleTab()}

        {/* ══ STATS TAB ══ */}
        {tab === 'stats' && renderStatsTab()}

      </div>
    </div>
  );
}
