# MiniRoos Sub Planner — Technical Handoff
*Last updated: 2026-07-06 (Session 11 complete)*

**Repo:** https://github.com/dulberf/MiniRoosSubPlanner
**Live app:** https://dulberf.github.io/MiniRoosSubPlanner/team-sheet-offline.html
**Working dir:** `C:\Projects\football-sub-planner`
**Format:** Single self-contained offline HTML. Must stay this way — used on iPad at fields with no WiFi.

---

## Rule for every session
Read `Football sub planner.md` in Obsidian and this file before touching any code. Present the plan before changing anything. Update this file at the end of the session with what was changed.

---

## Project Structure

```
football-sub-planner/
├── src/
│   ├── App.jsx                    # Root component — state, routing, handlers
│   ├── scheduler.js               # Core rotation algorithm (bench slots, GK, stats)
│   ├── replan.js                  # Mid-game roster change handler (late arrival / injury)
│   ├── constants.js               # Positions, colours, field layout, STORAGE_KEY, IN_PROGRESS_KEY
│   └── components/
│       ├── InputView.jsx          # Setup screen — player list, H1/H2 GK picker dropdowns, import/export
│       ├── TeamSheetView.jsx      # Live game screen — field, clock, swaps, notes, save modal
│       ├── SeasonView.jsx         # Season tracker — game history, fairness stats, edit modal
│       ├── FieldView.jsx          # Interactive field diagram with player tokens
│       ├── PlayerToken.jsx        # Circular player badge (colour, rings, size)
│       ├── SwapPanel.jsx          # Edit-mode swap selection display
│       ├── FieldSVG.jsx           # Raw SVG field background
│       └── Toggle.jsx             # Custom toggle switch
├── team-sheet-offline.html        # Built output — this is what goes on GitHub Pages
├── package.json
├── vite.config.js                 # vite-plugin-singlefile bundles everything inline
└── HANDOFF.md                     # THIS FILE
```

### Build / release commands
```bash
npm run dev       # Dev server at http://localhost:5173
npm run release   # Vite build → copies dist/index.html to team-sheet-offline.html
git add team-sheet-offline.html src/ && git commit -m "..." && git push origin main
```

---

## Formation & Field

**Fixed 9v9 formation:** `GK · LB · CB · RB · LM · CM · RM · LF · RF`

### Field coordinates (`src/constants.js` → `FIELD_LAYOUT`)
| Pos | X% | Y% |
|-----|----|----|
| GK  | 50 | 88 |
| LB  | 20 | 65 |
| CB  | 50 | 65 |
| RB  | 80 | 65 |
| LM  | 20 | 42 |
| CM  | 50 | 42 |
| RM  | 80 | 42 |
| LF  | 30 | 19 |
| RF  | 70 | 19 |

All row gaps are uniform at 23% so the sub label below each token never overlaps the row below.

### Position colour scheme (LOCKED — do not change)
| Position | Background | Text |
|----------|-----------|------|
| GK | Magenta `#d946ef` | Dark navy `#0f2d5a` |
| LB, LM, LF | **Black `#111827`** | White `#ffffff` |
| CB, CM | Light grey `#b0bec5` | Dark `#111827` |
| RB, RM, RF | White `#ffffff` | Dark `#111827` |

> Mnemonic (from `src/constants.js`): **"White Rhymes with Right"** — Right-side positions are WHITE, Left-side are BLACK. This table previously had the two swapped; `src/constants.js` is the source of truth and matches what's on the field. Do not "fix" the code to match old docs.

### Token sizing (`src/components/FieldView.jsx`)
Token size calculated from field container width via ResizeObserver (not `window.innerWidth`):
```js
size = Math.min(108, Math.max(40, Math.round(containerWidth * 0.21)))
```
Font size: `Math.max(8, size * 0.19)`.

---

## Rotation & Scheduling Logic

