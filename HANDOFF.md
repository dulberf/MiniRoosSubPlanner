# MiniRoos Sub Planner — Technical Handoff
*Last updated: 2026-08-02 (Session 18 complete — on `main`)*

**Repo:** https://github.com/dulberf/MiniRoosSubPlanner
**Live app:** https://dulberf.github.io/MiniRoosSubPlanner/
> ⚠️ The old `…/team-sheet-offline.html` URL in earlier versions of this file **404s** — that file is
> not part of the deployed output. Corrected in Session 15.
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
│   ├── constants.js               # Positions, wristband colours, UI tokens, field layout, storage keys
│   ├── useScale.js                # Maps the 1024px design onto the actual viewport — s(px) helper
│   └── components/
│       ├── InputView.jsx          # Setup screen (3a) — roster chips, H1/H2 GK chip rows, pip strip, import
│       ├── TeamSheetView.jsx      # Live game screen — header/pips/pitch/bench rail/action stack
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
```

### How deployment actually works (documented in Session 15)
**Pushing to `main` deploys.** `.github/workflows/deploy.yml` runs `npm ci && npm run build` on every
push to `main` and publishes **`dist/`** to GitHub Pages. So:
- The live app is `dist/index.html`, served at the site root — **not** `team-sheet-offline.html`,
  which is committed for offline/manual use but is not part of the deployed output (it 404s live).
- `public/` is copied into `dist/` by Vite, which is how `sw.js`, `manifest.json` and `icon.svg`
  reach the live site. A change to `public/sw.js` **does** ship on the next push to `main`.
- `npm run release` is therefore for the committed offline file only; it is not what deploys.

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
Token size is measured from the rendered pitch box via ResizeObserver (not `window.innerWidth`), with
the cap and floor scaled by the design factor — 124/96 at 1024px wide, 98/76 on the coach's iPad.
Since Session 13 the pitch is sized from the available **height** (`aspectRatio: 100/148` + `flex: 1`),
so the measured width is a result of the layout, not an input to it. Do not go back to
`paddingBottom: 148%` — it overflows the pitch/rail split.

Token borders are constant navy (`UI.navy`), or `UI.stop` red when that player is in the next change.
The per-position inverted border was removed in Session 13 — `POS_BORDER` still exists in
`constants.js` but is no longer used on the field.

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

### Session 18 — 🚨 Offline broken at a game. Root-caused and fixed ✅
**This is the most important entry in this file. Read it before touching `public/sw.js`.**

**What happened.** At a match on 1/8/2026 the app would not open with no network — a Safari
network-error page, not a blank screen. Connecting a phone hotspot fixed it; disconnecting broke it
again. The coach ran the game manually and lost the minutes, goals and assists for it.

**Root cause, measured on the live site — not theorised.** After a successful online load the
`team-sheet-v2` cache contained **exactly one entry: `sw.js`**. The app itself was not in it:

```
cachedEntries: [".../sw.js"]   matchesCurrentPage: false   matchesIndexHtml: false
```

Three properties of the Session 15 worker combined:
1. **Nothing was precached at install.** The cache only ever held what the worker happened to
   intercept via cache-on-fetch.
2. **The navigation that installs a worker is not controlled by it**, so the *first* page load after
   any deploy was never cached. Only the second load stored the app.
3. **`activate` deleted the previous cache immediately**, before anything had replaced it.

So the Session 15 deploy **wiped the populated `team-sheet-v1` cache that had been working all
season** and left an empty `v2`. Whether the app survived offline then depended on whether a second
load happened to occur before the iPad left the house. It didn't. `networkFirst` found nothing to
fall back on, rethrew, and the browser showed its own error page.

**⚠️ The Session 15 entry below claims "Verified, not assumed" and describes a "true offline test".
That verification was invalid** — it drove the service worker API directly against the dev server,
but `index.html` deliberately *unregisters* workers on localhost, so the deployed path (real
navigation, PWA on iOS, a cache emptied by activate) was never exercised. **A service-worker change
is only verified on the deployed HTTPS origin. Localhost cannot test this subsystem at all.**

**The judgement error worth remembering.** The pre-Session-15 worker was cache-first and never went
back to the network — which is exactly why it always worked at a field. Session 15 framed that as
the bug ("answered *every* request from cache and never went back to the network"). The inability to
update was a real problem, but the fix traded away the guarantee the app exists for, and shipped the
trade as an improvement. **Both are achievable. Offline wins ties.**

**What `public/sw.js` (`team-sheet-v3`) does now:**
- **Precaches the shell at INSTALL** — `./` required, `index.html`/`manifest.json`/`icon.svg`
  best-effort — with a plain-`add` fallback if `cache: 'reload'` is rejected. A working copy exists
  before any navigation. **This is the piece whose absence caused the failure. Do not remove it.**
- **Page loads are cache-first.** The app opens from cache with zero network on the critical path;
  the refresh is fetched in the background and applies on the next open. Updates still land.
- **Never deletes an old cache until the new one can actually serve the app.** If install fails
  (offline, say), the old worker and its populated cache survive intact — the failure mode inverted.
- **`AbortController` + timeout on background refreshes, skipped entirely when
  `navigator.onLine === false`**, so a dead signal cannot leave the radio hunting. The old `timeout()`
  helper also leaked a timer per request and never aborted the losing fetch.
- **Revalidates navigations only**, not every asset — the build is one inlined file, so that is one
  background request per open instead of four.
- **All cache bookkeeping is wrapped so it can never affect the response.** The old code let a failed
  `waitUntil` fall into the `catch` and rethrow, turning a bookkeeping error into an error page.

**Verified on the deployed origin, from a fully cleared state (SW unregistered, all caches deleted):**
- **One** load now caches `./` + `index.html` + `manifest.json` + `icon.svg`; the shell is 266,511
  bytes and contains the real app. Previously one load cached only `sw.js`.
- Only `team-sheet-v3` remains — `v2` was swept *after* the new shell was confirmed present.
- **Navigating to a path GitHub Pages 404s served the full working app from cache**, not a 404 page.
  That is the offline path proven: the worker answers navigations from cache regardless of what the
  network says.
- Background revalidation fires on navigation (confirmed in the network log), so updates still reach
  the device on the next open.
- No console errors.

⚠️ **Still not proven by me: real airplane-mode cold open on the coach's iPad from the home screen.**
That is the coach's check, and it is the only one that counts. Do not write "verified offline" in
this file for anything short of it.

**Battery (15% → 4% in 17 minutes, reported same day).** Investigated with measurements:
- **Ruled out: the 500ms clock tick.** The rendered tree is **146 DOM nodes**. Reconciling that twice
  a second costs nothing. It was left alone rather than "fixed" for appearances.
- **Fixed: the wake lock now follows the clock** — acquired while a period runs, released when it
  stops, released on unmount, and not re-taken when returning to a *paused* game. It previously held
  the screen awake through all of half-time and indefinitely after the final whistle. The screen is
  the app's dominant power cost, so this is the one change that matters.
- **Not done: suspending the `AudioContext`** between buzzes. It is created on START and never
  suspended (there is no `suspend()`/`close()` anywhere in `src/`), which is technically wrong, but
  iOS attributed only ~6% of consumption to Safari — it is a rounding error, and the buzzer code has
  already caused one production crash (Session 7 TDZ). Left deliberately. Revisit only with evidence.
- **Honest conclusion:** most of that drain was the iPad itself — radio hunting with no coverage
  while the app repeatedly failed to open, plus a screen held on in the sun. The offline fix removes
  the scenario. The device also started the match at 15%.

**New: a `WORKS OFFLINE ✓` / `NOT SAVED YET — STAY ON WIFI` badge** in the setup-screen header
(`src/useOfflineReady.js`, read from CacheStorage directly rather than from the worker's opinion of
itself; renders nothing on localhost). The failure was invisible until it mattered. Now it isn't,
and the coach does not have to take anyone's word for it.

**Files touched:** `public/sw.js` (rewritten), `src/useOfflineReady.js` (new),
`src/components/InputView.jsx`, `src/components/TeamSheetView.jsx`, `team-sheet-offline.html`
(rebuilt), `HANDOFF.md`.

**Rules going forward:**
- **Never deploy a service-worker change on a Friday**, or in the 48 hours before a game.
- **Test service-worker changes on the deployed HTTPS origin**, from a cleared state, and check the
  cache contents after exactly **one** load.
- **Offline beats freshness.** Any future change that puts the network on the critical path of a page
  load is a regression, regardless of what it buys.

### Session 17 — Design screens 3b (squad sheet) + 3c (player off) + 3d (minutes prompt) ✅
Built as one lump on purpose: 3b **deletes** the two modals 3c replaces, so splitting them would
leave the app half-migrated. Same v3 bundle as Session 16.

**LATE PLAYER and PLAYER OUT are gone — as buttons and as modals.** The squad sheet's chip grid is
now the roster editor: tap a playing chip to take someone off, tap a dashed chip to bring them back.
It also answers "who is actually here", which the old sheet never did.

**3b — the sheet is a right-hand side sheet, not a centred modal.** `min(s(648)px, 92vw)`, full
height, over a `UI.scrim` backdrop, anchored to the **top of `<main>`** so the header and pip strip
stay visible above it. **This is the point, not decoration** — losing sight of the clock is the
failure mode the whole redesign exists to fix, and a centred modal over a running game reintroduces
it. The top is measured via a `bodyRef` + `getBoundingClientRect` on open and on resize, *not*
recomputed from `s()` sizes, which would drift the moment the header changes.

Structure: header with a live count line ("11 here · 9 on · 2 on the bench") → WHO'S AVAILABLE chip
grid → REARRANGE THE LINEUP / SHOW THE KIDS → MATCH NOTES → START AGAIN pinned to the bottom.
- Chip states: navy fill = on the field (`RM · ON`), white = bench (`BENCH · ON AT 17` via
  `nextAppearance`), **dashed = not here**, amber = the player whose 3c panel is open (`GOING OFF`).
- ⚠️ The chip uses the **short** position key (`RM`); the 3c panel heading uses `POS_LABEL`
  ("WHO TAKES RIGHT MID NOW?"). The design does both and the grid has no room for the long form.
- Notes moved low in the sheet deliberately — a half-time, standing-still task that must not compete
  for the thumb.
- **`Wipe the game` is a 2-second hold**, not a tap, with a fill gradient and a KEEP HOLDING… label.
  It is the only irreversible action in the app and it used to sit a thumb-width from the notes box.
  The timer is cleared on release, on unmount, and whenever the sheet closes, so a half-finished hold
  can never carry into a later tap. **Verified both ways: a full hold wipes; a tap does nothing.**
- Two routes to the sub survive but are named differently. The fast path is the pitch (tap the
  player → MOVE POSITION); the sheet's is REARRANGE THE LINEUP, the deliberate several-players path.

**3c — a player comes off. Expands in place inside the sheet**, amber not red: this changes the
plan, it is not an error. Bench chips are labelled with minutes played and default to the lowest,
matching `pickReplacement()` in `replan.js`.
- **The "what this does to the rest" copy is the honest version and must stay that way.** The
  removed player's minutes are *not* handed to one substitute: `buildRemainderForHalf` rebuilds the
  rest of the half and an H1 removal also triggers `buildFreshHalf` for the whole second half. The
  panel says the later periods will not match the board. The coach notices ten minutes later
  otherwise, and stops trusting the app.
- Both blocked states are stated **in the panel, never as a thrown toast**: tapping the GK shows
  "Pick a new goalkeeper first" with a single ALLOCATE GK button, and the `MIN_SQUAD` floor states
  the block. `MIN_SQUAD` / `MAX_SQUAD` are now **exported from `replan.js`** — one source of truth,
  do not re-declare them in the view. (The 6-player floor panel is reasoned and shares the constant
  but was not exercised in the browser; reaching it needs six removals.)

**3d — "When did this happen?" promoted from a modal-on-a-modal to a screen of its own.**
- Amber header inheriting the 2a rule, sub-line `P3 · 1ST HALF · CLOCK NOT RUNNING`.
- One 96px bar split at the entered minute — navy `LOCKED — CAN'T CHANGE` / white `THIS EDIT APPLIES
  HERE`. This is the visual form of `splitSegment` and it is why the answer matters.
- 108px −/+ steppers around a 72px readout, **clamped rather than disabled** so the control never
  feels stuck, plus `Right at the start` / `Halfway` / `Nearly the whole period`. Halfway is the
  default, and is what a coach actually knows.
- IF YOU GET THIS WRONG panel: minutes shift by however far out you are, say half a period if
  unsure, correctable from the season screen. A prompt that can't be answered confidently gets
  dismissed carelessly, which is the same bug wearing a hat.
- ⚠️ **The hard constraint is unchanged**: the flow still asks when the change happened whenever the
  clock isn't timing the current period. That question is the entire fix for the Round-8 bug that
  left one player on 25 minutes and another on 50. The Session-12 guarded escape hatch ("change the
  whole period", disabled once the period has elapsed time) is preserved verbatim.
- `confirmSubFromTime` now takes the minutes explicitly (`confirmSubFromTime(clamped)`) and falls
  back to the input state.

**Bug found and fixed during verification:** the period's kickoff-relative start was read as
`seg.label.match(/(\d+)/)` — which matches the **1 in "H1"**, so P1 of a 12-player game displayed
as "MINUTE 1 TO 11" instead of 0 to 10. Now summed from prior segment durations.

**Verified end-to-end in the browser at 810 × 1080, clock running, real season loaded:**
sheet anchors at the top of `<main>` (159px) and is 513px wide, header and pips still visible →
tap Ivy → 3c panel with the right position and replacement chips → tap the GK → GK block panel, not
a toast → REARRANGE THE LINEUP → 3d → steppers clamp at 1, bar splits 1/9, CTA singularises to
"1 MINUTE IN" → CARRY ON at halfway **splits P1 into a locked P1 ✓ and a live P2**, pips go P1–P4 →
P1–P5, edit mode opens → FINISH EDITING → take Clara off (keeps her 5 real minutes, Cara takes right
mid) → she reappears **dashed, NOT HERE** → tap her back on → she is in the bench rotation again
("Clara ▲ ON for Noa · RB"). **No console errors. 24/24 tests.**

**Files touched:** `src/components/TeamSheetView.jsx`, `src/replan.js`, `team-sheet-offline.html`
(rebuilt), `HANDOFF.md`.

**Left from the v3 bundle:** the accessibility pass (tokens and rail cards → real `<button>`s with
aria-labels; the new sheet's controls are already real buttons).

**4b landscape is deliberately not being built.** The coach's call, 29/7/2026: *"I am not too
concerned with the landscape mode, we don't really use it."* The iPad is held in portrait at the
ground. The design and its render are in the bundle if that ever changes — it is a layout branch
(flex direction, pitch viewBox 100×148 → 148×100, action stack unstacks into a row), not a second
component. Do not spend a session on it without asking first. Note this also settles the "landscape
/ portrait orientation" open question in the Obsidian product note.

### Session 16 — Design screens 3a (match setup) + 4a (honours) ✅
**Source:** `Football app sideline interface v3.zip` — the third export of the design bundle.
v3 is the first one that carries renders for the TURN 3 / TURN 4 screens; v2's README described
them but shipped a `Sideline UI.dc.html` byte-identical to v1's, containing only TURN 1–2.
Scope agreed with the coach: **3a and 4a only.** 3b/3c/3d and 4b remain to build.

**⚠️ The renders draw invented period durations — do not build to them.** 3a's pip strip shows an
11-player game as P1 0–9, P2 9–17, P3 17–25; the real `getSegmentConfig(11)` is `[5,10,10,10,10,5]`,
so it is 0–5, 5–15, 15–25. 3d has the same problem ("MINUTE 17 TO 25"). The implementation reads
`config.durs` and is correct; verified in the browser at 12 players (0–10 · 10–25 · HT · 25–35 ·
35–50) and 10 players (ten 5-min periods, HT after P5), both matching the table above.

**3a — Match setup (`InputView.jsx`, full rewrite).** Navy chrome and `UI` tokens; the ✅/❌ emoji
roster toggles become navy-fill chips in a 4-column grid; the squad-count badge is the only status
colour on the screen; the amber game-plan card becomes the live screen's period-pip strip plus three
fact tiles. The two GK `<select>`s — the last dropdowns in the app — become chip rows.

Three corrections were applied to the design's drop-in before it went in:
1. **The drop-in's GK ordering was dead code.** It ranked players by `g.gkH1` / `g.gkH2` on saved
   games. **Those fields do not exist** — GK history lives in `segment.half` + `assignment.GK`. The
   sort was a silent no-op and the row rendered in squad order under a heading promising fairness
   ordering. See the new `rankByGKFairness` below.
2. **Text floors** were at 11/12/13px (below the 15px minimum on the coach's 810px iPad). All ≥15.
3. **"Same as 1st half" could not work** — see the `gkFullGame` fix below.

Also changed from the drop-in: the second-half chip row **excludes whoever is keeping goal in the
first**, because picking them there means something specific (the full 50) and that gets its own
chip rather than being a silent collision. The absent-player hint names who is out
("Cara, Ivy out today — tap to add anyone who turns up late").

**`scheduler.js` — new export `rankByGKFairness(players, history)`.** Ranks the *whole* list by who
is most overdue a turn in goal: stints asc → longest-since asc → stable order. **This is not
`orderPlayersForGame`.** That function ranks only its first two slots by GK fairness and fills the
rest by *bench-minute* fairness (`scheduler.js`, the `emptySlots` / `byBench` block) — a different
axis. Using it for the chip row put the wrong names in chips 3 and 4, which are half of what the
coach sees before the "Everyone else ▾" expander. `orderPlayersForGame` now calls the new helper
for its own GK ranking, so there is one implementation, and a shared `tallyGKHistory` does the
history walk. **No behaviour change to `orderPlayersForGame`'s output** — 17/17 pre-existing tests
pass unchanged.

**The full-game keeper was unselectable, and had been since Session 6.** The auto-suggest effect
kept a chosen `gkH2` only when `gkH2 !== finalH1`, so setting them equal was overwritten by the
oracle on the next render. The old `<select>`'s "same as H1 — full game" option was clobbered
identically — this was **not** a regression from the new screen, which merely made it visible.
Fixed with an explicit `gkFullGame` boolean in `App.jsx`:
- The flag is what separates a *deliberate* full-game keeper from the *accidental* H1/H2 collapse
  the Session-6 collision guard exists to prevent. Without it the two are indistinguishable: tapping
  X in the H1 row while the oracle already has X in H2 would silently hand one child 50 minutes in
  goal. **Do not "simplify" this by dropping the `!== finalH1` guard on its own.**
- Applied in both `handleReorder` and the auto-suggest effect; persisted through
  `saveInProgress`/resume so a resumed full-game match isn't re-oracled.
- Picking a named 2nd-half keeper clears the flag (handled in `InputView`, or the effect would force
  it straight back).
- **Verified end-to-end:** chip sticks → "Grace keeps goal for the full 50 minutes" → fact tile flips
  to "50 min in goal" → `buildSchedule` returns Grace as GK in all four segments → `calcStats` gives
  her 50. That path was unreachable before.

**4a — Honours (`TeamSheetView.jsx`), replaces 2c.** The green block asked "who has never had
either", which is only a real question for the first few rounds; on the real 11-game season every
player has an honour and the block that carried the screen **rendered empty** (noted as expected in
Session 14 — it wasn't). The block now asks **who has gone longest without one**, which works
identically in round 1 and round 30 because "never" sorts ahead of any round number.
- `eligibleForHonour` / `honouredSorted` replaced by `overdueOrder`, `dueNext` (top 4 *playing
  today*) and `everyoneElse`. `roundsSince(p, caps)` renders "never had one" / "last round" /
  "N rounds ago" — an argument, where the old `last: R7` was a database field.
- The **save modal's chip rows (2d) use the same shortlist**, so the two screens agree.
- **The empty state was deleted, deliberately.** "No games saved yet" now contradicts a shortlist
  that reads NEVER HAD ONE for everyone, which is the correct round-1 answer.
- ⚠️ `overdueOrder` must not be used with `Array.prototype.sort` on the `players` prop directly —
  it is React state. The design README's snippet does exactly that; the implementation copies first.

**Verified in the browser at 810 × 1080 against the real 11-game season** (seeded from
`teamsheet-season-2026-07-06-corrected.json`), against a hand-computed expectation:
- 12 playing → shortlist Cara 7 · Ellery 5 · Clara 4 · Grace 4; then Ivy/Lyla 3, Gen/Maddy 2,
  Luella/Noa 1, Avahna/Imogen last round. Matches by hand.
- Cara and Ivy marked out → **Cara correctly drops out of the shortlist** (it promises "playing
  today"), Ellery leads, and both render dashed at 0.55 opacity with "not playing today".
- No console errors. **24/24 tests** (17 existing + 7 new in `test/gk-fairness.test.mjs`).

**Files touched:** `src/scheduler.js`, `src/components/InputView.jsx`, `src/App.jsx`,
`src/components/TeamSheetView.jsx`, `test/gk-fairness.test.mjs` (new), `team-sheet-offline.html`
(rebuilt), `HANDOFF.md`.

**Still to build from the v3 bundle:** 3b squad sheet, 3c player-off, 3d minutes prompt (one flow —
3b deletes the modals 3c replaces, so splitting them leaves the app half-migrated), then 4b
landscape, then the accessibility pass. *(3b/3c/3d done in Session 17.)*

### Session 15 — Service worker: stale-forever fixed, ⚠️ BUT OFFLINE WAS BROKEN ⚠️
> **🚨 Read Session 18 first. This entry is kept for the history, but its central claim is false.**
> It says offline was preserved and "verified". It was not: the change removed the guarantee and the
> app failed to open at a game two weeks later. The "true offline test" described below never touched
> the deployed path. Do not use this entry as a model for how to verify a worker.
**The constraint that drove every decision here:** the app is used on a football field with **no
wifi**. It must open with no network, every time. That is not negotiable, and it is why the worker
still caches everything the app fetches on the way past (cache-on-fetch) rather than from a
hardcoded file list — that part of the original design was right and is unchanged.

**What was wrong.** The old worker answered *every* request from cache and never went back to the
network, and `CACHE = 'team-sheet-v1'` was hardcoded so the `activate` cleanup (which deletes caches
*other than* the current one) could never clear it. Once a browser loaded the app it kept that exact
build permanently. A pushed update could not reach the iPad, and a bad cached state could not heal.

**What changed (`public/sw.js`):**
- **Page loads: network-first with a 2.5s timeout, falling back to cache.** No network means fetch
  rejects (or times out) and the cached app is served exactly as before. The timeout matters more
  than it looks: a dead network usually rejects instantly, but a weak signal or a captive portal at
  a ground can hang, and the coach cannot wait.
- **Everything else: stale-while-revalidate** — instant from cache, refreshed in the background.
- `skipWaiting()` + `clients.claim()`, and the cache name bumped to `team-sheet-v2` so activation
  clears the stale v1 cache. **This is what lets already-installed devices self-heal** — no need to
  delete and re-add the home screen app.
- `SW_VERSION` constant plus a `sw:version` message handler, so a page can ask which worker is
  actually running. "Is the browser still on the old worker?" is otherwise unanswerable and is the
  first question worth asking when caching misbehaves.

**Two real bugs caught by testing, both of which would have broken offline:**
1. `putInCache` cloned the response *after* `await caches.open()`. By then the page may already have
   read the body, the put silently fails, and nothing is cached. **The clone must be taken
   synchronously at the call site** — there is a comment saying so; do not tidy it back inside.
2. The cache write was not registered with `event.waitUntil()`, so the browser was free to kill the
   worker as soon as `respondWith()` settled, cancelling the pending write. Classic, and invisible
   until you check the cache is actually populated rather than assuming it.

**`index.html`:** the worker is now registered **everywhere except localhost**, and on localhost any
worker left by a previous dev session is actively unregistered. A worker on the dev server pins old
bundles for the rest of the session — it served Session-12 code for an hour during Session 14 and
produced a blank page on `http://localhost:5174`. Offline support on the dev server is pointless
anyway.

