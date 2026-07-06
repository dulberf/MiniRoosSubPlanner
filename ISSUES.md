# Audit Issues & Solutions — 6/7/2026

*Full-codebase audit performed 6/7/2026 against source in `src/` and the season export `teamsheet-season-2026-07-06.json` (12 saved games). This file is the work order for the fix session — read HANDOFF.md first for architecture context, then implement in the priority order at the bottom.*

**Verification evidence referenced below was produced by:**
- A deterministic repro script run against the real `src/scheduler.js` (12-player schedule, one field↔bench swap, App.jsx propagation loop replicated verbatim).
- A per-player timeline scan of all 12 saved games in the season export.

---

> **STATUS (Session 11, 6/7/2026): Issues 1, 2 and 3 are IMPLEMENTED** — see HANDOFF.md Session 11 for details. Issues 4–6 remain open. The duplicate 4/7 game still needs to be deleted manually in the Season view on the iPad.

## Issue 1 — CRITICAL: Manual bench moves don't rebalance the future rotation ✅ FIXED (Session 11)

**The coach-reported bug: "when I move players to the bench, the game doesn't recognise this and subs them off a 2nd time."**

### Root cause

`handleSwap` in `src/App.jsx` (the forward-propagation loop, ~lines 297–355). When the coach swaps a player in segment N, the loop walks segments N+1 onward and rebuilds each segment's `assignment` — but it spreads `...currSeg`, which keeps each future segment's **`bench` array exactly as baked at generate time** by `buildBenchSlots`. The bench rotation is a fixed list of names decided once and never re-derived.

Consequences:
- A player manually moved to the bench still occupies their originally-planned future bench slots → the plan benches them **again** at a later changeover.
- The player brought on keeps their planned slots too → they never get the rest they were scheduled for.
- The sub script modal (`getSubChanges` in `TeamSheetView.jsx`) diffs adjacent segments, so it reads out these stale/double subs to the coach as if they were correct.

### Deterministic repro (verified)

12-player schedule (segments 10/15/10/15), original plan gives everyone 35–40 min. One coach action — swap Luella (on field) with Ivy (on bench) in the first H2 segment, then run App.jsx's exact propagation loop:

```
Result: Luella 25 min (benched twice), Ivy 50 min (never benched).
No warning. All other players unchanged.
```

### Season data evidence (verified from the export)

Every game with mid-game edits shows the damage. Minutes spread should be ≤5 for 10–12 player games (12-player worst case 35–40):

| Game | Spread | Damage |
|---|---|---|
| Entrance home game 13/6 | 20 min | Cara & Avahna 30m vs Gen & Lyla 50m; 4 players benched twice |
| Terrigal r8 20/6 | 25 min | Cara 25m vs Ivy 50m |
| Budgiewoi r7 27/6 | 20 min | Grace 30m vs Clara & Gen 50m |
| Gwandelen r8 4/7 | **30 min** | Grace & Gen 20m, Maddy 25m — Luella, Lyla & Ivy all played the full 50 |

In Gwandelen r8 both H2 segments are `edited: true` — the coach rearranged the H2 lineup at half-time, the app kept its stale bench plan, and three players who had already rested in H1 were benched a second time.

### Solution

`src/replan.js` already contains ~80% of the fix — it was built to rebuild the remainder of a game after a roster change, and it rotates bench duty by cumulative minutes with positional continuity. Generalize it to fire after manual edits too:

1. **New export in `replan.js`:** `rebalanceRemainder({ segments, players, fromSegIdx, gkH2 })`:
   - Starting state = segment `fromSegIdx`'s (post-edit) `assignment` + `bench`.
   - Cumulative minutes from segments `0..fromSegIdx` via existing `computeCumulativeMinutes`.
   - Rebuild `fromSegIdx+1 .. end-of-half` with existing `buildRemainderForHalf` (already implements most-minutes→bench-next rotation and `lastOutfieldPos` continuity).
   - If `fromSegIdx` is in H1, rebuild H2 with existing `buildFreshHalf` (same pattern `replanFromRosterChange` uses, including `chooseH2GK`).
   - Re-label with existing `reindexAndLabel`.
