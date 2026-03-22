# MiniRoos Team Sheet Planner — Claude Code Handoff
## Complete specification for ground-up rewrite as Electron/desktop app

---

## 1. What This App Is

A team sheet planner for 9v9 junior (MiniRoos) soccer. A coach enters their squad of 9–12 players before each game, and the app generates a full rotation schedule so every player gets fair playing time, with automatic bench rotation and GK swaps. The coach can view the field layout, see substitution instructions segment by segment, track goals and Player of the Match, and build a season history with fairness statistics.

**Current state:** Works as a single-file PWA (React compiled to self-contained offline HTML, hosted on GitHub Pages). It is fully functional. The rewrite target is a proper Electron desktop app, but all the core logic, UX patterns, and feature decisions documented here must be preserved exactly.

**Repo:** https://github.com/dulberf/MiniRoosSubPlanner  
**Live app:** https://dulberf.github.io/MiniRoosSubPlanner/

---

## 2. Formation & Field

### Fixed 9v9 formation
```
GK · LB · CB · RB · LM · CM · RM · LF · RF
```
Nine outfield+keeper positions. No variation — this formation is fixed for all games.

### Visual field layout
The field is rendered as a green soccer pitch (portrait orientation, ~148% padding-bottom aspect ratio). Positions are placed at fixed percentage coordinates:

| Position | X% | Y% |
|----------|----|----|
| GK       | 50 | 88 |
| LB       | 20 | 72 |
| CB       | 50 | 72 |
| RB       | 80 | 72 |
| LM       | 20 | 50 |
| CM       | 50 | 50 |
| RM       | 80 | 50 |
| LF       | 30 | 22 |
| RF       | 70 | 22 |

Each player is shown as a circular token with their name (truncated to 8 chars, adds "." if over 8) and position label below.

### Position colour scheme (must be preserved exactly — user preference)
| Position | Background | Text colour |
|----------|-----------|-------------|
| GK | Magenta #d946ef | Dark #0f2d5a |
| LB, LM, LF | White #ffffff | Dark #0f172a |
| CB, CM | Mid grey | White |
| RB, RM, RF | Light grey | Dark |

### Token sizing
Responsive via a hook that recalculates on window resize:
```
size = Math.min(120, Math.max(40, Math.round(window.innerWidth * 0.085)))
```
- Phone 375px → 40px tokens
- iPad 768px → ~65px tokens  
- iPad Pro+ / desktop → capped at 120px

Font sizes and label padding inside each token scale proportionally (fontSize ≈ size × 0.2 for short names, × 0.175 for longer names).

---

## 3. Rotation & Scheduling Logic (Core Algorithm)

This is the most important part. It must work identically.

### 3.1 Game structure
- Total game time: **50 minutes** (2 × 25 min halves)
- Substitutions only happen at defined segment boundaries (not freely)
- Half time is always at the 25-minute mark

### 3.2 Segment schedules by player count

The substitution windows are entirely determined by how many players are in the squad:

| Players | Segments | Durations | HT after segment | Bench spots |
|---------|----------|-----------|-----------------|-------------|
| 9 | 1 | [50] | — | 0 |
| 10 | 5 | [10, 10, 10, 10, 10] | seg 2 | 1 |
| 11 | 6 | [5, 10, 10, 10, 10, 5] | seg 2 | 2 |
| 12 | 4 | [10, 15, 10, 15] | seg 1 | 3 |

**HT after segment** = the index (0-based) of the last H1 segment. Segments after this index are H2. The `htBefore` flag is set on the first H2 segment.

For 9 players there is no bench — all 9 play the full 50 minutes uninterrupted.

### 3.3 Segment object shape
```javascript
{
  assignment: { GK: "Name", LB: "Name", CB: "Name", ... },  // 9 positions
  bench: ["Name", ...],                                        // 0–3 players
  half: 1 | 2,
  duration: Number,                                            // minutes
  gkName: "Name",                                              // copy of assignment.GK
  label: "H1 0–10",                                           // display string
  htBefore: Boolean,                                           // true = HT before this seg
  edited: Boolean                                              // true = manually swapped
}
```

### 3.4 GK rotation rules
- By default: one player is GK for H1, a **different** player is GK for H2
- The H1 GK comes from position 0 of the (sorted) player array
- The H2 GK comes from a separate slot determined by `getH2GKResultSlot(n)`
- `gkFullGame` toggle: if enabled, the first player in the list stays in goal the entire game and does NOT rotate to bench. GK swaps are suppressed.
- GK is never swappable when `gkFullGame` is true (the GK position is locked)