**Verified, not assumed:**
- New worker activates immediately, claims the open page without a reload, and deletes the stale
  `team-sheet-v1` cache.
- Version handshake confirms which script is live (`2026-07-29.1`).
- **True offline test:** stopped the dev server (0 listeners on 5174, `curl` exit 7), then through
  the worker — an **uncached** resource failed (proving the network really was dead) while a
  **cached** one was served in 2ms. That is the field behaviour.
- **Season data survived every one of those cache deletions**: 11 games still in `localStorage`
  afterwards. Worth stating plainly because it is the obvious fear — the worker caches *files*;
  season data lives in `localStorage` under `teamsheet_season` and this worker never touches it.
  The actual data-loss risk is Safari ITP clearing localStorage after 7 days of non-use, which is
  what the Export button is for.

⚠️ **On deploy:** the browser picks up a changed `sw.js` on a navigation, so the first open after
pushing may still show the old app; the new worker then activates and clears v1, and the next open
is current. Open it once on wifi at home before relying on it at a ground.

### Session 14 — Sideline UI redesign, part 2: honours, save, season ✅
**Branch:** `ui/sideline-redesign` (still not merged — test at a game first).

Completes the design bundle: screens **2c honours**, **2d save** and **2e season**. `InputView`
(Match Setup) is deliberately untouched — a new design for it is being drawn separately.

