# MiniRoos Sub Planner — Technical Handoff
*Last updated: 2026-05-09 (Session 8 complete)*

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
| LB, LM, LF | White `#ffffff` | Dark `#0f172a` |
| CB, CM | Light grey `#b0bec5` | Dark `#0f172a` |
| RB, RM, RF | **Black `#111827`** | White `#ffffff` |

> ⚠️ RB/RM/RF are BLACK. `CLAUDE_CODE_HANDOFF.md` incorrectly described them as light grey — do not change them.

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