### 3.5 Bench equalisation algorithm
After GK slots are assigned, the remaining "result slots" (positions a player can be assigned to across all segments) are sorted by **bench duration** (ascending — least bench time first). The remaining players are sorted by **accumulated bench minutes this season** (descending — most benched first). They are paired: the most-benched player gets the shortest bench slot. This minimises total bench time inequality.

Key function: `getBenchDursPerSlot(n)` returns the bench duration per result-slot position for equalisation purposes.

**Theoretical minimums:**
- n=9: 0 min spread (no bench)
- n=10: 0 min spread (bench slots are equal)
- n=11: 0 min spread (bench slots are equal) 
- n=12: ~10 min spread (unavoidable — bench slot durations are asymmetric: 10+10+10 vs 15+15+15)

### 3.6 Season-aware reordering (`reorderBySeasonTotals`)
The "🔀 Reorder" button (visible on the result screen when season data exists) reorders the player list before regenerating. The ordering logic:

1. Sort players by **fewest GK half-stints** this season (ascending) — ensures GK duty rotates fairly
2. Within equal GK counts, sort by **most accumulated bench minutes** (descending) — ensures bench duty rotates fairly

This makes the auto-generated rotation naturally distribute GK and bench duties fairly across the season without the coach needing to manually adjust the player list.

### 3.7 Key algorithm functions
```
getSchedule(n)              → { durations[], htAfterSeg }
generateRotation(players, gkFullGame) → segments[]
deriveStats(segments, players) → { minutesMap, gkDutyMap, playerSchedule }
getBenchDursPerSlot(n)      → bench minutes per result-slot
getH2GKResultSlot(n)        → which result-slot index is H2 GK
applySwap(seg, {from, to})  → new segment (immutable)
buildTransitionSummary(segA, segB) → { changes[], comingOn[], goingOff[] }
reorderBySeasonTotals(players, seasonGames, gkFullGame) → reordered players[]
```

---

## 4. Screens & Navigation

Three screens. No router — simple state machine.

```
"setup" → "result" → "season"
              ↑____________|
```

### 4.1 Setup screen
- **Header:** "⚽ Team Sheet Planner" with subtitle "9v9 · 2 × 25 min · Every player gets a rest"
- **Player input:** Multi-line textarea, one name per line
- **Live player count badge:** Colour-coded — red if <9, amber if >12, green if 9–12. Shows e.g. "10 players · full squad ✓" or "8 · need 1 more"
- **GK full game toggle:** Custom toggle switch component. When off: "GK rotates to bench at half time, another player takes over in goal". When on: "First player stays in goal all 50 min — does NOT rotate to bench"
- **Game plan preview panel:** (Appears when count is valid) Shows the bench schedule in a compact grid — which player sits out which segment. This gives the coach a preview before generating.
- **Generate button:** Disabled and shows "Add X more players to continue" if count invalid. Active and says "Generate Team Sheet →" when valid.
- **Season Tracker button:** Shows if season data exists. Displays game count as badge (e.g. "📅 5"). Clicking navigates to season screen.
- **Import button:** Always visible on setup screen. Opens file picker for `.json` files. Merges imported games into local season data (does NOT overwrite — deduplication by date + player list + label). Shows feedback toast.
- **Default player list:** Pre-filled with 10 example names for the user's actual team (Avahna, Cara, Clara, Ellery, Gen, Grace, Imogen, Ivy, Luella, Maddy)

### 4.2 Result screen
The main working screen during a game. Has three tabs: Field, Schedule, Stats.

**Header row:**
- Title "⚽ Team Sheet" with subtitle showing player count, bench count, GK mode, edited flag (✏️)
- **✏️ Edit / Editing button** — toggles edit mode on field tab
- **💾 Save button** — opens/closes the save panel
- **📅 [count] button** — goes to season tracker
- **🔀 Reorder button** — (shown when season data exists) runs reorderBySeasonTotals and regenerates
- **← Players button** — back to setup, clears segments

**Half indicator:** Two pills showing "① First Half 0–25 min" and "② Second Half 25–50 min", the active half highlighted in green.

**Tab bar:** Field | Schedule | Stats (three equal-width tabs)

**Game Timeline (above field view):**
- Visual progress bar showing the full 50-minute game, with a green marker at the current segment
- Vertical line + "HT" label at the halfway point
- Segment buttons below the bar — clicking selects that segment to view
- Transition summary below the buttons: shows what changes happen between current and next segment (substitutions, GK swap, position changes)

