// Screen 3a — Match Setup, in the Session 13 sideline language.
//
//  · Navy chrome + UI tokens instead of the blue gradient card and ~6 hues.
//  · The two GK <select>s become chip rows — the last dropdowns in the app —
//    ordered by who is most overdue a turn in goal, with an "Everyone else"
//    expander. Same component idiom as the POTW/captain rows in the save modal.
//  · The amber "game plan preview" becomes the period-pip strip from the live
//    screen, so setup rehearses the screen you stare at all game.
//  · Emoji toggles gone. Only the squad-count badge carries a status colour, so
//    a short squad is the one thing that catches the eye.
//  · Everything sized through s() off DESIGN_WIDTH 1024, like the other views.

import { useMemo, useState } from 'react';
import { getSegmentConfig, rankByGKFairness } from '../scheduler.js';
import { DEFAULT_PLAYERS, MIN_PLAYERS, MAX_PLAYERS, UI } from '../constants.js';
import useScale from '../useScale.js';
import useOfflineReady from '../useOfflineReady.js';

export default function InputView({
  playersText, setPlayersText,
  gkH1, setGkH1,
  gkH2, setGkH2,
  gkFullGame, setGkFullGame,
  onGenerate, onReorder, onGoSeason,
  seasonGameCount,
  onImport, importMsg,
  seasonGames = [],
}) {
  const { s } = useScale();
  const offlineReady = useOfflineReady();
  const [showRawText, setShowRawText] = useState(false);
  const [gk1Expanded, setGk1Expanded] = useState(false);
  const [gk2Expanded, setGk2Expanded] = useState(false);

  const activePlayers = useMemo(
    () => playersText.split('\n').map(l => l.trim()).filter(Boolean),
    [playersText]
  );

  const masterRoster = useMemo(() => {
    const defaults = DEFAULT_PLAYERS.split('\n').map(l => l.trim());
    return [...new Set([...defaults, ...activePlayers])].filter(Boolean).sort();
  }, [activePlayers]);

  const count   = activePlayers.length;
  const benchSz = count > 9 ? count - 9 : 0;
  const shortSz = count < 9 ? 9 - count : 0;
  const isValid = count >= MIN_PLAYERS && count <= MAX_PLAYERS;
  const config  = getSegmentConfig(count);
  const lockGKEffective = !!gkH1 && gkH1 === gkH2;

  // Period boundaries for the pip strip: [{label, from, to, half}]. Read off
  // config.durs, never hardcoded — the design renders show an even split, but
  // an 11-player game is really 5/10/10 | 10/10/5.
  const periods = useMemo(() => {
    if (!config) return [];
    let t = 0;
    return config.durs.map((d, i) => {
      const p = { label: `P${i + 1}`, from: t, to: t + d, half: t < 25 ? 1 : 2 };
      t += d;
      return p;
    });
  }, [config]);

  // Who is most overdue a turn in goal. rankByGKFairness is the whole-list
  // version of the ordering — orderPlayersForGame ranks only its first two
  // slots this way and fills the rest by bench-minute fairness, which would
  // put the wrong names in chips 3 and 4 under a heading that promises
  // "longest without a turn".
  const gkOrder = useMemo(
    () => rankByGKFairness(activePlayers, seasonGames),
    [activePlayers, seasonGames]
  );

  const absent = useMemo(
    () => masterRoster.filter(n => !activePlayers.includes(n)),
    [masterRoster, activePlayers]
  );

  const togglePlayer = (name) => {
    setPlayersText(
      (activePlayers.includes(name)
        ? activePlayers.filter(p => p !== name)
        : [...activePlayers, name]
      ).join('\n')
    );
  };

  const badge =
    count < MIN_PLAYERS ? { text: `${count} · NEED ${MIN_PLAYERS - count} MORE`, tint: '#fdecec', fg: UI.stop }
  : count > MAX_PLAYERS ? { text: `${count} · MAX ${MAX_PLAYERS}`,               tint: UI.warnTint, fg: UI.warn }
  : count < 9           ? { text: `${count} PLAYING · SHORT ${shortSz}`,         tint: UI.warnTint, fg: UI.warn }
  :                       { text: `${count} PLAYING`,                            tint: UI.goTint,   fg: UI.go };

  // Named, so the coach can see the suggestion is reasoned rather than random.
  const gkHint = () => {
    if (seasonGameCount === 0) return 'First game of the season — pick anyone.';
    const [a, b] = gkOrder;
    if (a && b) return `Suggested from history — ${a} and ${b} have gone longest without a turn.`;
    return 'Longest since a turn in goal, first. Override freely.';
  };

  const absentHint = absent.length === 0
    ? "Everyone's in. Tap a name to mark them out."
    : `${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ` and ${absent.length - 3} more` : ''} out today — tap to add anyone who turns up late.`;

  // ── shared styles ─────────────────────────────────────────────────────────
  const sectionLabel = {
    fontSize: Math.max(15, s(16)), fontWeight: 900, letterSpacing: s(2),
    color: UI.label, textTransform: 'uppercase',
  };
  const card = {
    background: '#fff', border: `3px solid ${UI.blueLine}`,
    borderRadius: s(20), padding: `${s(24)}px ${s(26)}px`,
  };
  const chip = (selected, muted) => ({
    background: selected ? UI.navy : '#fff',
    border: `3px solid ${selected ? UI.navy : UI.blueLine}`,
    borderRadius: s(12), padding: `${s(11)}px ${s(20)}px`,
    fontSize: Math.max(16, s(22)), fontWeight: 800,
    color: selected ? '#fff' : muted ? UI.label : UI.navy,
    cursor: 'pointer', fontFamily: 'inherit',
  });

  // isH2: the second-half row excludes whoever is keeping goal in the first,
  // because picking them there means something specific — the full 50 minutes —
  // and that gets its own chip rather than being a silent collision.
  const gkRow = (value, onPick, expanded, setExpanded, isH2) => {
    const pool  = isH2 ? gkOrder.filter(p => p !== gkH1) : gkOrder;
    const shown = expanded ? pool : pool.slice(0, 4);
    const list  = value && value !== gkH1 && !shown.includes(value) ? [value, ...shown] : shown;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: s(10) }}>
        {list.map(p => (
          <button key={p} type="button" onClick={() => onPick(value === p ? null : p)} style={chip(value === p)}>
            {p}{value === p ? ' ✓' : ''}
          </button>
        ))}
        {!expanded && pool.length > 4 && (
          <button type="button" onClick={() => setExpanded(true)} style={chip(false, true)}>Everyone else ▾</button>
        )}
        {isH2 && gkH1 && (
          <button
            type="button"
            onClick={() => setGkFullGame(!lockGKEffective)}
            style={{
              ...chip(lockGKEffective),
              background: lockGKEffective ? UI.navy : UI.page,
              color: lockGKEffective ? '#fff' : UI.bodyText,
            }}>
            Same as 1st half{lockGKEffective ? ' ✓' : ''}
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{
      minHeight: '100vh', background: UI.page, color: UI.navy,
      fontFamily: 'system-ui, "Segoe UI", sans-serif',
      fontVariantNumeric: 'tabular-nums',
      display: 'flex', flexDirection: 'column',
    }}>

      {/* Header */}
      <header style={{
        background: UI.navy, minHeight: s(96), flexShrink: 0,
        padding: `${s(12)}px ${s(22)}px`, display: 'flex',
        alignItems: 'center', justifyContent: 'space-between', gap: s(16), flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: Math.max(24, s(34)), fontWeight: 800, color: '#fff', letterSpacing: -0.5, lineHeight: 1.1 }}>
            Match setup
          </div>
          <div style={{ fontSize: Math.max(15, s(15)), fontWeight: 800, color: UI.onNavyMuted, letterSpacing: s(2) }}>
            9V9 · 2 × 25 MIN · ROLLING SUBS
          </div>
          {/* Session 18. The app failed at a ground with nothing on screen to
              warn that no copy was stored. Check this before you leave wifi. */}
          {offlineReady !== 'n/a' && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: s(8), marginTop: s(8),
              padding: `${s(5)}px ${s(12)}px`, borderRadius: 999,
              background: offlineReady === 'ready' ? UI.goTint : UI.warnTint,
              color: offlineReady === 'ready' ? UI.go : UI.warn,
              fontSize: Math.max(15, s(16)), fontWeight: 900, letterSpacing: s(1),
            }}>
              {offlineReady === 'ready' ? 'WORKS OFFLINE ✓' : 'NOT SAVED YET — STAY ON WIFI'}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: s(10) }}>
          <button type="button" onClick={onGoSeason} style={{
            border: `2px solid ${UI.onNavyBorder}`, borderRadius: s(10), background: 'transparent',
            padding: `${s(14)}px ${s(20)}px`, fontSize: Math.max(16, s(18)), fontWeight: 800,
            color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
          }}>SEASON · {seasonGameCount}</button>
          <label style={{
            border: `2px solid ${UI.onNavyBorder}`, borderRadius: s(10),
            padding: `${s(14)}px ${s(20)}px`, fontSize: Math.max(16, s(18)), fontWeight: 800,
            color: '#fff', cursor: 'pointer',
          }}>
            IMPORT
            <input type="file" accept=".json" onChange={onImport} style={{ display: 'none' }} />
          </label>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: s(22), padding: `${s(26)}px ${s(30)}px 0`, minHeight: 0 }}>

        {importMsg && (
          <div style={{
            padding: s(14), borderRadius: s(12), textAlign: 'center',
            background: importMsg.type === 'err' ? '#fdecec' : UI.goTint,
            color: importMsg.type === 'err' ? UI.stop : UI.go,
            fontSize: Math.max(15, s(20)), fontWeight: 800,
          }}>{importMsg.msg}</div>
        )}

        {/* Squad */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: s(12), marginBottom: s(14) }}>
            <div style={sectionLabel}>Who turned up</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: s(10) }}>
              {isValid && (
                <div style={{ fontSize: Math.max(16, s(17)), fontWeight: 800, color: UI.bodyText }}>
                  {benchSz === 0 ? 'No subs needed' : `${benchSz} on the bench each period`}
                </div>
              )}
              <div style={{
                background: badge.tint, border: `3px solid ${badge.fg}`, borderRadius: 999,
                padding: `${s(7)}px ${s(18)}px`, fontSize: Math.max(16, s(20)), fontWeight: 900, color: badge.fg,
              }}>{badge.text}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: s(12) }}>
            {masterRoster.map(name => {
              const on = activePlayers.includes(name);
              return (
                <button key={name} type="button" onClick={() => togglePlayer(name)} style={{
                  height: s(78), borderRadius: s(14),
                  background: on ? UI.navy : '#fff',
                  border: `3px solid ${on ? UI.navy : UI.blueLine}`,
                  color: on ? '#fff' : UI.label,
                  fontSize: Math.max(18, s(26)), fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: s(10),
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  {name}{on && <span style={{ fontSize: Math.max(16, s(20)) }}>✓</span>}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: s(12), display: 'flex', alignItems: 'center', gap: s(12), flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setShowRawText(!showRawText)} style={{
              border: `3px dashed ${UI.blueLine}`, borderRadius: s(14), background: 'transparent',
              padding: `${s(12)}px ${s(22)}px`, fontSize: Math.max(16, s(20)), fontWeight: 800,
              color: UI.label, cursor: 'pointer', fontFamily: 'inherit',
            }}>{showRawText ? 'DONE' : '+ ADD A PLAYER'}</button>
            <div style={{ fontSize: Math.max(16, s(17)), fontWeight: 600, color: UI.label }}>
              {absentHint}
            </div>
          </div>

          {showRawText && (
            <textarea
              value={playersText}
              onChange={e => setPlayersText(e.target.value)}
              placeholder="One name per line…"
              rows={8}
              style={{
                width: '100%', boxSizing: 'border-box', marginTop: s(12),
                background: '#fff', border: `3px solid ${UI.blueLine}`, borderRadius: s(12),
                padding: s(16), color: UI.navy, fontSize: Math.max(16, s(22)), fontWeight: 700,
                lineHeight: 1.7, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
              }}
            />
          )}
        </div>

        {/* Goalkeepers */}
        {isValid && (
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: s(12), marginBottom: s(16) }}>
              <div style={sectionLabel}>Goalkeeper</div>
              <div style={{ fontSize: Math.max(16, s(17)), fontWeight: 700, color: UI.bodyText, textAlign: 'right' }}>
                {gkHint()}
              </div>
            </div>

            <div style={{ ...sectionLabel, fontSize: Math.max(15, s(15)), letterSpacing: s(1.5), marginBottom: s(10) }}>1st half</div>
            <div style={{ marginBottom: s(20) }}>
              {gkRow(gkH1, setGkH1, gk1Expanded, setGk1Expanded, false)}
            </div>

            <div style={{ ...sectionLabel, fontSize: Math.max(15, s(15)), letterSpacing: s(1.5), marginBottom: s(10) }}>2nd half</div>
            {gkRow(
              lockGKEffective ? null : gkH2,
              // Picking a named 2nd-half keeper cancels the full-game choice —
              // otherwise App's auto-suggest effect would force it straight back.
              (p) => { setGkFullGame(false); setGkH2(p); },
              gk2Expanded, setGk2Expanded, true
            )}

            {lockGKEffective && (
              <div style={{ marginTop: s(12), fontSize: Math.max(16, s(17)), fontWeight: 700, color: UI.bodyText }}>
                {gkH1} keeps goal for the full 50 minutes.
              </div>
            )}
          </div>
        )}

        {/* The plan this makes — same pip strip as the live screen */}
        {isValid && periods.length > 0 && (
          <div>
            <div style={{ ...sectionLabel, marginBottom: s(12) }}>The plan this makes</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: s(8), marginBottom: s(12) }}>
              {periods.map((p, i) => (
                <div key={p.label} style={{ display: 'contents' }}>
                  {i > 0 && periods[i - 1].half === 1 && p.half === 2 && (
                    <div style={{
                      width: s(46), height: s(56), borderRadius: s(8), background: UI.track,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: Math.max(15, s(14)), fontWeight: 900, color: UI.label,
                    }}>HT</div>
                  )}
                  <div style={{
                    flex: 1, minHeight: s(56), padding: `${s(4)}px 0`, borderRadius: s(8), background: '#fff',
                    border: `2px solid ${UI.blueLine}`, color: UI.bodyText,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <div style={{ fontSize: Math.max(16, s(17)), fontWeight: 900, lineHeight: 1.1 }}>{p.label}</div>
                    <div style={{ fontSize: Math.max(15, s(13)), fontWeight: 800, color: UI.label, lineHeight: 1.1 }}>{p.from}–{p.to}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: s(12), flexWrap: 'wrap' }}>
              {[
                ['Every outfield player',
                  benchSz === 0 ? 'All 50 min' : lockGKEffective
                    ? `~${Math.round(400 / (count - 1))} min`
                    : `~${Math.round(450 / count)} min`],
                ['Each keeper', lockGKEffective ? '50 min in goal' : '25 min in goal'],
                ['Balanced against', `${seasonGameCount} round${seasonGameCount === 1 ? '' : 's'} played`],
              ].map(([label, value]) => (
                <div key={label} style={{
                  flex: '1 1 30%', background: '#fff', border: `2px solid ${UI.blueLine}`,
                  borderRadius: s(12), padding: `${s(14)}px ${s(18)}px`,
                }}>
                  <div style={{ ...sectionLabel, fontSize: Math.max(15, s(14)), letterSpacing: s(1.5), marginBottom: s(4) }}>{label}</div>
                  <div style={{ fontSize: Math.max(20, s(26)), fontWeight: 800, color: UI.navy }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Primary action */}
      <div style={{ padding: `${s(20)}px ${s(30)}px ${s(26)}px`, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => (seasonGameCount > 0 ? onReorder() : onGenerate())}
          disabled={!isValid}
          style={{
            width: '100%', height: s(92), borderRadius: s(16), border: 'none',
            background: isValid ? UI.navy : UI.track,
            color: isValid ? '#fff' : UI.label,
            fontSize: Math.max(20, s(28)), fontWeight: 900, letterSpacing: 0.5,
            cursor: isValid ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
          }}>
          {isValid
            ? (seasonGameCount > 0 ? 'BALANCE & GENERATE BOARD →' : 'GENERATE BOARD →')
            : count > MAX_PLAYERS
              ? `TOO MANY — REMOVE ${count - MAX_PLAYERS}`
              : `ADD ${MIN_PLAYERS - count} MORE PLAYER${MIN_PLAYERS - count === 1 ? '' : 'S'}`}
        </button>
      </div>
    </div>
  );
}
