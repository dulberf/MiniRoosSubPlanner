/**
 * Regression tests for the weekend mis-rotation bugs.
 *
 *  1. A time-anchored emergency sub (split → swap the rest of the period) must
 *     keep the played minutes LOCKED and the whole-game minutes spread bounded.
 *     The old clock-stopped path applied the sub to the entire period, leaving
 *     the H1 keeper on the full 50 and another player on 25.
 *  2. replan.scaleTemplate must never emit 0- or negative-minute segments on a
 *     short remainder, and the rebuilt game must still total 50 minutes.
 *
 * Run: npm test   (node --test)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSchedule, splitSegment, applySwap, calcStats } from '../src/scheduler.js';
import { replanFromRosterChange } from '../src/replan.js';

// Deterministic shuffle so buildSchedule is reproducible across runs.
function seedRandom(seed) {
  let s = seed;
  Math.random = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Mirror of App.jsx handleSwap forward-propagation (positions only; bench
// membership of later segments is preserved).
function handleSwap(segments, segIdx, swapAction) {
  const updated = [...segments];
  updated[segIdx] = applySwap(segments[segIdx], swapAction);
  for (let i = segIdx + 1; i < updated.length; i++) {
    const prevSeg = updated[i - 1];
    const currSeg = updated[i];
    if (currSeg.htBefore) break;
    const prevBenchSet = new Set(prevSeg.bench);
    const currBenchSet = new Set(currSeg.bench);
    const newAssignment = { ...prevSeg.assignment };
    const vacated = [];
    Object.entries(newAssignment).forEach(([pos, name]) => {
      if (currBenchSet.has(name)) { delete newAssignment[pos]; vacated.push(pos); }
    });
    const incoming = Object.values(currSeg.assignment).filter(n => n && prevBenchSet.has(n));
    incoming.forEach((name, idx) => { if (vacated[idx] !== undefined) newAssignment[vacated[idx]] = name; });
    updated[i] = { ...currSeg, assignment: newAssignment, gkName: newAssignment.GK || currSeg.gkName, edited: true };
  }
  return updated;
}

const PLAYERS = ['Ivy', 'Imogen', 'Luella', 'Avahna', 'Ellery', 'Cara', 'Gen', 'Lyla', 'Clara', 'Grace', 'Maddy', 'Noa'];

function spread(segs, players) {
  const m = Object.values(calcStats(segs, players).minutesMap);
  return Math.max(...m) - Math.min(...m);
}

test('time-anchored emergency sub locks the past and keeps minutes balanced', () => {
  seedRandom(12345);
  const base = buildSchedule(PLAYERS, { gkH1: 'Ivy', gkH2: 'Avahna' });
  const firstH2 = base.findIndex(s => s.half === 2);

  // Coach brings the rested keeper back on for an on-field player, mid-period.
  const restedKeeper = base[firstH2].bench[0];
  const [pos, name] = Object.entries(base[firstH2].assignment).find(([p]) => p !== 'GK');
  const swap = { from: { type: 'bench', name: restedKeeper }, to: { type: 'pos', pos, name } };

  // Split at 5 min (clock-running fast path OR the new manual prompt), then swap
  // only the future part.
  const split = splitSegment(base, firstH2, 5);
  const after = handleSwap(split, firstH2 + 1, swap);

  // The locked segment (the played first 5 min) is untouched.
  assert.equal(after[firstH2].locked, true);
  assert.deepEqual(after[firstH2].bench, base[firstH2].bench);

  // Durations still total 50 and the spread stays in the normal band.
  assert.equal(after.reduce((a, s) => a + s.duration, 0), 50);
  assert.ok(spread(after, PLAYERS) <= 10, `spread ${spread(after, PLAYERS)} should stay <= 10`);
});

test('clock-stopped whole-period edit is the unbalanced path we now guard against', () => {
  // Documents the OLD behaviour: applying the same sub to the entire period
  // (no split) blows the spread out to 20. This is what the time prompt prevents.
  seedRandom(12345);
  const base = buildSchedule(PLAYERS, { gkH1: 'Ivy', gkH2: 'Avahna' });
  const firstH2 = base.findIndex(s => s.half === 2);
  const restedKeeper = base[firstH2].bench[0];
  const [pos, name] = Object.entries(base[firstH2].assignment).find(([p]) => p !== 'GK');
  const swap = { from: { type: 'bench', name: restedKeeper }, to: { type: 'pos', pos, name } };

  const wholePeriod = handleSwap(base, firstH2, swap);
  assert.ok(spread(wholePeriod, PLAYERS) >= 20, 'whole-period edit is the bad case');
});

test('replan never produces 0- or negative-minute segments on a short remainder', () => {
  // 9 players (no bench) → a late arrival at minute 22 leaves only 3 minutes of
  // H1, fewer than the 10-player template has segments. The old scaleTemplate
  // emitted [1,1,1,0,0]; the fix must keep every segment >= 1 and total 50.
  const players9 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
  const segs = buildSchedule(players9, { gkH1: 'A', gkH2: 'B' });

  const { newSegments } = replanFromRosterChange(
    { segments: segs, players: players9, currentSegIdx: 0, elapsedMinutes: 22, gkH1: 'A', gkH2: 'B' },
    { type: 'add', name: 'J' },
  );

  assert.ok(newSegments.every(s => s.duration >= 1), 'no zero/negative durations');
  assert.equal(newSegments.reduce((a, s) => a + s.duration, 0), 50, 'rebuilt game totals 50 min');
});