#### Field tab
**View mode (default):**
- Left panel: vertical list of all 9 positions + bench, each showing the player name. Clickable to select/highlight a player.
- Right panel: interactive field graphic with circular player tokens. Click a player to highlight them.
- When a player is highlighted: shows a "journey panel" below the position list with their segment-by-segment positions and live goal counter (±1 buttons).

**Edit mode (activated by ✏️ Edit button):**
- Banner shows "✏️ Editing [period label] — changes only affect this period"
- Two-step tap-to-swap: tap first player/position (shows blue highlight), tap second (swap occurs immediately)
- Status banner shows selected player name and "tap another spot to swap"
- Bench players are also swappable (swap bench ↔ position, bench ↔ bench, position ↔ position)
- GK cannot be swapped when `gkFullGame` is true (shows lock icon 🔒)
- After swap: the segment is marked as `edited: true` (shown as ✏️ in timeline)
- Only the active segment is modified — other segments unchanged

#### Schedule tab
- Full grid table: rows = players, columns = segments
- Each cell shows the position (colour-coded badge) or BENCH (amber badge)
- Column headers show segment label, duration, and H2 marker (green left border at HT)
- Rows are clickable to highlight that player
- GK duty shown with 🧤 badge in the player name column
- Last column shows total minutes for each player
- **Substitution instructions panel below the table** (only shown if there are bench rotations):
  - For each segment transition that involves changes: shows a card with the time (e.g. "10 min") or "⚽ Half Time"
  - Each change listed as: position badge + "▲ PlayerComingOn replaces ▼ PlayerGoingOff"
  - Position changes (same player, different position) shown separately: "Player moves LM → CM"
  - GK swaps listed with magenta GK badge

#### Stats tab
- **Playing Time section:** Bar chart for each player showing minutes (0–50), percentage pill, GK badge (🧤), bench count badge (🪑)
- Time spread indicator: "X–Y min · Z min gap", green if ≤5 min gap, amber if ≤10, red if >10
- "All players benched" indicator: green ✓ if every player had at least one bench stint (not applicable when gkFullGame and 9 players)

**Save panel** (expands when 💾 Save clicked):
- Optional match label input (e.g. "vs Eastside FC")
- Player of the Match dropdown (all players, defaults to "— None —")
- Goals scored: per-player ±1 counter (pre-populated from live goal tracking on field tab)
- "💾 Save to Season" button commits the game
- Saving closes the panel and shows a toast "Game saved to season ✓"

### 4.3 Season Tracker screen

**Header row:**
- "📅 Season Tracker" title + "X games recorded" subtitle
- 🗑️ Clear All button (red, requires inline confirmation modal)
- ⬇️ Export button (green) — downloads JSON backup
- ⬆️ Import button (blue) — file picker, merges data
- ← Back button

**Games list:**
- Each game shown as a collapsible card. Summary line: "Game N · [label] · Xp · date · ⭐ POTM · ⚽ goals"
- Expand to see per-segment grid (same layout as Schedule tab)
- ✏️ edit icon per game: opens modal to correct goals and POTM after the fact
- 🗑️ delete icon per game: inline confirmation modal
- Delete shifts the active expanded index if needed

**Season Totals section:**
- Per-player rows sorted by total minutes (descending)
- For each player: name, game count badge, ⭐×N (POTM count), ⚽×N (goals), 🧤×N (GK games), 🪑×N (bench segments)
- Horizontal progress bar (relative to max minutes in squad)
- Total minutes + min/game figures
- Position tally badges (CM×3, LB×2, etc.) sorted by frequency

**Fairness Check section:**
- Compares each player's **minutes per game played** (not total minutes) against the squad average
- Players who haven't played any games show "No games played"
- Deviation shown in colour: green if within ±3 min/game, amber within ±6, red beyond
- This correctly handles absent players — missing a game doesn't count against them

---

## 5. Data Structures

### 5.1 Segment object (runtime)
```javascript
{
  assignment: { GK, LB, CB, RB, LM, CM, RM, LF, RF },  // all 9 positions, value = player name
  bench: string[],                                         // 0–3 player names
  half: 1 | 2,
  duration: number,                                        // minutes this segment
  gkName: string,                                          // = assignment.GK
  label: string,                                           // e.g. "H1 0–10"
  htBefore: boolean,
  edited: boolean
}
```