### Segment schedules by squad size (`src/scheduler.js` → `getSegmentConfig`)
| Players | Segments | Durations | HT after seg | Bench spots |
|---------|----------|-----------|-------------|-------------|
| ≤9 | 2 | [25, 25] | 0 | 0 |
| 10 | 10 | [5,5,5,5,5,5,5,5,5,5] | 4 | 1 |
| 11 | 6 | [5,10,10,10,10,5] | 2 | 2 |
| 12 | 4 | [10,15,10,15] | 1 | 3 |

> ⚠️ 9-player games produce two 25-min segments (H1/H2), not one 50-min segment. The `benchSize <= 0` block in `buildSchedule` returns two hardcoded segments — do not route 9-player through the rotation engine.

### `buildSchedule` API
```js
buildSchedule(players, { gkH1, gkH2 })
```
Changed in Session 6 from `(players, lockGKBoolean)`. Reorders players internally so slot-based bench math works with the chosen GKs.

### Segment object shape
```js
{
  segIdx:     number,
  assignment: { GK, LB, CB, RB, LM, CM, RM, LF, RF },
  bench:      string[],
  gkName:     string,
  duration:   number,
  label:      string,   // "H1 0–25", "H2 25–50" — en dash, no "min" suffix
  half:       1 | 2,
  htBefore:   boolean,
  subBefore:  boolean,
  edited:     boolean,
}
```

### Position persistence after swap (`App.jsx` → `handleSwap`)
When a player is swapped in segment N, positions propagate forward through subsequent segments in the same half. Stops at `htBefore: true`. Do not simplify this logic.

### GK helpers (`src/scheduler.js`)
- `orderPlayersForGame(players, savedGames)` — fairness oracle: ranks by GK stint count, with a recency tiebreak (`lastGKGame`) for ties. Single source of truth for GK suggestions.
- `getSecondGKSlot(n)` — index in ordered list for H2 GK. Returns `1` for ≤9 players.
- `changeGKFromSegment(segments, fromSegIdx, newGKName)` — in-game swap: trades new GK with previous GK across remaining segments in the current half.
- `suggestGKs` **deleted** in Session 6.

---

## Data Structures

### Saved game object (`localStorage` → `teamsheet_season`)
```js
{
  date:          "D/M/YYYY",
  label:         string,
  players:       string[],
  segments:      Segment[],
  stats: {
    minutesMap:     { [player]: number },
    gkDutyMap:      { [player]: 0 | 1 },
    playerSchedule: { [player]: string[] },
  },
  goals:         { [player]: number },
  assists:       { [player]: number },
  potm:          string | null,
  captain:       string | null,
  notes:         string,
  opponentGoals: number,
}
```

Use `segment.half` to derive GK H1/H2 split — do not rely on `gkDutyMap` alone.

### Export/import format
```js
{ version: 1, exported: "ISO8601", games: SavedGame[] }
```
Dedup key: `date + JSON.stringify(players) + label`.

---

## Session History

### Session 12 — Audit cleanup: invariant guards, escape-hatch guard, code health, clock jump ✅
**Scope:** ISSUES.md Issues 4–6 plus the Session-10 clock watch-list item. No behaviour changes to the core rotation beyond one algorithm improvement found by the new tests (below).

**Issue 4 — lineup integrity guards:**
- `findLineupIssue(segments)` and `findMembershipDrift(before, after)` exported from `scheduler.js`.
- All mutation paths now compute their result synchronously (off `segmentsRef`) and validate BEFORE committing: `handleSwap` (edited segment only — forward propagation is transient by design and healed by the FINISH-EDITING rebalance), `handleChangeGK`, `handleRosterChange`, `handleRebalance`. On violation: red toast + console.warn, state not committed.

**Issue 5 — whole-period escape hatch guarded:**
- In the emergency-sub prompt, "Change the whole period instead" is disabled once the current period has any elapsed time (`gameClock.currentSegIdx === currentSeg && elapsedMs > 0`), with explanatory copy. Pre-period plan edits unaffected.

