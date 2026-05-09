/**
 * replan.js — Mid-game roster change handler.
 *
 * Handles two roster events that can happen during a live game:
 *   • Late arrival: a player joins after kickoff
 *   • Player out:   a player leaves due to injury (no return)
 *
 * Approach: split the active segment at the live clock time (segment A is
 * locked / preserved with accurate minutes), then rebuild the rest of the
 * game for the new squad size. Equal share across the remainder — no catch-up
 * weighting for late arrivals.
 *
 * Reuses splitSegment + getSegmentConfig from scheduler.js. All other logic
 * lives here so scheduler.js does not need to change. Every function in this
 * module is pure: inputs are not mutated, outputs are fresh structures.
 */

import { splitSegment, getSegmentConfig } from './scheduler.js';
import { OUTFIELD } from './constants.js';

// ---------------------------------------------------------------------------
// CONSTANTS — match scheduler.js conventions
// ---------------------------------------------------------------------------

const HALF_MIN   = 25;   // length of one half in minutes
const FIELD_SIZE = 9;    // GK + 8 outfield positions
const MIN_SQUAD  = 6;    // existing app accepts 6+ at kickoff
const MAX_SQUAD  = 12;   // existing app caps at 12 at kickoff

// Below this many minutes remaining we don't try to rotate — single block.
const MIN_ROTATION_MIN = 2;

// ---------------------------------------------------------------------------
// PURE HELPERS
// ---------------------------------------------------------------------------

/**
 * Sum the durations of segments[from..to-1]. Half-open range like Array.slice.
 */
function sumDuration(segments, from, to) {
  let total = 0;
  for (let i = from; i < to; i++) total += segments[i].duration;
  return total;
}

/**
 * Cumulative minutes per player across the locked portion of the schedule.
 * Reads segments[0..lockedThroughIdx] (inclusive). Players not on the field
 * in any of those segments come back as 0.
 */
function computeCumulativeMinutes(segments, lockedThroughIdx, players) {
  const result = Object.fromEntries(players.map(p => [p, 0]));
  for (let i = 0; i <= lockedThroughIdx; i++) {
    const seg = segments[i];
    if (!seg) continue;
    Object.values(seg.assignment).forEach(name => {
      if (name && result[name] !== undefined) result[name] += seg.duration;
    });
  }
  return result;
}

/**
 * Track each player's most recent outfield position across the given segments.
 * Used to give returning players positional continuity (matches scheduler.js).
 * GK is never recorded — it's tracked separately.
 */
function buildLastOutfieldPos(segments) {
  const last = {};
  segments.forEach(seg => {
    if (!seg?.assignment) return;
    Object.entries(seg.assignment).forEach(([pos, name]) => {
      if (name && pos !== 'GK') last[name] = pos;
    });
  });
  return last;
}

/**
 * Distribute targetMin across nSegs as integer minutes, as evenly as possible.
 * Earlier segments absorb +1 if there's a remainder.
 */