**2c Honours** (`TeamSheetView`): a green **NEVER HAD EITHER — PICK FROM HERE** block listing only
today's squad members with zero honours; tapping a chip pre-selects them for POTW in the save modal.
Below it, **ALREADY HONOURED** rows with ⭐/🏅 counts and `last: R7`, sorted **today's squad first,
then longest-since-last-honour first**, so the most overdue player is nearest the top. Players not in
today's squad render dashed at 55% with "not playing today".
- New `honours` memo in `TeamSheetView` — `{ potm, captain, lastRound }` per player, where
  `lastRound` is the 1-based index of the most recent game they were POTW or captain.
- ⚠️ With the real 11-game season loaded, **every player has already had an honour**, so the green
  block rendered empty. This was recorded here as "the right answer, not a bug". **It was a bug** —
  an empty centrepiece answers nothing. **Superseded by 4a in Session 16**, which changes the
  question to "longest without one" so the block is never empty.

**2d Save** (`TeamSheetView`): both `<select>`s replaced by chip rows via `honourChipRow()`. Eligible
("never had one") players show by default with an "Everyone else ▾" expander; when nobody is eligible
the full squad shows **sorted by longest-since-last-honour**. Selected chip goes navy with a ✓.
Helper line under each row. Mismatch warning sits directly under the score. **`onSave` payload is
byte-identical to before** — this was a presentation change only.