**Issue 6 — code health:**
- `handleRosterChange` no longer runs the replan/toasts inside the `setGameClock` updater (pure-updater contract; StrictMode double-fire). Elapsed minutes now `Math.floor` everywhere (was `round` in two places) — never lock unplayed time.
- `MIN_PLAYERS = 7` / `MAX_PLAYERS = 12` exported from `constants.js`, used by InputView + App. `replan.js` keeps its in-game floor of 6 deliberately (injuries must be recordable below the pre-game minimum) — commented.
- Dead `onReorder` prop removed from TeamSheetView.
- `_app_raw.js` (legacy pre-Vite artifact) deleted.
- Colour table in this file corrected — it had LB/LM/LF and RB/RM/RF swapped vs `constants.js` ("White Rhymes with Right").

**Clock jump on START (Session 10 watch list) — fixed:**
- Cause: first render after START used a stale `now` (only refreshed on the interval tick), so `now − segmentStartTime` was a large negative and the readout jumped for 1–2 s.
- Fix: the tick effect calls `setNow(Date.now())` immediately on any run-state change, and `elapsedMs` clamps the delta with `Math.max(0, …)`.

**Algorithm improvement (caught by new tests run repeatedly):** `rebalanceRemainder` now has a forced-rest lookahead — a player who keeps goal for every remaining segment (the incoming H2 GK during the last H1 segment) can only rest NOW, so an unrested one is benched ahead of the minutes ranking. Mirrors `buildSchedule`'s rest-the-H2-GK-before-HT rule. Without it, an H1 edit could strand the H2 GK on 50 min.

**Tests:** `test/integrity.test.mjs` (new, 3 tests) + hardened `rebalance.test.mjs` (H1-edit case now asserts everyone rests exactly once, spread ≤ 10; late-edit case made deterministic). 12 tests, verified stable across 10 consecutive runs (the position shuffle makes naive scenarios flaky — pick swap targets by rest-history, not position).

**Files touched:** `src/scheduler.js`, `src/replan.js`, `src/App.jsx`, `src/components/TeamSheetView.jsx`, `src/components/InputView.jsx`, `src/constants.js`, `test/integrity.test.mjs` (new), `test/rebalance.test.mjs`, `_app_raw.js` (deleted), `ISSUES.md`, `team-sheet-offline.html` (rebuilt).

### Session 11 — Rebalance after manual edits + fairness-oracle fix + stable game ids ✅
**Context:** Full audit (see `ISSUES.md`) diagnosed the coach's "app subs kids off a 2nd time" report. Season data showed every edited game had double-benched players (worst: Gwandelen r8 4/7 — Grace & Gen 20 min while three players played the full 50).

**Issue 1 fixed — manual bench moves now rebalance the rest of the game:**
- Root cause: `handleSwap` propagation rebuilt future `assignment`s but kept every future segment's `bench` array as baked at generate time, so the rotation kept executing the original plan after a manual field↔bench change.
- New `rebalanceRemainder({ segments, fromSegIdx })` in `replan.js`: preserves the edited segment verbatim and every later segment's duration/label/half/flags/scheduled GK, but re-picks each later bench greedily — non-GK players with the most projected minutes rest next (ties: fewest bench stints, then stable order). Positional continuity follows the scheduler's rules. Walks across the HT boundary, so an H1 edit rebalances H2 too.
- Trigger: `TeamSheetView` snapshots the segment's bench membership when edit mode opens; on FINISH EDITING (or any edit-mode exit), if membership changed (not just positions), it calls `onRebalance(segIdx)` → `handleRebalance` in App. Pure position swaps keep the old propagation path.
- **Toast fix:** TeamSheetView received the `toast` prop but never rendered it — all game-screen toasts (swap applied, GK change, roster warnings) were invisible. Now rendered as a fixed top-center overlay (zIndex 400).

**Issue 2 fixed — season fairness oracle now reads real bench minutes:**
- `orderPlayersForGame` previously attributed bench minutes by index into `game.players` via `buildBenchMinuteWeights` — but that order has no relationship to rotation slots (buildSchedule reorders/shuffles internally; edits change reality). Bench-fairness balancing was noise all season.
- Now tallies actual bench minutes from `game.segments` (same loop SeasonView uses). `buildBenchMinuteWeights` is still used for its correct job: ranking the upcoming game's slots by bench weight.

