# MiniRoos Team Sheet Planner — Session Handoff
*Last updated: March 2026. Use this as the starting point for all new Claude Code sessions.*

---

## 1. What the App Is

A substitution and rotation planner for 9v9 junior (MiniRoos) soccer. The coach enters 9–12 player names, the app generates a full rotation schedule ensuring fair playing time and bench rotation, and the coach can manage the game live (swapping players, tracking goals, assigning POTM). Results are saved to a season history with fairness statistics.

**Repo:** https://github.com/dulberf/MiniRoosSubPlanner
**Live file (GitHub Pages):** https://dulberf.github.io/MiniRoosSubPlanner/team-sheet-offline.html
**Format:** Single self-contained offline HTML (~202 KB). Must stay this way — used on iPad at fields with no WiFi.

---

## 2. Project Structure

```
football-sub-planner/
├── src/
│   ├── App.jsx                    # Root component — state, routing, handlers
│   ├── scheduler.js               # Core rotation algorithm (bench slots, GK, stats)
│   ├── constants.js               # Positions, colours, field layout, default players
│   └── components/
│       ├── InputView.jsx          # Setup screen (player list, GK toggle, import)
│       ├── TeamSheetView.jsx      # Main result screen (Field / Schedule / Stats tabs)
│       ├── SeasonView.jsx         # Season tracker (game history, totals, fairness)
│       ├── FieldView.jsx          # Interactive field diagram with player tokens
│       ├── PlayerToken.jsx        # Circular player badge (colour, rings, size)
│       ├── SwapPanel.jsx          # Edit-mode swap selection display
│       ├── FieldSVG.jsx           # Raw SVG field background
│       └── Toggle.jsx             # Custom toggle switch (GK full-game option)
├── team-sheet-offline.html        # Built output — this is what goes on GitHub Pages
├── package.json                   # npm scripts incl. "release" (build + copy HTML)
├── vite.config.js                 # vite-plugin-singlefile bundles everything inline
├── CLAUDE_CODE_HANDOFF.md         # Original spec document (reference — some sections outdated)
└── HANDOFF.md                     # THIS FILE
```

### Build / release commands
```bash
npm run dev       # Dev server at http://localhost:5173
npm run release   # Vite build → copies dist/index.html to team-sheet-offline.html
git add team-sheet-offline.html src/ && git commit -m "..." && git push origin main
```

---

## 3. Formation & Field

**Fixed 9v9 formation:** `GK · LB · CB · RB · LM · CM · RM · LF · RF`

### Field coordinates (`src/constants.js` → `FIELD_LAYOUT`)
| Pos | X% | Y% |
|-----|----|----|
| GK  | 50 | 88 |
| LB  | 20 | 72 |
| CB  | 50 | 72 |
| RB  | 80 | 72 |
| LM  | 20 | 50 |
| CM  | 50 | 50 |
| RM  | 80 | 50 |
| LF  | 30 | 22 |
| RF  | 70 | 22 |

### Position colour scheme (LOCKED — do not change)
| Position | Background | Text |
|----------|-----------|------|
| GK | Magenta `#d946ef` | Dark navy `#0f2d5a` |
| LB, LM, LF | White `#ffffff` | Dark `#0f172a` |
| CB, CM | Light grey `#b0bec5` | Dark `#0f172a` |
| RB, RM, RF | **Black `#111827`** | White `#ffffff` |

> ⚠️ RB/RM/RF are BLACK. The original `CLAUDE_CODE_HANDOFF.md` incorrectly described them as "light grey". Do not change them.

### Token sizing (`src/components/PlayerToken.jsx`)
```js
size = Math.min(120, Math.max(40, Math.round(window.innerWidth * 0.085)))
```
Font size inside the circle: `Math.max(7, size * 0.175)`.
**See §6 below — increasing token size is a pending task.**

---

## 4. Rotation & Scheduling Logic

### Segment schedules by squad size (`src/scheduler.js` → `getSegmentConfig`)
| Players | Segments | Durations | HT after seg (0-based) | Bench spots |
|---------|----------|-----------|----------------------|-------------|
| 9  | 1  | [50]                           | -1 (no bench) | 0 |
| 10 | 10 | [5,5,5,5,5,5,5,5,5,5]         | 4             | 1 |
| 11 | 6  | [5,10,10,10,10,5]              | 2             | 2 |
| 12 | 4  | [10,15,10,15]                  | 1             | 3 |

> ⚠️ The original `CLAUDE_CODE_HANDOFF.md` incorrectly listed 10 players as `5 × 10 min`. The correct implementation is `10 × 5 min` with HT after segment 4.

