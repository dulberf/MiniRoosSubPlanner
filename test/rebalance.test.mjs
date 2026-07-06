/**
 * Tests for ISSUES.md Issues 1 & 2 (Session 11).
 *
 * Issue 1: a manual field↔bench swap must rebalance the rest of the game —
 * previously future segments kept their generate-time bench lists, so the
 * player the coach had just rested was benched a second time while whoever
 * stayed on never rested (Gwandelen r8: Grace & Gen 20 min, three players 50).
 *
 * Issue 2: orderPlayersForGame must read real bench minutes from saved
 * segments, not attribute template weights by index into game.players.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSchedule, applySwap, orderPlayersForGame, buildBenchMinuteWeights } from '../src/scheduler.js';
import { rebalanceRemainder } from '../src/replan.js';

const PLAYERS = ['Grace', 'Maddy', 'Clara', 'Cara', 'Luella', 'Lyla',
                 'Imogen', 'Ivy', 'Noa', 'Gen', 'Ellery', 'Avahna'];

function minutesFor(segments, players) {
  const mins = Object.fromEntries(players.map(p => [p, 0]));
  segments.forEach(s => {
    Object.values(s.assignment).forEach(n => { if (n) mins[n] += s.duration; });
  });
  return mins;
}

function benchCounts(segments, players) {
  const counts = Object.fromEntries(players.map(p => [p, 0]));
  segments.forEach(s => s.bench.forEach(n => { if (n) counts[n]++; }));
  return counts;
}

function assertInvariants(segments, players) {
  segments.forEach((s, i) => {
    const onField = Object.values(s.assignment).filter(Boolean);
    const all = [...onField, ...s.bench.filter(Boolean)];
    const dupes = all.filter((n, k) => all.indexOf(n) !== k);
    assert.deepEqual(dupes, [], `seg ${i}: duplicate players ${dupes}`);
    players.forEach(p => assert.ok(all.includes(p), `seg ${i}: ${p} vanished`));
    assert.equal(onField.length, 9, `seg ${i}: field has ${onField.length} players`);
  });
}

test('mid-game bench swap + rebalance: everyone still rests exactly once', () => {
  const segs = buildSchedule(PLAYERS, { gkH1: 'Lyla', gkH2: 'Clara' });

  // Coach action in seg 1: bench an on-field player who has NOT yet rested,
  // in place of a scheduled-bench player. Two changeovers remain, so a fair
  // outcome (12 bench slots, 12 players, one rest each) is achievable and the
  // rebalancer must find it. The old code left the future benches baked,
  // producing a 25 vs 50 min split (Gwandelen r8 pattern).
  const seg1 = segs[1];
  const restedSeg0 = new Set(segs[0].bench);
  const [pos, fieldPlayer] = Object.entries(seg1.assignment)
    .find(([p, n]) => p !== 'GK' && n && !seg1.bench.includes(n) && !restedSeg0.has(n));
  const benchPlayer = seg1.bench[1];
  const edited = [...segs];
  edited[1] = applySwap(seg1, {
    from: { type: 'pos', pos, name: fieldPlayer },
    to:   { type: 'bench', name: benchPlayer },
  });

  const rebalanced = rebalanceRemainder({ segments: edited, fromSegIdx: 1 });

  assertInvariants(rebalanced, PLAYERS);
  assert.equal(rebalanced.reduce((t, s) => t + s.duration, 0), 50);

  // The core of Issue 1: every player rests exactly once, nobody plays 50
  // while another player is double-benched.
  const counts = benchCounts(rebalanced, PLAYERS);
  PLAYERS.forEach(p => assert.equal(counts[p], 1,
    `${p} benched ${counts[p]}× — ${JSON.stringify(counts)}`));

  const mins = minutesFor(rebalanced, PLAYERS);
  const spread = Math.max(...Object.values(mins)) - Math.min(...Object.values(mins));
  assert.ok(spread <= 10, `minutes spread ${spread} > 10: ${JSON.stringify(mins)}`);
});

test('late edit (one changeover left): rebalance still finds the optimal outcome', () => {
  const segs = buildSchedule(PLAYERS, { gkH1: 'Lyla', gkH2: 'Clara' });

  // Coach benches a never-rested player at the FINAL changeover window
  // (seg 2 of 4). Only 3 bench slots remain for 4 equally-played players, so
  // one player on 50 min is unavoidable; spread 20 is the provable optimum
  // here. (Picking a never-rested player keeps the scenario deterministic —
  // the position shuffle randomises who sits where, and benching an
  // already-rested player pushes the optimal floor to 25.) The old code
  // produced 25+ with arbitrary victims and inconsistent segments.
  const seg2 = segs[2];
  const restedEarlier = new Set([...segs[0].bench, ...segs[1].bench]);
  const [pos, fieldPlayer] = Object.entries(seg2.assignment)
    .find(([p, n]) => p !== 'GK' && n && !seg2.bench.includes(n) && !restedEarlier.has(n));
  const edited = [...segs];
  edited[2] = applySwap(seg2, {
    from: { type: 'pos', pos, name: fieldPlayer },
    to:   { type: 'bench', name: seg2.bench[1] },
  });

  const rebalanced = rebalanceRemainder({ segments: edited, fromSegIdx: 2 });

  assertInvariants(rebalanced, PLAYERS);
  assert.equal(rebalanced.reduce((t, s) => t + s.duration, 0), 50);
  const mins = minutesFor(rebalanced, PLAYERS);
  const spread = Math.max(...Object.values(mins)) - Math.min(...Object.values(mins));
  assert.ok(spread <= 20, `minutes spread ${spread} > 20: ${JSON.stringify(mins)}`);
});

test('rebalance preserves the edited segment, durations, labels and GK plan', () => {
  const segs = buildSchedule(PLAYERS, { gkH1: 'Lyla', gkH2: 'Clara' });
  const seg2 = segs[2];
  const [pos, fieldPlayer] = Object.entries(seg2.assignment)
    .find(([p, n]) => p !== 'GK' && n && !seg2.bench.includes(n));
  const edited = [...segs];
  edited[2] = applySwap(seg2, {
    from: { type: 'pos', pos, name: fieldPlayer },
    to:   { type: 'bench', name: seg2.bench[0] },
  });

  const rebalanced = rebalanceRemainder({ segments: edited, fromSegIdx: 2 });

  // Edited segment untouched
  assert.deepEqual(rebalanced[2].assignment, edited[2].assignment);
  assert.deepEqual(rebalanced[2].bench, edited[2].bench);
  // Boundaries + GK plan preserved on every segment
  rebalanced.forEach((s, i) => {
    assert.equal(s.duration, segs[i].duration, `seg ${i} duration changed`);
    assert.equal(s.label, segs[i].label, `seg ${i} label changed`);
    assert.equal(s.half, segs[i].half, `seg ${i} half changed`);
    assert.equal(s.htBefore, segs[i].htBefore, `seg ${i} htBefore changed`);
    assert.equal(s.assignment.GK, segs[i].assignment.GK, `seg ${i} GK changed`);
  });
});

test('an H1 edit rebalances H2 too, across the half-time boundary', () => {
  const segs = buildSchedule(PLAYERS, { gkH1: 'Lyla', gkH2: 'Clara' });

  // Edit segment 0: bench an on-field player for the opening segment
  const seg0 = segs[0];
  const [pos, fieldPlayer] = Object.entries(seg0.assignment)
    .find(([p, n]) => p !== 'GK' && n && !seg0.bench.includes(n));
  const edited = [...segs];
  edited[0] = applySwap(seg0, {
    from: { type: 'pos', pos, name: fieldPlayer },
    to:   { type: 'bench', name: seg0.bench[0] },
  });

  const rebalanced = rebalanceRemainder({ segments: edited, fromSegIdx: 0 });

  assertInvariants(rebalanced, PLAYERS);
  // Everyone rests exactly once — including Clara, the H2 GK, whose only
  // rest window is H1 (the forced-rest lookahead must catch her).
  const counts = benchCounts(rebalanced, PLAYERS);
  PLAYERS.forEach(p => assert.equal(counts[p], 1,
    `${p} benched ${counts[p]}× — ${JSON.stringify(counts)}`));
  const mins = minutesFor(rebalanced, PLAYERS);
  const spread = Math.max(...Object.values(mins)) - Math.min(...Object.values(mins));
  assert.ok(spread <= 10, `minutes spread ${spread} > 10: ${JSON.stringify(mins)}`);
  // H2 GK survives the rebalance
  assert.equal(rebalanced[2].assignment.GK, 'Clara');
  assert.equal(rebalanced[3].assignment.GK, 'Clara');
});

test('rebalance is a no-op when there is no bench or no later segment', () => {
  const nine = PLAYERS.slice(0, 9);
  const segs9 = buildSchedule(nine, { gkH1: nine[0], gkH2: nine[1] });
  assert.equal(rebalanceRemainder({ segments: segs9, fromSegIdx: 0 }), segs9);

  const segs12 = buildSchedule(PLAYERS, { gkH1: 'Lyla', gkH2: 'Clara' });
  assert.equal(rebalanceRemainder({ segments: segs12, fromSegIdx: 3 }), segs12);
});

test('orderPlayersForGame reads real bench minutes from segments (Issue 2)', () => {
  // 11 players. History: one game where MostBenched sat out 30 real minutes
  // and NeverBenched sat out 0 — but the game.players ORDER says the opposite
  // story (MostBenched first, NeverBenched last), which the old index-based
  // attribution would misread.
  const players = ['GKa', 'GKb', 'MostBenched', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'NeverBenched'];
  const mkSeg = (bench, duration, half) => ({
    segIdx: 0, duration, half, htBefore: false, subBefore: false, edited: false,
    bench,
    assignment: Object.fromEntries(
      ['GK', 'LB', 'CB', 'RB', 'LM', 'CM', 'RM', 'LF', 'RF']
        .map((p, i) => [p, players.filter(n => !bench.includes(n))[i] ?? null])
    ),
  });
  const history = [{
    players: ['MostBenched', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'NeverBenched', 'GKa', 'GKb'],
    segments: [
      mkSeg(['MostBenched', 'P4'], 15, 1),
      mkSeg(['MostBenched', 'P5'], 15, 1),
      mkSeg(['P6', 'P7'], 20, 2),
    ],
  }];

  const ordered = orderPlayersForGame(players, history, false);
  const weights = buildBenchMinuteWeights(players.length);

  // GK slots (0 and the 2nd-GK slot) go to never-GK players by stint order;
  // among the outfield fill, the genuinely most-benched player must land in a
  // slot with no more upcoming bench time than the never-benched player.
  const wOf = p => weights[ordered.indexOf(p)] || 0;
  assert.ok(wOf('MostBenched') <= wOf('NeverBenched'),
    `MostBenched got slot weight ${wOf('MostBenched')}, NeverBenched got ${wOf('NeverBenched')}`);
  assert.equal(ordered.length, players.length);
});
