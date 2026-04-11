/**
 * scheduler.js — Core rotation algorithm for the Team Sheet Planner.
 *
 * Key concepts:
 *  - Squad size: 9–12 players
 *  - 9 field positions (GK + 8 outfield), benchSize = squadSize - 9
 *  - Game split into segments; bench rotates each segment so every player sits out equally
 *  - GK rotates at half-time (unless lockGKFullGame = true)
 */

import { OUTFIELD } from './constants.js';

// ---------------------------------------------------------------------------
// Segment configuration
// ---------------------------------------------------------------------------

/**
 * Returns the segment timing structure for a given squad size.
 * durs      – array of segment durations in minutes
 * htAfterSeg – index of the segment after which half-time falls
 *              (-1 means no half-time break / no bench, i.e. 9 players)
 */
export function getSegmentConfig(squadSize) {
  if (squadSize <= 9) return { durs: [25, 25], htAfterSeg: 0 };
  switch (squadSize) {
    case 10: return { durs: [5,5,5,5,5,5,5,5,5,5], htAfterSeg: 4  };
    case 11: return { durs: [5,10,10,10,10,5],      htAfterSeg: 2  };
    case 12: return { durs: [10,15,10,15],           htAfterSeg: 1  };
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Internal: build the bench-slot rotation array
// ---------------------------------------------------------------------------

/**
 * Builds a flat array of player *indices* that occupy each bench slot across
 * all segments.  The array has length (nSegs × benchSize).
 *
 * When lockGKFullGame is false, player index 0 (the GK) is placed in the
 * bench-slot immediately after half-time so they sit out for exactly one
 * segment; all other slots rotate through players 1..n-1.
 */
function buildBenchSlots(squadSize, nSegs, benchSize, htAfterSeg, lockGKFullGame) {
  const total      = nSegs * benchSize;
  const gkOffSlot  = (htAfterSeg + 1) * benchSize; // where GK index goes to bench
  const slots      = new Array(total).fill(null);

  if (lockGKFullGame) {
    // GK never benched — cycle players 1..n-1 through every slot
    const others = Array.from({ length: squadSize - 1 }, (_, i) => i + 1);
    for (let k = 0; k < total; k++) slots[k] = others[k % others.length];
  } else {
    slots[gkOffSlot] = 0; // GK (index 0) goes to bench here
    const others = Array.from({ length: squadSize - 1 }, (_, i) => i + 1);
    let j = 0;
    for (let k = 0; k < total; k++) {
      if (k !== gkOffSlot) slots[k] = others[j++ % others.length];
    }
  }

  return slots;
}

// ---------------------------------------------------------------------------
// Bench-minute weights (used for fair re-ordering across games)
// ---------------------------------------------------------------------------

/**
 * Returns a map of { playerIndex → totalBenchMinutes } for a squad of
 * squadSize, based on the standard rotation.  Used by orderPlayersForGame
 * to balance bench time across the season.
 */
export function buildBenchMinuteWeights(squadSize) {
  const config = getSegmentConfig(squadSize);
  if (!config) return {};

  const { durs, htAfterSeg } = config;
  const nSegs     = durs.length;
  const benchSize = squadSize - 9;

  if (benchSize <= 0) {
    return Object.fromEntries(Array.from({ length: squadSize }, (_, i) => [i, 0]));
  }

  const slots = buildBenchSlots(squadSize, nSegs, benchSize, htAfterSeg, false);

  const weights = Object.fromEntries(Array.from({ length: squadSize }, (_, i) => [i, 0]));
  for (let s = 0; s < nSegs; s++) {
    slots.slice(s * benchSize, (s + 1) * benchSize).forEach(idx => {
      weights[idx] += durs[s];
    });
  }
  return weights;
}

// ---------------------------------------------------------------------------
// Season-aware player ordering
// ---------------------------------------------------------------------------

/**
 * Returns the index in the ordered-players array that should receive the
 * second GK (the player who takes over in goal for the second half).
 * Returns -1 for 9-player squads.
 */
export function getSecondGKSlot(squadSize) {
  if (squadSize <= 9) return 1;

  const config = getSegmentConfig(squadSize);
  if (!config) return -1;

  const { durs, htAfterSeg } = config;
  const nSegs     = durs.length;
  const benchSize = squadSize - 9;
  const slots = buildBenchSlots(squadSize, nSegs, benchSize, htAfterSeg, false);
  // The player in the last bench slot before half-time becomes 2nd-half GK
  return slots[htAfterSeg * benchSize];
}

/**
 * Re-orders the players array to fairly distribute GK duty and bench time
 * based on the season history.
 *
 * players  – string[]   current player list
 * history  – game[]     saved games from this season
 * lockGK   – boolean    if true, player[0] will be GK all game (skip 2nd-GK slot)
 */
export function orderPlayersForGame(players, history, lockGK = false) {
  if (!history || history.length === 0) return players;

  const n = players.length;
  if (!getSegmentConfig(n)) return players;

  // Tally GK stints and accumulated bench-minutes per player from history
  const gkStints  = Object.fromEntries(players.map(p => [p, 0]));
  const benchMins = Object.fromEntries(players.map(p => [p, 0]));
  const weights   = buildBenchMinuteWeights(n);

  history.forEach(game => {
    const segs = game.segments;
    if (!segs) return;

    const h1GK = segs.find(s => s.half === 1)?.assignment?.GK;
    const h2GK = segs.find(s => s.half === 2)?.assignment?.GK;
    if (h1GK && gkStints[h1GK] !== undefined) gkStints[h1GK]++;
    if (h2GK && h2GK !== h1GK && gkStints[h2GK] !== undefined) gkStints[h2GK]++;

    game.players?.forEach((p, idx) => {
      if (benchMins[p] !== undefined) benchMins[p] += weights[idx] || 0;
    });
  });

  // Sort ascending by GK stints (ties broken by original order = stable)
  const sorted = players
    .map((p, i) => ({ p, i, stints: gkStints[p] || 0 }))
    .sort((a, b) => a.stints - b.stints || a.i - b.i)
    .map(x => x.p);

  const secondGKSlot = getSecondGKSlot(n);
  const result = new Array(n).fill(null);
  const pool   = [...sorted];

  result[0] = pool.shift(); // fewest GK stints → first GK
  if (secondGKSlot > 0 && !lockGK) result[secondGKSlot] = pool.shift(); // 2nd-least → rotation GK

  // Fill remaining slots: sort empty slots by bench-weight asc, fill with
  // players who have had the most bench time (so they get more field time now)
  const emptySlots = Array.from({ length: n }, (_, i) => i)
    .filter(i => result[i] === null)
    .sort((a, b) => (weights[a] || 0) - (weights[b] || 0));

  const byBench = [...pool].sort((a, b) => (benchMins[b] || 0) - (benchMins[a] || 0));
  emptySlots.forEach((slot, i) => { result[slot] = byBench[i]; });

  return result.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Main schedule builder
// ---------------------------------------------------------------------------

/**
 * Builds the complete substitution schedule for a game.
 *
 * players         – string[]  player names; players[0] is the first GK
 * lockGKFullGame  – boolean   if true, players[0] stays in goal the whole game
 *
 * Returns an array of segment objects:
 * {
 *   segIdx:    number           0-based index
 *   assignment: { GK, LB, … }  position → player name
 *   bench:     string[]         players on bench this segment
 *   gkName:    string           who is in goal
 *   duration:  number           minutes this segment lasts
 *   label:     string           e.g. "H1 0–5"
 *   half:      1 | 2
 *   htBefore:  boolean          true if half-time whistle precedes this segment
 *   subBefore: boolean          true if a sub is made before this segment
 *   edited:    boolean          true if the user has manually swapped players
 * }
 */
export function buildSchedule(players, lockGKFullGame = false) {
  const n      = players.length;
  const config = getSegmentConfig(n);
  if (!config) return null;

  const { durs, htAfterSeg } = config;
  const nSegs     = durs.length;
  const benchSize = n - 9;

  // ── 9-player special case: no bench, two halves ──────────────────────────
  if (benchSize <= 0) {
    const h1Assignment = { GK: players[0] };
    OUTFIELD.forEach((pos, i) => { h1Assignment[pos] = players[i + 1] ?? null; });

    const h2GK = lockGKFullGame ? players[0] : players[1];
    const h2Assignment = { GK: h2GK };
    if (lockGKFullGame) {
      OUTFIELD.forEach((pos, i) => { h2Assignment[pos] = players[i + 1] ?? null; });
    } else {
      // players[1] becomes GK; players[0] steps into OUTFIELD[0] (players[1]'s H1 spot)
      OUTFIELD.forEach((pos, i) => {
        h2Assignment[pos] = i === 0 ? players[0] : (players[i + 1] ?? null);
      });
    }

    return [
      {
        segIdx: 0, assignment: h1Assignment, bench: [], gkName: players[0],
        duration: 25, label: 'H1 0–25',
        half: 1, htBefore: false, subBefore: false, edited: false,
      },
      {
        segIdx: 1, assignment: h2Assignment, bench: [], gkName: h2GK,
        duration: 25, label: 'H2 25–50',
        half: 2, htBefore: true, subBefore: false, edited: false,
      },
    ];
  }

  // ── Build the bench-slot rotation ─────────────────────────────────────────
  const benchSlots = buildBenchSlots(n, nSegs, benchSize, htAfterSeg, lockGKFullGame);

  // Group slots into per-segment bench arrays
  const segBench = Array.from({ length: nSegs }, (_, s) =>
    benchSlots.slice(s * benchSize, (s + 1) * benchSize)
  );

  // Track which player index is GK for each segment
  let curGKIdx      = 0;
  const gkPerSeg    = new Array(nSegs).fill(0);
  for (let s = 0; s < nSegs; s++) {
    gkPerSeg[s] = curGKIdx;
    if (s === htAfterSeg && !lockGKFullGame) {
      curGKIdx = segBench[htAfterSeg][0]; // first bench player at HT becomes new GK
    }
  }

  // ── Build initial field assignment ────────────────────────────────────────
  const bench0  = new Set(segBench[0]);
  const field0  = Array.from({ length: n }, (_, i) => i).filter(i => !bench0.has(i));
  const gk0     = gkPerSeg[0];
  const out0    = field0.filter(i => i !== gk0);

  // posMap: position name → player *index* (so we can track as subs happen)
  let posMap = { GK: gk0 };
  OUTFIELD.forEach((pos, i) => { posMap[pos] = out0[i] ?? null; });

  // Track each player's last outfield position for continuity on return
  const lastOutfieldPos = {};  // playerIndex → position name
  OUTFIELD.forEach(pos => {
    if (posMap[pos] !== null) lastOutfieldPos[posMap[pos]] = pos;
  });

  // Convert posMap (index-based) to name-based assignment object
  const toNames = pm => Object.fromEntries(
    Object.entries(pm).map(([pos, idx]) => [pos, players[idx] ?? null])
  );

  // ── Generate one object per segment ──────────────────────────────────────
  const segments = [];
  let elapsed = 0;

  for (let s = 0; s < nSegs; s++) {
    const isHT  = s === htAfterSeg + 1; // first segment of 2nd half
    const start = elapsed;
    elapsed += durs[s];
    const half = start >= 25 ? 2 : 1;

    if (s === 0) {
      segments.push({
        segIdx: 0, assignment: toNames(posMap),
        bench: segBench[0].map(i => players[i]),
        gkName: players[gkPerSeg[0]],
        duration: durs[0], label: `H1 0–${durs[0]}`,
        half: 1, htBefore: false, subBefore: false, edited: false,
      });
      continue;
    }

    // Figure out who is moving
    const prevBench = new Set(segBench[s - 1]);
    const currBench = new Set(segBench[s]);
    const all       = Array.from({ length: n }, (_, i) => i);
    const comingOn  = all.filter(i => prevBench.has(i) && !currBench.has(i)); // bench → field
    const goingOff  = all.filter(i => !prevBench.has(i) && currBench.has(i)); // field → bench

    // Positions that are becoming vacant (their occupant is going to bench)
    const vacantPos = Object.entries(posMap)
      .filter(([, idx]) => goingOff.includes(idx))
      .map(([pos]) => pos);

    const newPosMap = { ...posMap };

    if (isHT && !lockGKFullGame) {
      // Half-time: handle GK rotation separately
      const newGKIdx    = gkPerSeg[s];
      newPosMap.GK      = newGKIdx;
      const nonGKComing = comingOn.filter(i => i !== newGKIdx);
      const remainVacant = new Set(vacantPos.filter(p => p !== 'GK'));
      // Pass 1: prefer each player's previous outfield position
      const unmatched = [];
      nonGKComing.forEach(idx => {
        const prev = lastOutfieldPos[idx];
        if (prev && remainVacant.has(prev)) {
          newPosMap[prev] = idx;
          remainVacant.delete(prev);
        } else {
          unmatched.push(idx);
        }
      });
      // Pass 2: assign remaining players to remaining vacant positions
      const leftover = [...remainVacant];
      unmatched.forEach((idx, k) => {
        if (leftover[k] !== undefined) newPosMap[leftover[k]] = idx;
      });
    } else {
      // Regular substitution: prefer positional continuity
      const remainVacant = new Set(vacantPos);
      const unmatched = [];
      comingOn.forEach(idx => {
        const prev = lastOutfieldPos[idx];
        if (prev && remainVacant.has(prev)) {
          newPosMap[prev] = idx;
          remainVacant.delete(prev);
        } else {
          unmatched.push(idx);
        }
      });
      const leftover = [...remainVacant];
      unmatched.forEach((idx, k) => {
        if (leftover[k] !== undefined) newPosMap[leftover[k]] = idx;
      });
    }

    posMap = newPosMap;
    // Update last-known outfield positions
    OUTFIELD.forEach(pos => {
      if (posMap[pos] !== null) lastOutfieldPos[posMap[pos]] = pos;
    });
    segments.push({
      segIdx: s, assignment: toNames(posMap),
      bench: segBench[s].map(i => players[i]),
      gkName: players[gkPerSeg[s]],
      duration: durs[s], label: `H${half} ${start}–${elapsed}`,
      half, htBefore: isHT, subBefore: s > 0, edited: false,
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Apply a manual player swap within a segment
// ---------------------------------------------------------------------------

/**
 * Returns a new segment object with the two selected players swapped.
 * from / to are either { type:'pos', pos, name } or { type:'bench', name }.
 */
export function applySwap(segment, { from, to }) {
  const seg  = structuredClone(segment);
  seg.edited = true;

  const nameA = from.type === 'pos' ? seg.assignment[from.pos] : from.name;
  const nameB = to.type   === 'pos' ? seg.assignment[to.pos]   : to.name;

  if (from.type === 'pos' && to.type === 'pos') {
    seg.assignment[from.pos] = nameB;
    seg.assignment[to.pos]   = nameA;
  } else if (from.type === 'bench' && to.type === 'bench') {
    const ia = seg.bench.indexOf(from.name);
    const ib = seg.bench.indexOf(to.name);
    if (ia !== -1) seg.bench[ia] = nameB;
    if (ib !== -1) seg.bench[ib] = nameA;
  } else if (from.type === 'pos' && to.type === 'bench') {
    const ib = seg.bench.indexOf(to.name);
    if (ib !== -1) seg.bench[ib] = nameA;
    seg.assignment[from.pos] = nameB;
    seg.bench = seg.bench.filter(n => n !== null);
  } else {
    // bench → pos
    const ia = seg.bench.indexOf(from.name);
    if (ia !== -1) seg.bench[ia] = nameB;
    seg.assignment[to.pos] = nameA;
  }

  seg.gkName = seg.assignment.GK;
  return seg;
}

// ---------------------------------------------------------------------------
// Mid-segment split (emergency / manual substitution)
// ---------------------------------------------------------------------------

/**
 * Splits an existing segment into two consecutive segments so that a manual
 * substitution can be applied at an arbitrary point within the period.
 *
 * segments       – Segment[]  the current (possibly already-split) segment array
 * segmentIndex   – number     index into `segments` of the segment to split
 * elapsedMinutes – number     minutes already played in this segment (> 0, < duration)
 *
 * Returns a NEW array with the target segment replaced by two segments:
 *
 *   Segment A ("the past")
 *     duration  = elapsedMinutes
 *     assignment / bench / gkName  — identical to the original
 *     locked    = true             — marks it as completed / uneditable
 *     edited    = original.edited
 *
 *   Segment B ("the future")
 *     duration  = original.duration − elapsedMinutes
 *     assignment / bench / gkName  — deep-copied from A (starting state for the
 *                                    upcoming swap the UI will apply via applySwap)
 *     subBefore = true             — signals a substitution precedes this segment
 *     locked    = false
 *     edited    = false
 *
 * All segments are re-indexed (segIdx) and re-labelled so that timeline math,
 * calcStats, and label display remain correct after the split.
 *
 * Throws if segmentIndex is out of range, elapsedMinutes is not strictly
 * between 0 and the segment's duration, or the segment is already locked.
 */
export function splitSegment(segments, segmentIndex, elapsedMinutes) {
  if (segmentIndex < 0 || segmentIndex >= segments.length) {
    throw new RangeError(`segmentIndex ${segmentIndex} is out of range (0–${segments.length - 1})`);
  }

  const orig = segments[segmentIndex];

  if (orig.locked) {
    throw new Error('Cannot split a locked (already-completed) segment');
  }
  if (elapsedMinutes <= 0 || elapsedMinutes >= orig.duration) {
    throw new RangeError(
      `elapsedMinutes must be between 1 and ${orig.duration - 1} (got ${elapsedMinutes})`
    );
  }

  const remainingMinutes = orig.duration - elapsedMinutes;

  // Segment A — the completed portion
  const segA = structuredClone(orig);
  segA.duration = elapsedMinutes;
  segA.locked   = true;

  // Segment B — the future portion (UI will apply the swap to this one)
  const segB = structuredClone(orig);
  segB.duration  = remainingMinutes;
  segB.subBefore = true;
  segB.htBefore  = false;   // HT already handled by segment A if applicable
  segB.locked    = false;
  segB.edited    = false;

  // Build the new array: everything before, A, B, everything after
  const result = [
    ...segments.slice(0, segmentIndex),
    segA,
    segB,
    ...segments.slice(segmentIndex + 1),
  ];

  // Re-index and re-label every segment so timeline stays consistent
  let elapsed = 0;
  result.forEach((seg, i) => {
    seg.segIdx = i;
    const start = elapsed;
    elapsed += seg.duration;
    seg.half  = start >= 25 ? 2 : 1;
    seg.label = `H${seg.half} ${start}–${elapsed}`;
  });

  return result;
}

// ---------------------------------------------------------------------------
// Statistics calculator
// ---------------------------------------------------------------------------

/**
 * Derives per-player statistics from a completed segment list.
 * Returns:
 *   minutesMap    – { playerName → totalMinutes }
 *   gkDutyMap     – { playerName → 1 if they played GK, else 0 }
 *   playerSchedule – { playerName → [pos or 'BENCH' per segment] }
 */
export function calcStats(segments, players) {
  const minutesMap  = Object.fromEntries(players.map(p => [p, 0]));
  const gkDutyMap   = Object.fromEntries(players.map(p => [p, 0]));

  segments.forEach(seg => {
    Object.values(seg.assignment).forEach(name => {
      if (name) minutesMap[name] = (minutesMap[name] || 0) + seg.duration;
    });
  });

  players.forEach(p => {
    if (segments.some(seg => seg.assignment.GK === p)) gkDutyMap[p] = 1;
  });

  const playerSchedule = Object.fromEntries(players.map(p => [p,
    segments.map(seg => {
      const entry = Object.entries(seg.assignment).find(([, name]) => name === p);
      return entry ? entry[0] : (seg.bench.includes(p) ? 'BENCH' : null);
    }),
  ]));

  return { minutesMap, gkDutyMap, playerSchedule };
}