### Segment object shape
```js
{
  segIdx:     number,           // 0-based
  assignment: { GK, LB, CB, RB, LM, CM, RM, LF, RF },  // name strings
  bench:      string[],         // 0–3 player names
  gkName:     string,           // = assignment.GK
  duration:   number,           // minutes
  label:      string,           // "H1 0–10", "H2 25–35" etc.
  half:       1 | 2,
  htBefore:   boolean,          // true on first segment of H2
  subBefore:  boolean,          // true if a sub precedes this segment
  edited:     boolean,          // true if manually swapped
}
```

### Segment labels
```
9 players:  "H1 0–50"
Others:     "H1 0–10", "H1 10–25", "H2 25–35", "H2 35–50"
```
No "min" suffix. En dash (–), not hyphen (-).

### Position persistence after a swap (`src/App.jsx` → `handleSwap`)
When the user swaps two players in segment N, positions propagate forward through all subsequent segments in the **same half**:
- Every player who stays on field keeps the exact position they held after the swap.
- Players coming on from bench slot into the positions vacated by those going off.
- Propagation stops at `htBefore: true` (half-time resets positions).

This is implemented in `handleSwap` in `App.jsx` — do not revert or simplify this logic.

---

## 5. Data Structures

### Saved game object (`localStorage` → `teamsheet_season`)
```js
{
  date:     "D/M/YYYY",              // e.g. "22/3/2026"
  label:    string,                  // optional match label e.g. "vs Eastside FC"
  players:  string[],                // ordered player list at save time
  segments: Segment[],               // full rotation (including edits)
  stats: {
    minutesMap:     { [player]: number },   // total minutes 0–50
    gkDutyMap:      { [player]: 0 | 1 },   // 1 if player was GK
    playerSchedule: { [player]: string[] }, // position or "BENCH" per segment
  },
  goals:  { [player]: number },      // only non-zero values stored
  potm:   string | null,
}
```

> ⚠️ **Pending change:** `goals` currently stores goals only. Assists and the final match scoreline need to be added. See §6 — Next Tasks.

### Export/import format
```js
{ version: 1, exported: "ISO8601", games: SavedGame[] }
```
Deduplication key: `date + JSON.stringify(players) + label`.

---

## 6. Next Tasks (Priority Order)

### 6.1 Increase player circle size
**What:** Tokens on the field feel too small, especially on iPad.
**Where:** `src/components/PlayerToken.jsx` (the `size` prop) and `src/components/FieldView.jsx` (where size is calculated and passed in).
**Current formula:**
```js
Math.min(120, Math.max(40, Math.round(window.innerWidth * 0.085)))
```
**Suggested approach:** Increase the multiplier and/or minimum. For example:
```js
Math.min(130, Math.max(56, Math.round(window.innerWidth * 0.10)))
```
At 768px (iPad) this gives ~77px vs current ~65px. Also check that tokens don't overlap at larger sizes — field positions are fixed percentages so bigger tokens may crowd on smaller screens.
**Also check:** The font size inside the circle scales as `size * 0.175` — may need bumping slightly for readability at larger sizes.
**Test at:** 375px (phone), 768px (iPad), 1024px (iPad Pro / desktop).

---

