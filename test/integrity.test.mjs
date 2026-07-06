/**
 * Tests for ISSUES.md Issue 4 (Session 12): lineup integrity guards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSchedule, findLineupIssue, findMembershipDrift } from '../src/scheduler.js';

const PLAYERS = ['Grace', 'Maddy', 'Clara', 'Cara', 'Luella', 'Lyla',
                 'Imogen', 'Ivy', 'Noa', 'Gen', 'Ellery', 'Avahna'];

test('findLineupIssue passes a clean schedule', () => {
  const segs = buildSchedule(PLAYERS, { gkH1: 'Lyla', gkH2: 'Clara' });
  assert.equal(findLineupIssue(segs), null);
});

test('findLineupIssue flags a player appearing twice in a segment', () => {
  const segs = buildSchedule(PLAYERS, { gkH1: 'Lyla', gkH2: 'Clara' });
  const broken = structuredClone(segs);
  // Corrupt: put an on-field player onto the bench as well
  const onField = Object.values(broken[1].assignment).find(n => n && !broken[1].bench.includes(n));
  broken[1].bench[0] = onField;
  const issue = findLineupIssue(broken);
  assert.ok(issue && issue.includes(onField), `expected issue naming ${onField}, got: ${issue}`);
});

test('findMembershipDrift flags a vanished player, passes a pure move', () => {
  const segs = buildSchedule(PLAYERS, { gkH1: 'Lyla', gkH2: 'Clara' });
  const before = segs[1];

  // Pure move (swap two players between field and bench) — no drift
  const moved = structuredClone(before);
  const [pos, fieldName] = Object.entries(moved.assignment).find(([p, n]) => p !== 'GK' && n && !moved.bench.includes(n));
  const benchName = moved.bench[0];
  moved.assignment[pos] = benchName;
  moved.bench[0] = fieldName;
  assert.equal(findMembershipDrift(before, moved), null);

  // Drop a player entirely — drift
  const dropped = structuredClone(before);
  dropped.bench = dropped.bench.slice(1);
  const gone = before.bench[0];
  const issue = findMembershipDrift(before, dropped);
  assert.ok(issue && issue.includes(gone), `expected issue naming ${gone}, got: ${issue}`);
});