### 5.2 Saved game object (persisted)
```javascript
{
  players: string[],                     // ordered player list at time of save
  segments: Segment[],                   // full rotation including any edits
  stats: {
    minutesMap: { [player]: number },    // total minutes played (0–50)
    gkDutyMap: { [player]: 0 | 1 },     // 1 if player was GK at any point
    playerSchedule: { [player]: string[] }  // array of position per segment, "BENCH" for bench
  },
  gkFullGame: boolean,
  date: string,                          // "D/M/YYYY"
  label: string,                         // optional match label
  goals: { [player]: number },           // only non-zero values stored
  potm: string | null
}
```

### 5.3 localStorage
- **Key:** `teamsheet_season`
- **Value:** JSON array of saved game objects
- Auto-saves on every change to the season array
- Loaded on app mount via lazy useState initialiser
- **Per-device only** — no sync

### 5.4 Export/Import JSON format
```javascript
{
  version: 1,
  exported: "ISO8601 timestamp",
  games: SavedGame[]
}
```
Import also accepts a bare array (legacy). Deduplication logic:
```javascript
isDuplicate = (incoming.date === existing.date) 
           && (JSON.stringify(incoming.players) === JSON.stringify(existing.players))
           && (incoming.label === existing.label)
```

---

## 6. UI System

### 6.1 Colour palette
| Token | Value |
|-------|-------|
| Page background | `#f0f6ff` (radial gradient to `#d6e8ff`) |
| Card background | `#ffffff` / `#f5f9ff` |
| Borders | `#c7daf7` |
| Primary text | `#0f2d5a` (dark navy) |
| Secondary text | `#4a6b8a` |
| Blue accent | `#1558b0` / `#1d6fcf` |
| Green (success/active) | `#059669` |
| Amber (bench/warn) | `#b45309` / `#d97706` |
| Red (danger/delete) | `#f87171` / `#dc2626` |
| Magenta (GK) | `#d946ef` |

### 6.2 Toast notifications
- Duration: **2800ms** then auto-dismiss
- Two variants: `ok` (green border + text) and `err` (red border + text)
- Fixed position top-centre of viewport
- No stacking — new toast replaces old