**2e Season** (`SeasonView`, full rewrite): the 11-column table is gone — it could not be read on a
phone or in sun, which made the fairness data effectively invisible. Replaced by four tabs:
- **FAIRNESS** — one row per player: wristband swatch (their most-played position), name, bar,
  average minutes, `7 games · GK ×2`. Sorted descending; the lowest gets a red border and `lowest ·`.
  Footer names the three players furthest behind, as a **statement of fact, not a promise** about
  what `buildSchedule` will do — it shuffles positions and the coach can override anything.
- **MATCHES** — the game history cards, restyled, with edit/delete and the per-player expansion.
  **Reset Season moved here behind a confirm** (it used to sit one tap from a destructive wipe in
  the header) and the confirm now suggests exporting a backup first.
- **HONOURS** — POTW, captain, GK H1/H2 split, bench minutes.
- **GOALS** — goals bar chart plus assists.
Nothing was deleted; everything from the old table was re-homed. `SeasonView` now uses `useScale`.

**Verified against the real 11-game season export** (`teamsheet-season-2026-07-06-corrected.json`
seeded into localStorage): all four tabs, honours sheet, save modal. Totals reconcile — 59 goals in
the GOALS tab matches "59 goals for" in the header. 17/17 tests.

**⚠️ Service worker is broken and will block this release — see Known Issues.** Found while trying to
see these changes in the browser: the dev preview kept serving Session-12 code no matter what.

