/**
 * Tests for nextAppearance (Session 13): the schedule lookahead behind the
 * bench rail's "BACK ON" list and the player sheet's "you go back on at" card.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSchedule, nextAppearance } from '../src/scheduler.js';

const PLAYERS = ['Grace', 'Maddy', 'Clara', 'Cara', 'Luella', 'Lyla',
                 'Imogen', 'Ivy', 'Noa', 'Gen', 'Ellery', 'Avahna'];

function build() {
  return buildSchedule(PLAYERS, { gkH1: 'Lyla', gkH2: 'Clara' });
}

test('nextAppearance returns the kickoff-relative minute a benched player returns', () => {
  const segs = build();

  // Take someone benched in segment 0 — they must come back on at some point.
  const benched = segs[0].bench[0];
  const got = nextAppearance(segs, 0, benched);

  assert.ok(got, `${benched} is benched in P1 but never reappears`);
  assert.equal(got.minute, segs[0].duration,
    'first possible return is the minute segment 1 starts');
  assert.ok(segs[got.segIdx].assignment[got.pos] === benched,
    'reported position must actually hold that player in the reported segment');
});

test('the reported minute equals the sum of durations before that segment', () => {
  const segs = build();
  const benched = segs[0].bench[0];
  const got = nextAppearance(segs, 0, benched);

  const expected = segs.slice(0, got.segIdx).reduce((t, s) => t + s.duration, 0);
  assert.equal(got.minute, expected);
});

test('nextAppearance skips segments where the player is still benched', () => {
  const segs = build();

  // Craft a case: bench someone across two consecutive segments.
  const cloned = structuredClone(segs);
  const victim = cloned[1].bench[0];
  const pos = Object.entries(cloned[2].assignment).find(([, n]) => n === victim)?.[0];
  if (pos) {
    // Push them off the field in segment 2 as well, swapping with a bench player.
    const standIn = cloned[2].bench[0];
    cloned[2].assignment[pos] = standIn;
    cloned[2].bench[0] = victim;
  }

  const got = nextAppearance(cloned, 1, victim);
  if (got) {
    assert.ok(got.segIdx >= 3, `expected a return no earlier than P4, got P${got.segIdx + 1}`);
    assert.ok(!cloned[2].bench.includes(cloned[got.segIdx].assignment[got.pos]) ||
      cloned[got.segIdx].assignment[got.pos] === victim);
  }
});

test('nextAppearance returns null when the player never comes back on', () => {
  const segs = build();
  const last = segs.length - 1;
  // Nothing follows the final segment, so nobody has a next appearance.
  const anyone = Object.values(segs[last].assignment).find(Boolean);
  assert.equal(nextAppearance(segs, last, anyone), null);

  // An unknown name never appears either.
  assert.equal(nextAppearance(segs, 0, 'Nobody At All'), null);
});

test('nextAppearance is defensive about bad input', () => {
  assert.equal(nextAppearance(null, 0, 'Grace'), null);
  assert.equal(nextAppearance(build(), 0, ''), null);
});