2. **Trigger point:** in `TeamSheetView`, when the coach taps **✅ FINISH EDITING** — *not* on every individual swap (a lineup edit is usually several taps). Snapshot the segment's field/bench **membership** when edit mode opens; on exit, if membership changed (not just positions), call the rebalance via a new App callback and toast "Rest of the game rebalanced ✓".
3. **Pure position↔position shuffles** (no bench membership change) keep the existing propagation — it is correct for that case.
4. **Remove the bench-blind propagation** for the membership-change case (replaced by rebalance).
5. **Test** (`test/`): apply a field↔bench swap to a 12-player schedule, assert (a) no player benched twice while another is never benched, (b) minutes spread ≤ 15, (c) every active player appears exactly once per segment across field ∪ bench, (d) durations still sum to 50.

Fixing this also fixes the sub-script announcements automatically — they diff adjacent segments, which will now be consistent.

---

## Issue 2 — HIGH: Season fairness engine is fed garbage bench data ✅ FIXED (Session 11)

**Balance & Generate's bench-time balancing has been effectively random all season.**

### Root cause

`orderPlayersForGame` in `src/scheduler.js` (~lines 198–200):

```js
game.players?.forEach((p, idx) => {
  if (benchMins[p] !== undefined) benchMins[p] += weights[idx] || 0;
});
```

It attributes historical bench minutes by **player index into `game.players`**, assuming that order matches the rotation's slot order. It never does:

- `buildSchedule` internally reorders the list via `reorderForExplicitGKs` (GKs to slots 0 and the second-GK slot) and shuffles outfield positions.
- `game.players` is just the setup-textarea order at save time (and `togglePlayer` in InputView reorders it every time a player is toggled off/on).
- Mid-game edits and replans change actual bench time regardless of any planned order.

**Verified against Gwandelen r8:** the actual seg-0 bench (`Imogen, Maddy, Noa`) does not correspond to indices 1–3 of the saved `players` array (`Maddy, Clara, Cara`). The weights land on the wrong kids.

Impact: the "players who have had the most bench time get more field time now" half of `orderPlayersForGame` is noise, so week-to-week bench fairness never actually corrects. (The GK round-robin half reads `segments` directly and is correct.)

### Solution

The saved games already contain the truth — every segment records its real bench. `SeasonView.jsx` (~line 101) already computes it correctly:

```js
(game.segments || []).forEach(seg => {
  if (seg.bench?.includes(p)) totals[p].benchMins += (seg.duration || 0);
});
```

In `orderPlayersForGame`, replace the `weights[idx]` attribution with that same loop over `game.segments`. Keep `buildBenchMinuteWeights` only for its other job — ranking which *slots* in the upcoming game carry the most bench time (the `emptySlots` sort) — that use is correct.

**Test:** build a fake history where player A was benched 30 real minutes (per segments) but sits at index 0 of `game.players`; assert A is prioritised for field time in the next ordering.

---

## Issue 3 — HIGH: Duplicate game in season data + fragile save identity ✅ FIXED (Session 11 — code only; the existing duplicate must still be deleted by hand)

### The data problem (fix the data first)

Games at index 9 and 10 of the current export are **the same game saved twice**:
- `[9]` 27/6/2026 "Budgiewoi r7"
- `[10]` 4/7/2026, blank label — identical players, lineups, and minutes.

Every season stat (goals, minutes, GK stints, bench time, honours) is double-counting that match, further skewing Balance & Generate. **Action: delete the 4/7 blank-label duplicate in the Season view** (or strip it from the JSON and re-import).

### Root cause

`handleSave` in `src/App.jsx` (~lines 532–575) identifies a game by **today's date + players JSON** and stamps `date: new Date()` on every save. Re-saving on a later day (edit, or crash-recovery resume) → date no longer matches → appended as a new game. The import dedup (`date + players + label`) shares the weakness — and a roster change mid-game alters `players`, which also breaks the match.

### Solution

- Add `id: crypto.randomUUID()` to the game object on first save.
- Keep `id` and the **original** `date` across edits (only set `date` when `!isSaved`).
- Replace-by-`id` in `handleSave` instead of the reverse date+players search.
- Import dedup by `id`, falling back to the legacy `date + players + label` key for old exports.
- No migration needed: old games without `id` get one lazily on next edit, or on import.

---

## Issue 4 — MEDIUM: Propagation can silently drop or strand players

In `handleSwap`'s loop, incoming players are only slotted while vacated positions remain (`if (vacatedPositions[idx] !== undefined)`). With mismatched counts a player can vanish from both field and bench, or the field runs short — silently.

