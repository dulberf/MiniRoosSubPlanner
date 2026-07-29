/**
 * Tests for rankByGKFairness (Session 16): the ordering behind the setup
 * screen's goalkeeper chip rows.
 *
 * The row's heading promises "longest since a turn in goal, first". This is
 * NOT orderPlayersForGame's return value — that ranks only its first two slots
 * by GK fairness and fills the rest by bench-minute fairness, so chips 3 and 4
 * would be ordered on a different axis than the label claims.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { rankByGKFairness, orderPlayersForGame, getSecondGKSlot } from '../src/scheduler.js';

const PLAYERS = ['Grace', 'Maddy', 'Clara', 'Cara', 'Luella', 'Lyla',
                 'Imogen', 'Ivy', 'Noa', 'Gen', 'Ellery', 'Avahna'];

// A saved game is only read for segment.half + assignment.GK, so a stub with
// those two fields is a faithful fixture.
function game(h1GK, h2GK) {
  return {
    segments: [
      { half: 1, duration: 25, assignment: { GK: h1GK }, bench: [] },
      { half: 2, duration: 25, assignment: { GK: h2GK }, bench: [] },
    ],
  };
}

test('never-been-GK players rank ahead of everyone who has', () => {
  const history = [game('Grace', 'Maddy'), game('Clara', 'Cara')];
  const ranked = rankByGKFairness(PLAYERS, history);

  const kept = new Set(['Grace', 'Maddy', 'Clara', 'Cara']);
  const firstKeeperAt = ranked.findIndex(p => kept.has(p));

  assert.equal(firstKeeperAt, PLAYERS.length - kept.size,
    'all four who have kept goal must sit at the back of the list');
});

test('among players with equal stints, longest-since-last-turn comes first', () => {
  // Everyone keeps goal exactly once, in a known order across six games.
  const order = ['Grace', 'Maddy', 'Clara', 'Cara', 'Luella', 'Lyla',
                 'Imogen', 'Ivy', 'Noa', 'Gen', 'Ellery', 'Avahna'];
  const history = [];
  for (let i = 0; i < order.length; i += 2) history.push(game(order[i], order[i + 1]));

  const ranked = rankByGKFairness(PLAYERS, history);

  assert.deepEqual(ranked, order,
    'with one stint each, the ranking is simply oldest turn first');
});

test('a second stint pushes a player behind everyone on one', () => {
  const history = [game('Grace', 'Maddy'), game('Grace', 'Clara')];
  const ranked = rankByGKFairness(PLAYERS, history);

  assert.equal(ranked[ranked.length - 1], 'Grace', 'two stints = last in line');
  assert.ok(ranked.indexOf('Maddy') < ranked.indexOf('Grace'));
  assert.ok(ranked.indexOf('Clara') < ranked.indexOf('Grace'));
});

test('the first two ranked players match orderPlayersForGame\'s GK picks', () => {
  const history = [game('Grace', 'Maddy'), game('Clara', 'Cara'), game('Luella', 'Lyla')];
  const ranked   = rankByGKFairness(PLAYERS, history);
  const ordered  = orderPlayersForGame(PLAYERS, history, false);
  const slot     = getSecondGKSlot(PLAYERS.length);

  assert.equal(ordered[0], ranked[0], 'H1 keeper is the most overdue player');
  assert.equal(ordered[slot], ranked[1], 'H2 keeper is the next most overdue');
});

test('the tail of the two orderings genuinely differs — this is why the helper exists', () => {
  // Bench minutes, not GK history, decide orderPlayersForGame's later slots.
  const history = [
    { segments: [
      { half: 1, duration: 25, assignment: { GK: 'Grace' }, bench: ['Avahna', 'Ellery'] },
      { half: 2, duration: 25, assignment: { GK: 'Maddy' }, bench: ['Avahna', 'Ellery'] },
    ] },
  ];
  const ranked  = rankByGKFairness(PLAYERS, history);
  const ordered = orderPlayersForGame(PLAYERS, history, false);

  // Same membership either way — no player is dropped or duplicated.
  assert.deepEqual([...ranked].sort(), [...PLAYERS].sort());
  assert.deepEqual([...ordered].sort(), [...PLAYERS].sort());
  assert.notDeepEqual(ordered, ranked,
    'if these ever coincide the chip row could use either — they do not');
});

test('is safe with no history and with squad sizes the scheduler rejects', () => {
  assert.deepEqual(rankByGKFairness(PLAYERS, []), PLAYERS);
  assert.deepEqual(rankByGKFairness(PLAYERS, null), PLAYERS);
  assert.deepEqual(rankByGKFairness([], [game('Grace', 'Maddy')]), []);
  assert.deepEqual(rankByGKFairness(['Solo'], [game('Grace', 'Maddy')]), ['Solo']);
});

test('does not mutate the input array', () => {
  const input = [...PLAYERS];
  rankByGKFairness(input, [game('Avahna', 'Ellery')]);
  assert.deepEqual(input, PLAYERS, 'the caller passes React state — never sort in place');
});