**Issue 3 fixed — stable game ids stop duplicate saves:**
- Old identity was "today's date + players JSON"; editing a game on a later day appended a duplicate (proof: games 27/6 "Budgiewoi r7" and 4/7 blank-label are byte-identical in the season export).
- Every game now gets `id: crypto.randomUUID()` on first save; edits replace by id and preserve the original match date; `loadSeason` lazily migrates legacy games; import dedups by id with the legacy key as fallback. New `currentGameId` state in App, reset on generate/reorder/reset.
- ⚠️ **The existing duplicate (4/7/2026, blank label) must still be deleted manually in the Season view on the iPad** — code can't remove it retroactively.

**Tests:** `test/rebalance.test.mjs` (6 new tests, 9 total passing): mid-game swap → everyone rests exactly once, spread ≤ 10; late-edit case → optimal spread ≤ 20 (provably minimal with one changeover left); edited segment/durations/labels/GK plan preserved; H1 edit rebalances H2; no-op guards; oracle reads real bench minutes.

**Verified in dev preview end-to-end:** benched Lyla (scheduled to rest seg 3) in seg 1 via EDIT LINEUP → FINISH EDITING → seg-3 bench dropped Lyla, seg-2 bench picked up Grace, everyone rests exactly once, "Rest of game rebalanced ✓" toast visible.

**Files touched:** `src/replan.js`, `src/scheduler.js`, `src/App.jsx`, `src/components/TeamSheetView.jsx`, `test/rebalance.test.mjs` (new), `ISSUES.md` (status), `team-sheet-offline.html` (rebuilt).

**Still open from the audit:** ISSUES.md Issues 4 (invariant guard), 5 (whole-period escape hatch guard), 6 (code-health list).

### Session 10 — Emergency-sub time anchor + replan duration fix ✅
**Bug (the weekend, Round 8 Terrigal 20/6):** A 12-player game came out with Ivy on the full 50 min and Cara on only 25. Diagnosed from the season export.