Mostly superseded by the Issue 1 fix, but add a cheap **invariant guard** after any segment mutation (swap, GK change, replan, rebalance):

- every active player appears exactly once across `assignment` ∪ `bench`;
- field count is 9 (or squad size if <9);
- durations per half sum to 25.

On violation: red toast + console.warn, don't commit the corrupt state. Cheap insurance for every mutation path, including future ones.

---

## Issue 5 — MEDIUM: "Change the whole period instead" still rewrites live history

Session 10 gated emergency subs behind the time prompt, but the escape hatch in the sub-prompt modal (`editWholePeriod` in `TeamSheetView.jsx`) is one tap away with no guard. If the period is actually underway, it rewrites minutes already played — the exact Round-8 Terrigal bug class.

**Solution:** when `currentSeg === gameClock.currentSegIdx && elapsedMs > 0`, disable the whole-period button (or require an explicit confirm) and label it "only for periods that haven't started yet".

---

## Issue 6 — LOW: Code-health items

1. **Side effects inside a state updater.** `handleRosterChange` (`App.jsx` ~223–294) runs the whole replan plus `setSegments` / `setPlayersText` / toasts *inside* the `setGameClock` updater. Updaters must be pure — StrictMode dev double-invokes them. Restructure: compute clock + replan results outside, then set states.
2. **Min-squad inconsistency.** InputView requires 7 (`MIN_PLAYERS = 7`), `handleGenerate` allows 6, `replan.js` `MIN_SQUAD = 6`. Pick one, export `MIN_SQUAD` from `constants.js`, use everywhere.
3. **Elapsed-minute rounding inconsistency.** Emergency-sub fast path uses `Math.floor` (`TeamSheetView.jsx` ~347); roster change uses `Math.round` (`App.jsx` ~234). Standardize on `floor` — never lock time that wasn't played.
4. **Dead prop.** `onReorder` is passed to TeamSheetView but never used there. Remove it; regenerating mid-game would leave stale `currentSeg`/`matchStats` anyway.
5. **HANDOFF.md contradicts constants.js on token colours.** HANDOFF says "RB/RM/RF are BLACK — do not change"; `constants.js` has LB/LM/LF black and RB/RM/RF white ("White Rhymes with Right"). The code is what's on the field — fix HANDOFF so a future session doesn't "correct" the wrong side.
6. **`_app_raw.js`** — 74KB legacy pre-Vite artifact at repo root, untouched since the initial Vite migration commit. Delete (it's in git history if ever needed).
7. **Known open (Session 10 watch list):** clock display jump on START. Cosmetic; unchanged by this audit.

---

## Architecture note for the rewrite

The prototype's root disease, which Issues 1 and 4 both live in: **the schedule is a fully-materialized plan with names baked in, and three separate mutation paths** (`handleSwap` propagation, `changeGKFromSegment`, `replanFromRosterChange`) each maintain segment invariants differently. Every feature added a new way for them to disagree.

For the replacement app:
- The **past is an immutable log of what actually happened** (player, position, from-minute, to-minute).
- The **future is always derived**: one pure `replan(actualHistory, roster, config) → futureSegments` function, run after *every* perturbation — manual swap, GK change, late arrival, injury, clock split.
- A manual bench move is then just another input to the same planner; this bug class becomes structurally impossible.
- `replan.js` is the seed of that function. Ship the invariant validator (Issue 4) as a property test from day one.

---

## Implementation order

| Priority | Issue | Why |
|---|---|---|
| 1 | Issue 1 — rebalance after bench-membership edits | The match-day bug; makes next Saturday fair |
| 2 | Issue 3 — delete dup game + id-based save identity | Stops the stats double-count feeding everything else |
| 3 | Issue 2 — real bench minutes in the fairness oracle | Makes Balance & Generate actually balance |
| 4 | Issue 5 — guard the whole-period escape hatch | Closes the last history-rewrite path |
| 5 | Issue 4 — invariant guard | Cheap insurance across all mutation paths |
| 6 | Issue 6 items | As time allows |

After implementing: run `npm test`, add the new tests described in Issues 1 and 2, `npm run release`, verify in dev preview at `http://localhost:5173` (do not trust the Claude preview tab — see HANDOFF watch list), and update HANDOFF.md per session rules.