function distributeEvenly(nSegs, targetMin) {
  if (nSegs <= 0 || targetMin <= 0) return [];
  const base = Math.floor(targetMin / nSegs);
  const extra = targetMin - base * nSegs;
  return Array.from({ length: nSegs }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Scale a standard duration template to fit targetMin total minutes.
 * Rounds each entry; absorbs rounding error in the last segment. Falls back
 * to even distribution if rounding produces a non-positive last segment.
 */
function scaleTemplate(template, targetMin) {
  if (!template || template.length === 0 || targetMin <= 0) return [];
  if (template.length === 1) return [targetMin];

  const sum = template.reduce((a, b) => a + b, 0);
  if (sum === targetMin) return [...template];

  const scaled = template.map(d => Math.max(1, Math.round((d * targetMin) / sum)));
  const scaledSum = scaled.reduce((a, b) => a + b, 0);
  scaled[scaled.length - 1] += targetMin - scaledSum;

  if (scaled[scaled.length - 1] <= 0) {
    return distributeEvenly(template.length, targetMin);
  }
  return scaled;
}

/**
 * Slice the standard segment template for one half of the standard schedule.
 * For ≤9 players: a single block. For 10–12: the H1 or H2 portion of
 * getSegmentConfig.durs split at htAfterSeg.
 */
function getHalfTemplate(squadSize, halfNumber) {
  if (squadSize < FIELD_SIZE) {
    // sub-9 (injury dropped us below the standard squad) — single block
    return [HALF_MIN];
  }
  if (squadSize === FIELD_SIZE) return [HALF_MIN];

  const cfg = getSegmentConfig(squadSize);
  if (!cfg) return null;
  const { durs, htAfterSeg } = cfg;
  if (halfNumber === 1) return durs.slice(0, htAfterSeg + 1);
  return durs.slice(htAfterSeg + 1);
}

/**
 * Return an assignment object that always contains GK + every OUTFIELD key,
 * with missing entries set to null. Matches the shape produced by buildSchedule.
 */
function fillAssignment(partial) {
  const out = { GK: partial.GK ?? null };
  OUTFIELD.forEach(pos => { out[pos] = partial[pos] ?? null; });
  return out;
}

/**
 * Pick a default replacement when an on-field player is removed.
 * Returns the bench player with the LEAST cumulative minutes (most due back on).
 * Returns null if the bench is empty.
 */
function pickReplacement(benchNames, cumulativeMinutes) {
  if (!benchNames || benchNames.length === 0) return null;
  return [...benchNames].sort((a, b) =>
    (cumulativeMinutes[a] || 0) - (cumulativeMinutes[b] || 0)
  )[0];
}

/**
 * Decide the H2 GK after a roster change in H1.
 * Keeps the original pick when still available; otherwise picks any non-H1-GK
 * player. Pushes a warning if a fallback was used.
 */
function chooseH2GK({ originalGkH2, newPlayers, gkH1Name, warnings }) {
  if (originalGkH2 && newPlayers.includes(originalGkH2) && originalGkH2 !== gkH1Name) {
    return originalGkH2;
  }
  const fallback = newPlayers.find(p => p !== gkH1Name) || gkH1Name;
  if (originalGkH2 && !newPlayers.includes(originalGkH2)) {
    warnings.push(`H2 goalkeeper changed to ${fallback} (original was removed)`);
  } else if (originalGkH2 && originalGkH2 === gkH1Name) {
    warnings.push(`H2 goalkeeper set to ${fallback}`);
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// REMAINDER BUILDERS
// ---------------------------------------------------------------------------

/**
 * Re-index segIdx and re-label timeline for a stitched segment array, mirroring
 * the labelling performed by splitSegment in scheduler.js.
 */
function reindexAndLabel(segments) {
  let elapsed = 0;
  return segments.map((seg, i) => {
    const start = elapsed;
    elapsed += seg.duration;
    const half = start >= HALF_MIN ? 2 : 1;
    return {
      ...seg,
      segIdx: i,
      half,
      label: `H${half} ${start}–${elapsed}`,
    };
  });
}

/**
 * Build the segments for the remainder of one half.
 *
 * Inputs:
 *   players          – the new (post-event) full active roster
 *   cumulativeMinutes – minutes-per-player accumulated in locked segments
 *   onFieldNow       – { pos: name } starting state for the first remainder segment
 *   benchNow         – [name]      starting bench for the first remainder segment
 *   currentGK        – name of the GK that holds the goal for this half
 *   remainingMinutes – minutes left in this half after the split
 *   halfNumber       – 1 or 2
 *   priorSegments    – locked segments (used to seed lastOutfieldPos)
 *
 * Returns Segment[] (no segIdx / label set — caller does that via reindexAndLabel).
 */
function buildRemainderForHalf({
  players,
  cumulativeMinutes,
  onFieldNow,
  benchNow,
  currentGK,
  remainingMinutes,
  halfNumber,
  priorSegments,
}) {
  if (remainingMinutes <= 0) return [];

  const squadSize = players.length;
  const benchSize = Math.max(0, squadSize - FIELD_SIZE);

  // No bench (≤9 players) → single segment for the rest of the half
  if (benchSize === 0 || remainingMinutes < MIN_ROTATION_MIN) {
    return [{
      segIdx: 0,
      assignment: fillAssignment(onFieldNow),
      bench: [...benchNow],
      gkName: currentGK,
      duration: remainingMinutes,
      label: '',
      half: halfNumber,
      htBefore: false,
      subBefore: false,
      edited: false,
    }];
  }

  // Get and scale the standard duration template for the new squad size
  const standardTemplate = getHalfTemplate(squadSize, halfNumber);
  if (!standardTemplate || standardTemplate.length === 0) {
    // Squad size unsupported — fall back to single block
    return [{
      segIdx: 0,
      assignment: fillAssignment(onFieldNow),
      bench: [...benchNow],
      gkName: currentGK,
      duration: remainingMinutes,
      label: '',
      half: halfNumber,
      htBefore: false,
      subBefore: false,
      edited: false,
    }];
  }
  const scaledDurs = scaleTemplate(standardTemplate, remainingMinutes);
  if (scaledDurs.length === 0) return [];

  // Bench rotation pool — order so segment 0's "computed" bench equals benchNow.
  // Pool layout: [...benchNow, ...currentNonGKField]. Cycling through it gives
  // each player roughly equal bench time across the remainder.
  const nonGKFieldNames = OUTFIELD
    .map(pos => onFieldNow[pos])
    .filter(name => name && name !== currentGK);
  const cyclePool = [...benchNow, ...nonGKFieldNames];

  // De-duplicate while preserving order (defensive: shouldn't happen)
  const seen = new Set();
  const pool = cyclePool.filter(n => {
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });

  const lastOutfieldPos = buildLastOutfieldPos(priorSegments);

  const segments = [];
  let prevField = fillAssignment(onFieldNow);
  let prevBench = [...benchNow];

  for (let s = 0; s < scaledDurs.length; s++) {
    if (s === 0) {
      segments.push({
        segIdx: 0,
        assignment: { ...prevField },
        bench: [...prevBench],
        gkName: currentGK,
        duration: scaledDurs[s],
        label: '',
        half: halfNumber,
        htBefore: false,
        subBefore: false,
        edited: false,
      });
      // Seed lastOutfieldPos from the starting state
      Object.entries(prevField).forEach(([pos, name]) => {
        if (name && pos !== 'GK') lastOutfieldPos[name] = pos;
      });
      continue;
    }

    // Compute next bench: next benchSize entries in the cycle
    const nextBench = [];
    for (let b = 0; b < benchSize; b++) {
      nextBench.push(pool[(s * benchSize + b) % pool.length]);
    }
    const nextBenchSet = new Set(nextBench);
    const prevBenchSet = new Set(prevBench);

    const comingOff = nextBench.filter(n => !prevBenchSet.has(n));
    const comingOn  = prevBench.filter(n => !nextBenchSet.has(n));

    // Build new field: start from prev, evict comingOff, slot in comingOn
    // preferring each player's last outfield position.
    const newField = { ...prevField };
    const vacated = [];
    Object.entries(newField).forEach(([pos, name]) => {
      if (pos === 'GK') return;
      if (comingOff.includes(name)) {
        newField[pos] = null;
        vacated.push(pos);
      }
    });

    const remainingVacant = new Set(vacated);
    const unmatched = [];
    comingOn.forEach(name => {
      const pref = lastOutfieldPos[name];
      if (pref && remainingVacant.has(pref)) {
        newField[pref] = name;
        remainingVacant.delete(pref);
      } else {
        unmatched.push(name);
      }
    });
    const leftoverPositions = [...remainingVacant];
    unmatched.forEach((name, i) => {
      if (leftoverPositions[i] !== undefined) {
        newField[leftoverPositions[i]] = name;
      }
    });

    // Update lastOutfieldPos from this segment's resulting field
    Object.entries(newField).forEach(([pos, name]) => {
      if (name && pos !== 'GK') lastOutfieldPos[name] = pos;
    });

    segments.push({
      segIdx: 0,
      assignment: fillAssignment(newField),
      bench: nextBench,
      gkName: currentGK,
      duration: scaledDurs[s],
      label: '',
      half: halfNumber,
      htBefore: false,
      subBefore: true,
      edited: false,
    });

    prevField = newField;
    prevBench = nextBench;
  }

  return segments;
}

/**
 * Build a fresh second half (when the event happened in H1).
 * Picks an opening lineup using cumulative minutes — players with the most
 * H1 minutes go to the bench first, so the late arrival gets early field time.
 * GK is fixed (passed in).
 */
function buildFreshHalf({
  players,
  cumulativeMinutes,
  gkName,
  remainingMinutes,
  halfNumber,
  priorSegments,
}) {
  if (remainingMinutes <= 0) return [];
  const squadSize = players.length;
  const benchSize = Math.max(0, squadSize - FIELD_SIZE);

  // Opening field: GK + 8 players with the LEAST cumulative minutes
  // (most rested → on field). Excludes the GK from the rest of the ordering.
  const nonGK = players.filter(p => p !== gkName);
  const ordered = [...nonGK].sort((a, b) =>
    (cumulativeMinutes[a] || 0) - (cumulativeMinutes[b] || 0)
  );
  const openingField = ordered.slice(0, FIELD_SIZE - 1); // 8 outfield slots
  const openingBench = ordered.slice(FIELD_SIZE - 1);

  // Place opening field players preferring their last outfield position
  const lastPos = buildLastOutfieldPos(priorSegments);
  const onFieldNow = { GK: gkName };
  const remainingPositions = new Set(OUTFIELD);
  const unplaced = [];
  openingField.forEach(name => {
    const pref = lastPos[name];
    if (pref && remainingPositions.has(pref)) {
      onFieldNow[pref] = name;
      remainingPositions.delete(pref);
    } else {
      unplaced.push(name);
    }
  });
  const leftover = [...remainingPositions];
  unplaced.forEach((name, i) => {
    if (leftover[i] !== undefined) onFieldNow[leftover[i]] = name;
  });
  // Fill any still-empty positions with null
  OUTFIELD.forEach(pos => {
    if (onFieldNow[pos] === undefined) onFieldNow[pos] = null;
  });

  const segments = buildRemainderForHalf({
    players,
    cumulativeMinutes,
    onFieldNow,
    benchNow: openingBench,
    currentGK: gkName,
    remainingMinutes,
    halfNumber,
    priorSegments,
  });

  // Mark the first segment as crossing a half-time boundary
  if (segments.length > 0) {
    segments[0] = { ...segments[0], htBefore: true };
  }
  return segments;
}

/**
 * Apply minutes from a list of segments to a cumulative-minutes map, returning
 * a new map. Used to feed H1-remainder minutes into H2 planning.
 */
function applySegmentMinutes(cumulative, segments) {
  const result = { ...cumulative };
  segments.forEach(seg => {
    Object.values(seg.assignment).forEach(name => {
      if (name && result[name] !== undefined) {
        result[name] += seg.duration;
      } else if (name && result[name] === undefined) {
        result[name] = seg.duration;
      }
    });
  });
  return result;
}

// ---------------------------------------------------------------------------
// VALIDATION
// ---------------------------------------------------------------------------

function validateEvent(state, event) {
  if (!state || !state.segments || state.segments.length === 0) {
    throw new Error('No game in progress.');
  }
  if (state.currentSegIdx === null || state.currentSegIdx === undefined) {
    throw new Error("Game hasn't started — update the squad on Setup.");
  }
  if (state.currentSegIdx < 0 || state.currentSegIdx >= state.segments.length) {
    throw new Error('Game has ended.');
  }
  if (!event || (event.type !== 'add' && event.type !== 'remove')) {
    throw new Error('Invalid roster event.');
  }
  const name = (event.name || '').trim();
  if (!name) throw new Error('Player name required.');

  if (event.type === 'add') {
    if (state.players.includes(name)) {
      throw new Error(`${name} is already in the squad.`);
    }
    if (state.players.length >= MAX_SQUAD) {
      throw new Error(`Maximum is ${MAX_SQUAD} players.`);
    }
  } else {
    if (!state.players.includes(name)) {
      throw new Error(`${name} is not in the squad.`);
    }
    const seg = state.segments[state.currentSegIdx];
    if (seg.assignment.GK === name) {
      throw new Error('Pick a new goalkeeper first using ALLOCATE GK, then mark this player out.');
    }
    if (state.players.length - 1 < MIN_SQUAD) {
      throw new Error(`Cannot drop below ${MIN_SQUAD} players.`);
    }
  }
}

function computeNewPlayers(players, event) {
  const name = event.name.trim();
  if (event.type === 'add') return [...players, name];
  return players.filter(p => p !== name);
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Replan the rest of the game after a mid-game roster change.
 *
 * state = {
 *   segments:        Segment[],   current schedule (may include locked past)
 *   players:         string[],    roster BEFORE the change
 *   currentSegIdx:   number,      index of the active segment
 *   elapsedMinutes:  number,      whole minutes already played in currentSegIdx
 *   gkH1:            string,      H1 GK name
 *   gkH2:            string,      H2 GK name (may equal gkH1)
 * }
 *
 * event =
 *   | { type: 'add',    name: string }
 *   | { type: 'remove', name: string, replacementOnField?: string }
 *
 * Returns { newSegments, newPlayers, warnings: string[] }.
 * Throws Error on validation failure (caller surfaces via toast).
 */
export function replanFromRosterChange(state, event) {
  validateEvent(state, event);

  const newPlayers = computeNewPlayers(state.players, event);
  const warnings = [];

  // ── Step 1: split the active segment, or skip the split if elapsed=0 ────
  // Decide whether to split at all. splitSegment requires 1 ≤ elapsed < duration;
  // outside that range we either skip the split (elapsed≤0) or clamp.
  const activeSeg = state.segments[state.currentSegIdx];
  const wantSplit = state.elapsedMinutes > 0;
  let splitSegments;
  let lockedThroughIdx;
  let futureStartIdx;

  if (wantSplit) {
    const clampedElapsed = Math.min(
      Math.max(1, state.elapsedMinutes),
      activeSeg.duration - 1
    );
    if (clampedElapsed >= 1 && clampedElapsed < activeSeg.duration) {
      splitSegments = splitSegment(state.segments, state.currentSegIdx, clampedElapsed);
      lockedThroughIdx = state.currentSegIdx;       // segment A, just locked
      futureStartIdx   = state.currentSegIdx + 1;   // segment B (will be discarded)
    } else {
      // Couldn't make a valid split (segment too short) — skip
      splitSegments = state.segments;
      lockedThroughIdx = state.currentSegIdx - 1;
      futureStartIdx   = state.currentSegIdx;
    }
  } else {
    splitSegments = state.segments;
    lockedThroughIdx = state.currentSegIdx - 1;
    futureStartIdx   = state.currentSegIdx;
  }

  // ── Step 2: cumulative minutes from locked segments (uses NEW player list) ─
  const cumulativeMinutes = computeCumulativeMinutes(splitSegments, lockedThroughIdx, newPlayers);

  // ── Step 3: derive the starting on-field / bench state for the remainder ──
  // Use what segB shows (or activeSeg if we skipped the split), then apply the
  // roster event to it.
  const segB = splitSegments[futureStartIdx];
  if (!segB) {
    // No future segment — game effectively over. Nothing to replan.
    return { newSegments: splitSegments, newPlayers, warnings };
  }

  let onFieldNow = { ...segB.assignment };
  let benchNow   = [...segB.bench];
  const currentGK = segB.assignment.GK;

  if (event.type === 'remove') {
    const onFieldEntry = Object.entries(onFieldNow).find(([, n]) => n === event.name);
    if (onFieldEntry) {
      const [pos] = onFieldEntry;
      const replacement =
        (event.replacementOnField && benchNow.includes(event.replacementOnField))
          ? event.replacementOnField
          : pickReplacement(benchNow, cumulativeMinutes);
      if (replacement) {
        onFieldNow[pos] = replacement;
        benchNow = benchNow.filter(n => n !== replacement);
      } else {
        onFieldNow[pos] = null;   // sub-9 case — leave the position empty
      }
    } else if (benchNow.includes(event.name)) {
      benchNow = benchNow.filter(n => n !== event.name);
    }
  } else {
    // Add late player → goes to bench
    benchNow = [...benchNow, event.name.trim()];
  }

  // ── Step 4: build the rest of the active half ─────────────────────────────
  const sumThroughLocked = sumDuration(splitSegments, 0, futureStartIdx);
  const activeHalf       = segB.half;
  const halfBoundary     = activeHalf === 1 ? HALF_MIN : 2 * HALF_MIN;
  const remainingActive  = halfBoundary - sumThroughLocked;

  const lockedSegments = splitSegments.slice(0, futureStartIdx);

  const activeRemainder = buildRemainderForHalf({
    players: newPlayers,
    cumulativeMinutes,
    onFieldNow,
    benchNow,
    currentGK,
    remainingMinutes: remainingActive,
    halfNumber: activeHalf,
    priorSegments: lockedSegments,
  });

  // ── Step 5: build a fresh H2 if we replanned in H1 ────────────────────────
  let h2Segments = [];
  if (activeHalf === 1) {
    const gkH2Name = chooseH2GK({
      originalGkH2: state.gkH2,
      newPlayers,
      gkH1Name: currentGK,
      warnings,
    });
    const cumAfterH1 = applySegmentMinutes(cumulativeMinutes, activeRemainder);
    h2Segments = buildFreshHalf({
      players: newPlayers,
      cumulativeMinutes: cumAfterH1,
      gkName: gkH2Name,
      remainingMinutes: HALF_MIN,
      halfNumber: 2,
      priorSegments: [...lockedSegments, ...activeRemainder],
    });
  }

  // ── Step 6: stitch + reindex/relabel ──────────────────────────────────────
  const stitched = [...lockedSegments, ...activeRemainder, ...h2Segments];
  const newSegments = reindexAndLabel(stitched);

  return { newSegments, newPlayers, warnings };
}