**Root cause:** `handleEmergencySub` (TeamSheetView) only split the live period when `gameClock.isRunning && currentSegIdx === currentSeg && elapsed > 0`. With the clock **paused** (coach hadn't restarted it for H2), it silently fell through to `setEditMode(true)` — so the substitution was applied to the **entire** period instead of from the sub moment. The H1 keeper's H2 rest was lost (played 50) and an already-rested player was benched again (dropped to 25). H1 and all "historical" segments were actually intact — the damage was confined to the un-split period. Reproduced deterministically: same sub, clock-running split → spread 10; clock-stopped whole-period → spread 20.

**Fixes:**
- **Emergency sub is now always time-anchored.** Clock-running fast path unchanged. When the clock isn't timing the period, a new modal asks "minutes played this period" and splits at that point (locking the past). A clearly-warned "Change the whole period instead" escape preserves the old behaviour for pre-period plan edits. No more silent whole-period edits. (`TeamSheetView.jsx`: `subPrompt`/`subPromptMins` state, `confirmSubFromTime`, `editWholePeriod`, new modal; button label → `EDIT LINEUP / SUB`.)
- **`handleSplitSegment` (App.jsx) refactored** to accept `(explicitSegIdx, explicitElapsedMins)` and compute synchronously off `segmentsRef` so the returned `futureSegIdx` is reliable. Clock-derived fallback preserved when called with no args.
- **`scaleTemplate` (replan.js) no longer emits 0-/negative-minute segments.** On a short remainder it now caps the segment count at the available minutes and apportions via largest-remainder (Hamilton). Affects LATE PLAYER / PLAYER OUT.

**Tests:** `test/emergency-sub.test.mjs` (run `npm test` → `node --test`). Asserts the time-anchored sub locks the past + keeps spread ≤ 10, documents the whole-period spread ≥ 20, and that replan never produces sub-1-minute segments and still totals 50.

**Files touched:** `src/components/TeamSheetView.jsx`, `src/App.jsx`, `src/replan.js`, `package.json` (test script), `test/emergency-sub.test.mjs` (new), `team-sheet-offline.html` (rebuilt).

**Deferred to next session:** Clock display shows the wrong time until START is pressed, then jumps in the first 1–2s before settling. Suspected: the live `now` value only refreshes on the timer tick, so the first render after START is briefly stale. Separate subsystem — not folded into this fix. See Watch List.

### Session 1 — Persistence hardening ✅
- Debounced save (3s) on every `matchStats` change in `TeamSheetView`
- Flush on `visibilitychange` (primary iPad path) and `beforeunload` (desktop fallback)
- ErrorBoundary "Recover Last Game" button when in-progress data exists
- Modal "Not Now" no longer clears localStorage
- Blue resume banner on setup screen — cleared only on explicit Discard or new game generation

### Session 2 — 9-player H1/H2 split ✅
- `getSegmentConfig` ≤9: `{ durs: [25, 25], htAfterSeg: 0 }`
- `buildSchedule` `benchSize <= 0` block: two hardcoded 25-min segments
- `getSecondGKSlot` ≤9: returns `1` (was `-1`) — fixes season GK stats skew

### Session 3 — UX modal refinements ✅
- Backdrop div closes player panel on outside tap
- Field elevates to z-index 99 when modal open — tokens remain tappable
- "Move Player" button: sets `swapFrom` + `editMode`, closes panel

### Session 4 — Captain tracker + stats ✅
- `captain` field added to saved game object
- Save modal: Captain dropdown, pre-suggested from last win's captain (shown even if absent from squad)
- Season leaderboard: Captain column, GK split into H1/H2, bench in minutes, Top Positions column

### Session 5 — Match journal ✅
- `matchNotes` state in `TeamSheetView`; always-visible textarea in bench panel
- `notes` persisted as `notes: notes || ''`
- Season view: 📝 badge on history cards; notes textarea in Edit modal

### Session 6 — GK picker, in-game GK swap, honours sheet ✅
**Bugs fixed:**
- GK subbed mid-half — bench rotation baked before override; fixed by making GK explicit before schedule builds
- Notes saved but not rendered in season summary — now shown inline in expanded match card
- Manual GK overrides clobbered by Balance & Generate — manual picks now survive
- H1/H2 collapsing to same player — collision guard: if oracle H2 == preserved H1, fall back to oracle H1
- Suggestion not truly round-robin — `lastGKGame` recency tiebreak added to `orderPlayersForGame`

**Features:**
- GK picker on setup screen: H1/H2 dropdowns auto-suggested from oracle, fully overridable
- 🧤 ALLOCATE GK button in bench panel: mid-game swap modal, trades new GK across remaining half segments
- 🏆 Honours sheet in game-screen header: POTW and captain counts from saved games

**Architecture:**
- `buildSchedule` API: `(players, lockGKBoolean)` → `(players, { gkH1, gkH2 })`
- `suggestGKs` deleted — oracle is single source of truth
- `changeGKFromSegment` helper added

---

### Session 9 — Position shuffle on Generate ✅
**Bug:** Outfield positions were assigned in player-array order. With the same input order each week (and same GKs), the same kid always got LB, the next CB, etc. `orderPlayersForGame` only rotated for GK/bench fairness — it didn't touch positional fairness.

**Fix:** Single Fisher-Yates `shuffled()` helper at the top of `src/scheduler.js`. Applied at three points:
- Standard rotation path (10–12 players): `out0` (the segment-0 non-GK, non-bench indices) is shuffled before the OUTFIELD assignment. The carry-forward `lastOutfieldPos` logic propagates the new positions through subsequent segments naturally.
- 9-player H1: shuffle the 8 non-GK names → assign to OUTFIELD.
- 9-player H2: independent shuffle of the 8 non-(H2-GK) names. The previous "minimal disruption" rule (H1 GK takes H2 GK's spot, others stay put) was dropped at the coach's request — full reshuffle at half-time.

**Behaviour:** Every press of `BALANCE & GENERATE` produces a different lineup. Coach can re-press to re-roll. GKs stay stable (the picker drives those). Bench rotation, position-continuity-on-sub-return, and `replan.js` are all unchanged.

**Verified in dev preview:**
- 12-player: 8/8 unique H1 lineups, 8/8 unique H2 lineups across 8 consecutive `buildSchedule` calls
- 9-player: 8/8 unique H1, 8/8 unique H2, H1 always ≠ H2
- GK assignment unchanged (still respects gkH1 / gkH2 picker)
- All 12 players accounted for in every run (no drops, no duplicates)
- End-to-end UI renders shuffled lineup correctly (e.g. LB=Gen, CB=Grace instead of alphabetical Cara, Clara)

**Files touched:** `src/scheduler.js` only (~14 lines added).

---

### Session 8 — Mid-game roster change (late arrival / injury) ✅
**Problem:** A player arrived 5 min late to a 9-player game. The schedule was baked at kickoff for 9 players (no rotation), so the engine had no way to incorporate the late arrival fairly. Result: one player ended up with a single odd sub stint, minutes were wrong.

**Decision:** Parallel-track rewrite (long term) confirmed; this is the short-term patch to make the current app usable for the rest of the season. Equal share for the remainder — no catch-up weighting for the late player.

**New file:** `src/replan.js` — fully isolated module. Imports only `splitSegment` and `getSegmentConfig` from `scheduler.js`. All internal helpers pure (no input mutation, no React).
- `replanFromRosterChange(state, event)` — public API. Validates, splits the active segment at live clock time, rebuilds remainder for the new squad size.
- Helpers: `getHalfTemplate`, `scaleTemplate` (proportionally fits standard durations to remaining minutes), `buildRemainderForHalf`, `buildFreshHalf`, `chooseH2GK`, `pickReplacement`, `computeCumulativeMinutes`, `buildLastOutfieldPos`.
- Reuses scheduler's positional-continuity pattern (`lastOutfieldPos`) for cleaner UX across the boundary.

**App.jsx:**
- New `handleRosterChange(event)` callback (~50 LOC). Mirrors `handleSplitSegment`'s clock-pause + advance pattern.
- Derives an "active roster" from the current segment before calling replan — this lets the engine see the post-injury squad even though `players` (the React state) still contains removed names so `calcStats` can attribute their accrued minutes.
- For "add" events, `setPlayersText` appends; for "remove" events, `players` stays intact (Lyla still appears in season view stats with her partial minutes).

**TeamSheetView.jsx:**
- Two new bench-panel buttons: `➕ LATE PLAYER` and `➖ PLAYER OUT`. Side-by-side, gated by `!editMode && !isEffectivelyLocked`.
- Two new modals styled after the existing GK picker. Late player: name input + validation summary. Player out: dropdown of active players + (if on field) replacement dropdown defaulting to most-rested bench player.
- **Header now derives squad from segments**, not `players.length`: `activeSquadSize` and `benchSize` computed from `seg.assignment + seg.bench`. This keeps the header accurate after any roster change and works without disturbing the saved-game stats logic.

**Edge cases handled (via validation in `replan.js`):**
- Removed player IS the current GK → blocks with "Pick a new goalkeeper first using ALLOCATE GK".
- Roster would drop below 6 → blocks.
- Roster would exceed 12 → blocks.
- Late name already in active squad → blocks.
- Clock not started (`currentSegIdx === null`) → blocks.
- Removed player IS H2 GK and event is in H1 → reassigns H2 GK, surfaces as warning toast.
- Drop below 9 (sub-bench territory) → ALLOWED. Builds a single segment for the rest of the half with `null` in the vacated position(s), matching `buildSchedule`'s ≤9-player pattern.

**Manually verified scenarios (in dev preview):**
- 9 → 10 mid-H1 at ~5 min (today's case): ✓ locked H1 0–5 + 5×4min H1 remainder + 5×5min H2
- 12 → 11 mid-H1 at ~3:45: ✓ locked H1 0–4 + 11-player H1 template scaled to remainder + 11-player H2 template
- 11 → 12 (late arrival on top of injury): ✓ active squad correctly recomputed; 12-player template applied to remainder
- All segment durations sum to exactly 50 min in every case
- Locked segment counts only past-played players for accrued minutes
- No console errors, no React warnings

**Known v1 limitations (deferred to rewrite):**
- The replan re-bakes the H2 schedule when the event is in H1. If the coach wants to "preserve" certain H2 plans, those are lost.
- No undo for roster events.
- 1-minute granularity on the split point (matches the existing `splitSegment` convention).

---

### Session 7 — Period buzzer + screen wake lock ✅
**Features:**
- **Screen Wake Lock** — acquired on clock START, released on Save Game and Reset Game, re-acquired on `visibilitychange` (screen unlock). Prevents iPad auto-locking during a match so subs are never missed.
- **Period-end buzzer** — five rapid beeps (880Hz) when a period ends (`remainingMsTotal <= 0`).
- **Critical warning buzz** — single beep (660Hz) every 5 seconds when ≤30s remains (fires at 30, 25, 20, 15, 10, 5s). `lastBuzzSecRef` prevents double-fire on the 500ms tick.
- **Audio unlock** — `AudioContext` created/resumed on START tap; also resumed in `visibilitychange` handler so audio works after screen unlock.

**Bug fixed (same session):** Critical buzz `useEffect` had `[remainingSecsTotal, isCritical]` in its dependency array but both consts were declared below the `useEffect` call in the component body. React evaluates deps immediately during render, hitting the TDZ — production build crashed on load. Fixed by moving the effect to after the `isCritical` declaration.

**Files changed:** `src/components/TeamSheetView.jsx` only.
**New refs:** `audioCtxRef`, `wakeLockRef`, `lastBuzzSecRef`.
**New helpers:** `unlockAudio()`, `acquireWakeLock()`, `buzz(freq, duration, volume, startOffset)`, `buzzEnd()`.

---

## Known Issues & Watch List
- **PWA / Safari cache on iPad:** Safari caches the HTML aggressively after any push. Workaround: Private Browsing tab to force a fresh fetch. Long-term: cache-busting meta tags + service worker auto-update.
- **Preview tool connects to wrong tab:** Test manually at `http://localhost:5173` — don't trust Claude preview screenshot.
- **Debounce data-loss window:** 3s means up to 3s of goal/assist data lost on sudden crash. Known accepted trade-off.
- **`visibilitychange` is primary save trigger on iOS** — `beforeunload` alone is unreliable on iPad and must never be the sole flush mechanism.
- **Safari ITP** clears localStorage after 7 days of non-use. Export/Import buttons on Setup and Season screens are the safety net — do not remove them.
- **12-player bench is inherently unequal** — 10min and 15min slots. Season fairness corrects over multiple games.
- ~~Clock display jump on START~~ **fixed in Session 12** (stale `now` on the first post-START render; resync + clamp).

---

## UI Rules (Must Follow)
- **No `window.confirm()` or `window.alert()`** — sandboxed iframe. All confirmations use inline modal overlays.
- **Toast notifications:** 2800ms auto-dismiss. `ok` (green) / `err` (red) via `showToast(msg, type)` in `App.jsx`.
- **Date format:** `D/M/YYYY` — not zero-padded.
- **Colour palette (do not change):**
  - Page background: `#f0f6ff`
  - Primary text: `#0f2d5a`
  - Blue accent: `#1558b0` / `#1d6fcf`
  - Green: `#059669`
  - Amber: `#d97706`
  - Red: `#dc2626`
  - Magenta (GK): `#d946ef`
- **No external fonts** — system-ui / Segoe UI only.
- **Offline first** — no CDN, no network calls, everything compiled into the single HTML.

---

## Starting Prompt for a New Session

> "Read `CLAUDE.md` first, then `HANDOFF.md` — it is the authoritative technical reference. Then read the relevant source files before making any changes. Build with `npm run release` and confirm clean output after any changes."