### 6.3 Modal confirmations
**NO `window.confirm()` or `window.alert()`** — these are blocked in sandboxed iframes (the app must work in claude.ai preview and potentially in Electron's renderer). All confirmations use inline modal overlays.

Delete game modal:
- "🗑️ Delete Game N — [label]?" / "Clear all saved games?"
- "This cannot be undone."
- Cancel / Delete buttons (delete is red)

Edit game modal:
- POTM dropdown
- Per-player goal counters (±1)
- Cancel / Save Changes buttons

### 6.4 General UI rules
- All border-radius: 8–14px (rounded, friendly)
- Cards use subtle box-shadow
- Transitions: 0.15–0.25s on interactive elements
- Mobile-first — entire app must work on iPhone SE (375px wide)
- No external fonts — uses system-ui / Segoe UI

---

## 7. Key Decisions & Reasoning

These are decisions that were made deliberately and should not be changed:

**Why single-file HTML?** The app needs to work completely offline — coaches use it at fields without WiFi. The entire app including React is compiled into one ~260KB HTML file. No CDN dependencies.

**Why fixed formation?** The user runs one team with one formation. The complexity of configurable formations was explicitly deferred (see planned feature below).

**Why bench not counted in fairness per-game, but per minute?** Early versions counted bench stints as equal regardless of duration. With 12 players, bench stints vary between 10 and 15 minutes. Minute-accurate fairness tracking was added to handle this asymmetry.

**Why GK counted as 1 per game, not per half-stint?** Simplicity for the coach. A player who was GK "counts" for GK duty that game. The half-stint count is tracked internally for the fairness queue but displayed as per-game.

**Why no window.confirm?** App must run in sandboxed iframe environments (claude.ai preview). These environments block native dialogs entirely.

**Why position colours unchanged?** User explicitly requested these not be modified. The colour map is a fixed constant.

**Why deduplication on import rather than overwrite?** Coaches may use multiple devices (e.g. phone at the game, iPad at home). Import should safely merge data from any device without destroying existing records.

**Why the fairness check uses min/game not total minutes?** Players who miss games should not be penalised in the fairness view. Total minutes would make absent players look unfairly treated; min/game only counts games they actually played.

---

## 8. Issues Encountered (and solutions)

**Issue: window.confirm blocked in iframe**  
Solution: Replaced all confirms with inline modal components. Any future delete/clear operation must use this pattern.

**Issue: localStorage cleared by Safari ITP**  
Safari on iOS aggressively clears localStorage for sites not visited in 7 days. Also cleared when user clears browser data or in private mode.  
Solution: Export/Import buttons added (both on Season Tracker screen and on the landing/setup screen — landing screen access is critical because you can't get to Season Tracker without having existing games).

**Issue: GK swap also needs to propagate to other segments**  
When a swap is made in edit mode that changes the GK, all future segments in the same half need to update their GK tracking (the `gkName` field). This was handled in `applySwap` with a cascade update.

**Issue: Bench player swapping to bench**  
Tapping bench → bench (two different bench players) must swap their positions in the bench array, not be treated as a cancel. Fixed by distinguishing `type: "bench"` selections.

**Issue: Player count badge needed to show "bench" count**  
"10 players · 1 bench" is more informative than just "10 players". The badge formula is `players.length - 9` for bench count.

**Issue: 12-player bench is inherently unfair by ~10 min**  
With 12 players, bench durations are asymmetric (10 min and 15 min slots). Mathematical impossibility to equalise perfectly. The fairness check correctly identifies this and the season-level tracking corrects it over multiple games.

**Issue: Token size needed to respect device rotation**  
Initial implementation used a fixed size from first render. Added resize event listener to recalculate token size on orientation change.

---

## 9. Planned Next Feature (Multi-Age-Group)

The user runs multiple age group teams with different rules. This is the next major feature. Details are partially confirmed:

- **Age group selector** on setup screen (dropdown or segmented control)
- **Each age group has different:** team size, half length, formation, possibly no GK

Three formations are needed:
1. **Current (9v9):** GK + 8 outfield, 25-min halves — this stays
2. **Two more formations:** To be confirmed with user. One group likely has no GK (all-outfield rotation).

**Architecture changes needed:**
- `POSITIONS` and `FIELD_LAYOUT` arrays become per-formation config objects
- `getSchedule(n)` may need to be per-formation
- The no-GK formation needs the GK rotation logic entirely bypassed
- Saved game objects need to store which age group/formation was used
- Season tracker should be filterable by age group

**Open questions (confirm with user before building):**
- Are half lengths still 25 min for all groups?
- What is the player count range per age group?
- Does the no-GK group have any special position (e.g. a "sweeper" who is analogous to a GK for rotation purposes)?
- Are the three formations for three distinct teams the user coaches, or one team at different ages?

---

## 10. Build System (for reference)

The current PWA was built using esbuild. For the Electron rewrite this is replaced by Vite + Electron Builder, but the core React logic is identical.

**esbuild path (if needed for reference):**
```
/home/claude/.npm-global/lib/node_modules/tsx/node_modules/@esbuild/linux-x64/bin/esbuild
```

**Build command:**
```bash
$ESBUILD entry.jsx --bundle --minify --jsx=automatic --outfile=bundle.js \
  --platform=browser --target=es2018
```

**Entry point prep:**
```bash
cat > entry.jsx << 'ENTRY'
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
ENTRY
tail -n +2 soccer-team-sheet.jsx >> entry.jsx
sed -i 's/^export default function App()/function App()/' entry.jsx
echo "const root = createRoot(document.getElementById('root')); root.render(<App />);" >> entry.jsx
```

---

## 11. Electron App Requirements (New)

The rewrite target is an Electron desktop application. Additional requirements:

- **Cross-platform:** Windows and macOS at minimum
- **Offline-first:** No internet connection required (same as PWA)
- **Data persistence:** Replace localStorage with Electron's userData directory (via `electron-store` or similar). The JSON schema for saved games is identical.
- **Export/Import:** Must still work — now saves to the filesystem via native file dialog (Electron's `dialog.showSaveDialog` / `dialog.showOpenDialog`)
- **Window size:** Should default to a reasonable desktop size (e.g. 1024×768 minimum) but the UI must still be usable at narrower widths for tablet/laptop
- **No frame chrome needed** — the app has its own header UI; a frameless window with custom drag region is fine

---

## 12. Starting Prompt for Claude Code

When starting the rewrite, say:

> "I need you to build a MiniRoos (9v9 junior soccer) team sheet planner as an Electron desktop app. I have a detailed handoff document. The app is currently working as a single-file React PWA — I need it rebuilt as a proper Electron app using React + Vite + electron-builder. Here is the complete specification: [paste this document]"

Attach or reference this document. The existing `team-sheet-offline.html` can also be uploaded as a reference for the exact visual output expected.