### 6.2 Match result — scoreline
**What:** Record the final match score (our team's goals vs opponent). Currently only per-player goal counts are tracked; there is no opponent score or final result field.
**Where:**
- `src/components/TeamSheetView.jsx` — Save panel (currently has match label, POTM, per-player goals)
- `src/App.jsx` → `handleSave` — assembles the game object before storing
- `src/components/SeasonView.jsx` — displays game cards in the season list

**Changes needed:**
1. **Save panel** — add an "Opponent score" number input (0–20 spinner or ±1 buttons, same style as goal counters). "Our score" is auto-calculated by summing all per-player goal counts — show it as a read-only display so the coach can see the running total.
2. **Game object** — add `opponentGoals: number` to the saved game structure. `ourGoals` can be derived from `goals` at display time (sum of all player values) so it doesn't need to be stored separately.
3. **Season game cards** — display result as `2–1 W`, `1–3 L`, `0–0 D` (using green/red/grey colouring) in the card summary line.
4. **Season totals** — add a W/D/L record at the top of the season totals panel.

**Data shape addition:**
```js
// In saved game object, add:
opponentGoals: number,   // defaults to 0 if not recorded
```

---

### 6.3 Assist tracking
**What:** Track which player provided the assist for each goal, alongside goals.
**Where:** Same places as 6.2 — journey panel on the field tab, save panel, season totals.

**Changes needed:**
1. **Journey panel** (shown when a player is highlighted on the Field tab, `TeamSheetView.jsx`): Currently shows ±1 goal counter. Add a second ±1 counter for assists. Display as "⚽ 2  🅰️ 1" style.
2. **Save panel** (`TeamSheetView.jsx`): Per-player row already has ±1 goal counter. Add ±1 assist counter in the same row. Consider compact layout: `[Name]  ⚽ [−][0][+]  🅰️ [−][0][+]`.
3. **State in `TeamSheetView.jsx`**: Currently has `const [goals, setGoals] = useState({})`. Add `const [assists, setAssists] = useState({})` alongside it.
4. **Game object** (`App.jsx` → `handleSave`): Add `assists: { [player]: number }` parallel to `goals`.
5. **Season view** (`SeasonView.jsx`): Add assist totals to per-player season stats row, e.g. `⚽×3  🅰️×2`.
6. **Edit game modal** (`SeasonView.jsx`): Add ±1 assist counters alongside the existing ±1 goal counters.

**Data shape addition:**
```js
// In saved game object, add:
assists: { [player]: number },  // only non-zero values stored (same pattern as goals)
```

---

### 6.4 Improve statistics display
**What:** The Stats tab currently shows playing time bars with minute counts and a bench badge. It could be more informative.

**Suggested improvements (discuss with user before building):**
- **Position frequency badges** — show which positions a player played this game (e.g. "CM×2, LM×1") in the stats tab, not just total minutes
- **Time spread** — the min/max minute spread is already shown; add a visual "fairness meter" (green/amber/red) in a more prominent way
- **GK half indicator** — currently shows 🧤 if player was GK at all; consider showing 🧤H1 or 🧤H2 to distinguish which half
- **Bench count** — currently shows 🪑×N bench segments; could additionally show bench minutes not just segment count (more accurate for 12-player squads where bench durations differ)
- **Season context** — when season data exists, show each player's season average minutes/game alongside their current game minutes

---

## 7. UI Rules (Must Follow)

- **No `window.confirm()` or `window.alert()`** — sandboxed iframe environment. All confirmations use inline modal overlays.
- **Toast notifications:** 2800ms auto-dismiss. Two variants: `ok` (green) and `err` (red). Shown via `showToast(msg, type)` in `App.jsx`.
- **Date format:** `D/M/YYYY` — not zero-padded (1/3/2026, not 01/03/2026).
- **Colour palette** (do not change):
  - Page background: `#f0f6ff`
  - Primary text: `#0f2d5a`
  - Blue accent: `#1558b0` / `#1d6fcf`
  - Green: `#059669`
  - Amber: `#d97706`
  - Red: `#dc2626`
  - Magenta (GK): `#d946ef`
- **No external fonts** — system-ui / Segoe UI only.
- **Offline first** — no CDN, no network calls, everything compiled into the single HTML file.

---

## 8. What Was Fixed in the Most Recent Session

1. **Position persistence after swap** — `handleSwap` in `App.jsx` now propagates the swapped positions forward through all subsequent segments in the same half. Previously, a swap in period 1 would not carry through to period 2.
2. **Position colours** — RB/RM/RF correctly set to black `#111827`. CB/CM set to lighter grey `#b0bec5`.
3. **GK text colour** — Set to dark navy `#0f2d5a` (was incorrectly white on magenta).
4. **Segment label format** — Uses "H1 0–10" style throughout.
5. **Date format** — Fixed to `D/M/YYYY`.
6. **10-player schedule** — Confirmed and implemented as 10×5min segments, HT after segment 4.

---

## 9. Known Constraints

- **Safari ITP** clears localStorage for sites not visited in 7 days. The Export (💾) and Import (📂) buttons on both the Setup and Season Tracker screens are the safety net for this. Do not remove them.
- **12-player bench is inherently unequal** — bench slots of 10 min and 15 min can't be equalised. The season-level fairness tracker corrects this over multiple games.
- **Single formation** — Formation is fixed as 9v9. Multi-formation support (for different age groups) is a future planned feature — see original `CLAUDE_CODE_HANDOFF.md` §9 for context.

---

## 10. Starting Prompt for a New Claude Code Session

> "I'm working on a React + Vite single-file HTML app for planning MiniRoos (9v9 junior soccer) substitutions. Read `HANDOFF.md` first — it is the authoritative description of the current codebase. Then read the specific source file(s) relevant to the task before making any changes. The build command is `npm run release` which outputs `team-sheet-offline.html` — run this and confirm it builds clean (no errors) after any changes."

Then describe the specific task from §6 above.