### Session 13 — Sideline UI redesign, part 1: live game + player sheet ✅
**Branch:** `ui/sideline-redesign` (not merged to main — test at a game first).

**Source:** design handoff bundle `Football app sideline interface.zip` (Claude Design session) —
`design_handoff_sideline_ui/README.md` is the spec, `screens/*.png` the renders, `Sideline UI.dc.html`
the reference prototype. Scope agreed with the coach: screens **2a (live game)** and **2b (player
answer sheet)** only. `2c` honours, `2d` save and `2e` season are next session; they keep their
current layout and open from the new tool row.

**The four problems it fixes** (all coach-reported):
1. *Subs get missed* — the boundary popup ("Period N started, call these subs" + Got It) is **deleted**.
   Replaced by a persistent red **✓ SUBS DONE — Cara ▶ LM · Clara ▶ LF** button in the action stack
   that does not self-dismiss. Tapping it clears to a green "Subs made ✓ · UNDO" for 8s (the UNDO
   covers a stray tap, which is the one weakness of a button over the spec's slide control).
2. *Clock left un-started / un-paused* — the **entire header turns amber** whenever the clock isn't
   running, with a non-dismissible "Clock is not running" line and a large white ▶ START button.
3. *"Who am I going on for?"* — bench rail cards read **`▲ ON for Ellery · RB`** in full, permanently.
4. *"When am I going back on?"* — `BACK ON` list and the player sheet's "YOU GO BACK ON AT 35′" card.

**Decisions taken with the coach (differ from the spec — do not "fix" back):**
- **Big button, not slide-to-confirm.** The spec's drag control was judged gimmicky and awkward
  one-handed in the wet. A demo of drag / button / press-and-hold was built and tried first.
- **The button acknowledges; it does not advance the segment.** The clock still auto-advances on time
  exactly as before (`TeamSheetView.jsx` boundary effect unchanged), so minutes and season stats are
  completely untouched. Making the slide *perform* the advance would reintroduce the Round-8 drift.
- **System fonts, not Archivo.** All spec sizes/weights/letter-spacing matched, but no webfont — the
  offline-first single-file rule wins.
- **`GOAL` tool button opens a tap-a-name picker** (scorer → optional assist). The per-player +/−
  steppers in the player sheet still work; the picker is an additional path, not a replacement.

**Scaling — read this before changing any size.** The design is drawn at **1024px** wide. The coach's
iPad (9th gen, home button) is **810 × 1080** — the same 3:4 ratio as the 1024 × 1366 design, so a
single uniform factor maps it across with no reflow. `src/useScale.js` exports `useScale()` returning
`{ scale, s }`; **every** spec pixel goes through `s(px)`. `scale = clamp(innerWidth / 1024, 0.55, 1.15)`.
Do not hardcode px in this component.

**New files:** `src/useScale.js`, `test/next-appearance.test.mjs`.

**`constants.js`:** new `UI` token export (navy chrome + exactly three status colours — go/stop/warn),
`POS_BAND` (plain-English wristband colour per position), `DESIGN_WIDTH`. `POS_BG` / `POS_TEXT`
untouched — they are the kids' physical wristbands. The old ~8-hue palette is gone; that collapse is
what makes the wristband colours legible in sun.

**`scheduler.js`:** one addition, `nextAppearance(segments, fromSegIdx, playerName) → { minute, pos,
segIdx } | null`. Pure, walks forward summing durations. Nothing existing changed. 5 new tests.

**`TeamSheetView.jsx`** (near-total rewrite of the render tree; all state, effects, handlers and
modals preserved):
- Layout is now header → period pips → body (pitch left / 322px bench rail right) → action stack.
- `−1 MIN` / `+1 MIN` surfaced from the old hidden clock dropdown; Reset Period / Reset Game moved
  out of it into the SQUAD sheet (they were one tap from a destructive wipe).
- Tool row: `⚽ GOAL · 🧤 GK · 👥 SQUAD · 🏆 HONOURS · 📅 SEASON · 💾 SAVE`, 88px targets.
- **`SQUAD` sheet** re-homes the orphaned features: late player, player out, edit lineup/sub, match
  notes, Show Kids, reset period, reset game. *(Replaced in Session 17 by 3b — it is now a
  right-hand side sheet and the LATE PLAYER / PLAYER OUT buttons and modals are gone.)*
- **Player sheet (2b)** replaces the fat-finger bottom panel. `minutesPlayedSoFar()` is deliberately
  *not* `calcStats` — the sheet says "min played", so it counts completed periods plus live elapsed,
  not the whole-game projection.
- **`READ NEXT SUB SCRIPT` deleted** — the rail names every incoming player permanently, which beats
  a modal you have to open.
- ⚠️ **Every path into the lineup editor now goes through `handleEmergencySub(from)`**, including
  `🔀 MOVE POSITION` in the player sheet. The Session 10/12 time-anchored split, the split prompt and
  the guarded whole-period escape hatch are all preserved verbatim. `pendingSwapRef` carries the
  requested swap across the split. Do not add a path that calls `setEditMode(true)` directly on a
  live period — that is the Round-8 bug.

**`FieldView.jsx`:** sized from height (`aspectRatio: 100/148` + `flex: 1`) instead of
`paddingBottom: 148%`, which is width-driven and overflowed the new split layout. Flat `#2f7d3c`
pitch (the 5-stop gradient cost token contrast). Dashed red ring and `▲ IN: name` badge replaced by a
live `▼ OFF 1:42` badge under the outgoing player.

**`PlayerToken.jsx`:** border is now constant navy (red when in the next change) instead of the
per-position inverted border — white and grey tokens were dissolving into the pitch in sun. Shadows
removed. **Fills unchanged.**

**`FieldSVG.jsx`:** pared to outline, halfway line, centre circle, two penalty boxes, two goals.

**Verified end-to-end in dev preview at 810 × 1080:** generate → START (navy header, green PAUSE) →
wind to boundary (auto-advance fires, red SUBS DONE bar persists, no modal) → acknowledge → UNDO →
tap token (player sheet with correct come-off/go-back-on answers) → MOVE POSITION (splits the period,
locks the past, P1–P5, edit mode with the player selected) → FINISH EDITING → SQUAD sheet → GOAL
picker (scorer → assist, header tally increments) → Show Kids → back. **No console errors.** 17/17 tests.

**Still to do (Session 14):** screens 2c honours, 2d save, 2e season (the 11-column table → one sorted
fairness list). Also: bench rail cards and pitch tokens are `div`s with `onClick`, not buttons — fine
for touch, poor for accessibility.

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
- ~~`public/sw.js` serves stale code forever~~ fixed in Session 15, **which broke offline** —
  root-caused and fixed properly in Session 18. Both properties now hold. See Session 18 before
  touching that file.
- **The wake lock is the app's main power cost** and is now tied to the clock. If a future change
  makes the screen stay on while the clock is paused, that is a regression.
- **Vite dev server binds IPv6 only** (`[::1]:5174`), so `http://localhost:5174` fails in browsers
  that resolve to IPv4 first and you get a blank untitled tab. Use `http://[::1]:5174`, or add
  `--host 127.0.0.1` to `.claude/launch.json`. Opening `team-sheet-offline.html` directly needs no
  server at all and is the truest test.
- **Preview tool connects to wrong tab:** Test manually at `http://localhost:5173` — don't trust Claude preview screenshot.
- **Debounce data-loss window:** 3s means up to 3s of goal/assist data lost on sudden crash. Known accepted trade-off.
- **`visibilitychange` is primary save trigger on iOS** — `beforeunload` alone is unreliable on iPad and must never be the sole flush mechanism.
- **Safari ITP** clears localStorage after 7 days of non-use. Export/Import buttons on Setup and Season screens are the safety net — do not remove them.
- **12-player bench is inherently unequal** — 10min and 15min slots. Season fairness corrects over multiple games.
- ~~Clock display jump on START~~ **fixed in Session 12** (stale `now` on the first post-START render; resync + clamp).

---

## Backlog / Planned Features

### Late arrival should not disturb players already on (high value — bit us on 20/6)
**Problem seen:** A player arrived after the first sub. The bench girls had just gone on; when the coach added the newcomer via LATE PLAYER, `replan.js` rebuilt the remainder from the *new* squad size's template. That (a) changed the period cadence mid-game (e.g. 5-min subs → 10/15-min) and (b) re-derived the bench, pulling the just-subbed-on girls straight back off after ~2 minutes. Coach ignored it, but it threw the whole day's minutes out.

**Wanted behaviour:** A mid-game roster add keeps everyone currently on the field *on*, keeps the current period lengths, and folds the newcomer into the bench rotation going forward — nobody already playing comes off unless the coach chooses. Rebalance minutes over the rest of the game, not by an immediate reshuffle.

**Notes for the implementer:**
- Core change is in `replan.js` — today it scales a fresh `getHalfTemplate(newSquadSize, half)` over the remainder (the cadence swap). Prefer preserving the active period boundaries and only inserting the new player into the bench cycle.
- Check the interaction with the Session-11 `rebalanceRemainder` / FINISH-EDITING rebalance and the Session-12 integrity guards (`findLineupIssue` / `findMembershipDrift`) so the softer add still passes validation.
- Accept the trade-off explicitly: keeping cadence loosens the "everyone equal minutes" maths in-game (rebalance over the game instead). That is the coach's preferred trade.

### Editable per-period bench — choose / defer who comes off
**Wanted behaviour:** Let the coach pick which players sit each upcoming period, so an auto-selected sub can be overridden or deferred to a later period (e.g. "those girls can come off, but next period, not now").

**Notes for the implementer:**
- The machinery mostly exists: `applySwap` / `handleSwap` already move a player on/off within a period and propagate forward; a purpose-built "who's off this period" editor is a thin, friendlier layer over it.
- The important guarantee: manual bench choices must **survive a later roster change** — a subsequent LATE PLAYER / PLAYER OUT replan must not wipe them (ties into the item above).
- This is a good incremental step toward the "parallel-track rewrite" flagged in Session 8, without committing to the full rewrite.

---

## UI Rules (Must Follow)
- **No `window.confirm()` or `window.alert()`** — sandboxed iframe. All confirmations use inline modal overlays.
- **Toast notifications:** 2800ms auto-dismiss. `ok` (green) / `err` (red) via `showToast(msg, type)` in `App.jsx`.
- **Date format:** `D/M/YYYY` — not zero-padded.
- **Colour palette — use the `UI` export in `src/constants.js`, nothing else.** Since Session 13 the
  chrome is navy plus exactly three status colours. Adding a fourth accent is a regression: the point
  of the collapse is that nothing competes with the four wristband colours in direct sun.
  - `UI.navy` `#0f2d5a` · `UI.blueLine` `#c7daf7` · `UI.page` `#f0f6ff` · `UI.track` `#e2ecfc`
  - `UI.bodyText` `#4a6b8a` · `UI.label` `#7a96b0`
  - `UI.go` `#0b7a3b` (running / coming on / save) · `UI.stop` `#c62828` (sub imminent / coming off)
    · `UI.warn` `#b25e00` (clock not running / data mismatch)
  - Wristbands (`POS_BG`, do not change): GK magenta `#d946ef`, left black `#111827`,
    centre grey `#b0bec5`, right white `#ffffff`
- **No external fonts** — system-ui / Segoe UI only. The Session 13 design specified Archivo; it was
  deliberately not adopted, because self-hosting a webfont in the single-file offline build isn't
  worth 40–80KB. Match the spec's sizes and weights, not its family.
- **Minimum on-screen text is 15px**, and only for all-caps labels. Minimum touch target 88px for
  anything used during a game.
- **All sizes go through `s(px)` from `useScale()`** in the live game screen — never hardcode px.
- **Offline first** — no CDN, no network calls, everything compiled into the single HTML.

---

## Starting Prompt for a New Session

> "Read `CLAUDE.md` first, then `HANDOFF.md` — it is the authoritative technical reference. Then read the relevant source files before making any changes. Build with `npm run release` and confirm clean output after any changes."
