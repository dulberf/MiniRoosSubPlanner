# MiniRoos Sub Planner — UI Handoff for Gemini
*Created: 29 March 2026*

---

## What This Is

You are reviewing the UI/UX of a substitution planner for 9v9 junior soccer (MiniRoos). The app is a **single self-contained offline HTML file** used by coaches on an iPad at the sideline with no WiFi.

**Live version:** https://dulberf.github.io/MiniRoosSubPlanner/team-sheet-offline.html
**Repo:** https://github.com/dulberf/MiniRoosSubPlanner

> Claude Code handles the algorithm and architecture. You handle UI/UX. Changes from either side get reviewed by the other before merging.

---

## How to Run Locally

```bash
cd MiniRoosSubPlanner
npm install
npm run dev          # Dev server at http://localhost:5173
npm run release      # Production build → team-sheet-offline.html
```

Build tool is **Vite** with `vite-plugin-singlefile` — everything gets inlined into one HTML file.

---

## Tech Stack

- **React 18** (JSX, functional components, hooks)
- **No CSS files** — 100% inline React style objects
- **No component library** — all custom components
- **No external fonts** — system-ui / Segoe UI only
- **No CDN or network calls** — fully offline
- **Animations** — CSS keyframes injected in `index.html` (`glow`, `spin`)

---

## Project Structure (UI-relevant files only)

```
MiniRoosSubPlanner/src/
├── main.jsx              # React entry point
├── App.jsx               # Root component — state, view routing, handlers
├── constants.js          # Positions, colours, field layout coords, defaults
├── scheduler.js          # Algorithm only (Claude's domain — don't modify)
└── components/
    ├── InputView.jsx     # Setup screen (player names, GK toggle, import/export)
    ├── TeamSheetView.jsx # Main game view (Field / Schedule / Stats tabs)
    ├── SeasonView.jsx    # Season tracker (game history, totals, fairness)
    ├── FieldView.jsx     # Interactive pitch diagram with positioned tokens
    ├── FieldSVG.jsx      # SVG pitch markings overlay
    ├── PlayerToken.jsx   # Circular player badge (colour-coded by position)
    ├── SwapPanel.jsx     # Edit-mode: select players to swap
    └── Toggle.jsx        # Custom toggle switch
```

---

## App Flow

1. **Setup screen** (`InputView`) — Coach enters 9–12 player names, optionally locks GK for full game, hits "Generate Team Sheet"
2. **Game view** (`TeamSheetView`) — Three tabs:
   - **Field** — Interactive pitch showing current segment's formation, with tap-to-swap editing
   - **Schedule** — Table view of all segments with positions and bench
   - **Stats** — Per-player playing time bars, GK duty, bench counts
3. **Season tracker** (`SeasonView`) — Saved game history with cumulative stats and fairness metrics

---

## UI Architecture Details

### Views & Routing
`App.jsx` manages a `view` state (`'setup'` | `'result'` | `'season'`) — no router library, just conditional rendering.

### Styling Approach
All styles are React inline style objects. There are no CSS classes or stylesheets except minimal resets and two keyframe animations in `index.html`.

### Responsive Design
- Field token sizing uses a **ResizeObserver** on the field container (not `window.innerWidth`)
- Token size formula: `Math.min(108, Math.max(40, Math.round(containerWidth * 0.21)))`
- Font inside token: `Math.max(8, size * 0.19)`
- Layout uses percentage-based positioning, flexbox, and CSS grid

### Colour Palette (LOCKED — do not change)
| Element | Colour |
|---------|--------|
| Page background | `#f0f6ff` |
| Primary text | `#0f2d5a` |
| Blue accent | `#1558b0` / `#1d6fcf` |
| Green | `#059669` |
| Amber | `#d97706` |
| Red | `#dc2626` |
| GK magenta | `#d946ef` |

### Position Colour Scheme (LOCKED — do not change)
| Position | Background | Text |
|----------|-----------|------|
| GK | Magenta `#d946ef` | Dark navy `#0f172a` |
| LB, LM, LF | White `#ffffff` | Dark `#0f172a` |
| CB, CM | Light grey `#b0bec5` | Dark `#0f172a` |
| RB, RM, RF | Black `#111827` | White `#ffffff` |

### Formation Layout (fixed percentages in `constants.js`)
```
         LF(30,19)    RF(70,19)

    LM(20,42)   CM(50,42)   RM(80,42)

    LB(20,65)   CB(50,65)   RB(80,65)

              GK(50,88)
```

---

## Hard Constraints

1. **Offline-first** — no network calls, no CDN, no external resources
2. **Single HTML output** — `npm run release` must produce one self-contained file
3. **No `window.confirm()` or `window.alert()`** — the app runs in a sandboxed iframe on GitHub Pages. Use inline modal overlays
4. **No external fonts** — system-ui only
5. **Date format** — `D/M/YYYY` (not zero-padded)
6. **Toast notifications** — 2800ms auto-dismiss, `ok` (green) or `err` (red) via `showToast(msg, type)` in `App.jsx`
7. **Safari ITP** — localStorage gets cleared after 7 days of no visits. Export/Import buttons are the safety net; don't remove them
8. **Don't modify `scheduler.js`** — that's Claude's domain. UI changes only

---

## Recent Algorithm Changes (for context)

Claude just completed two phases of scheduler improvements:

**Phase 1 — Undersized squad support:**
- `getSegmentConfig` now handles squads of fewer than 9 players
- `buildSchedule` safely handles negative bench sizes
- `getSecondGKSlot` refactored to derive config dynamically (removed hardcoded lookup)

**Phase 2 — Positional continuity:**
- Players returning from the bench now prefer their previous outfield position instead of being assigned arbitrarily
- `applySwap` modernised from `JSON.parse(JSON.stringify())` to `structuredClone()`

These are algorithm-only changes with no UI impact, but they mean the schedule data flowing into the UI components is now more tactically stable.

---

## Pending UI Tasks (from HANDOFF.md §6)

| # | Task | Status |
|---|------|--------|
| 6.1 | Increase player circle size | Done |
| 6.2 | Remove glow/spin animations from tokens | Open |
| 6.3 | Match result — scoreline tracking | Open |
| 6.4 | Player number on token | Open |
| 6.5 | Assist tracking | Open |
| 6.6 | Improve statistics display | Open |

See `HANDOFF.md` for full details on each task.

---

## Coordination Protocol

1. **Propose UI changes** with screenshots or descriptions
2. **The owner will run changes by Claude** for review before merging — especially anything touching `App.jsx` state/handlers or data structures
3. **Don't modify `scheduler.js`** — if a UI change needs algorithm support, flag it and Claude will implement
4. **Test at three widths:** 375px (phone), 768px (iPad), 1024px (desktop)
5. **Build check:** Run `npm run release` after changes to confirm the single-file output builds clean

---

## Reference

The full authoritative codebase description is in `HANDOFF.md` at the repo root. Read that for deep detail on segment shapes, data structures, swap propagation logic, and saved game format.
