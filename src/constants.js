// All nine positions on the field (GK + 8 outfield)
export const POSITIONS = ['GK', 'LB', 'CB', 'RB', 'LM', 'CM', 'RM', 'LF', 'RF'];

// Outfield positions only (excludes GK)
export const OUTFIELD = ['LB', 'CB', 'RB', 'LM', 'CM', 'RM', 'LF', 'RF'];

// x/y coordinates (%) for rendering players on the visual field diagram
// Source: spec FIELD_LAYOUT table — do not change
export const FIELD_LAYOUT = [
  { pos: 'GK', x: 50, y: 88 },
  { pos: 'LB', x: 20, y: 65 },
  { pos: 'CB', x: 50, y: 65 },
  { pos: 'RB', x: 80, y: 65 },
  { pos: 'LM', x: 20, y: 42 },
  { pos: 'CM', x: 50, y: 42 },
  { pos: 'RM', x: 80, y: 42 },
  { pos: 'LF', x: 30, y: 19 },
  { pos: 'RF', x: 70, y: 19 },
];

// Position colour scheme — "White Rhymes with Right"
// GK:        magenta bg, dark navy text
// LB/LM/LF:  BLACK bg, white text (Left)
// CB/CM:     light grey bg, dark text (Center)
// RB/RM/RF:  WHITE bg, dark text (Right)
export const POS_BG = {
  GK: '#d946ef',
  LB: '#111827', CB: '#b0bec5', RB: '#ffffff',
  LM: '#111827', CM: '#b0bec5', RM: '#ffffff',
  LF: '#111827', RF: '#ffffff',
};

export const POS_TEXT = {
  GK: '#0f2d5a',   
  LB: '#ffffff', CB: '#111827', RB: '#111827',
  LM: '#ffffff', CM: '#111827', RM: '#111827',
  LF: '#ffffff', RF: '#111827',
};

export const POS_BORDER = {
  GK: '#0f2d5a',
  LB: '#ffffff', CB: '#111827', RB: '#111827',
  LM: '#ffffff', CM: '#111827', RM: '#111827',
  LF: '#ffffff', RF: '#111827',
};

// Plain-English wristband colour per position. The kids are identified by the
// colour band on their wrist, so the player sheet names the colour out loud
// rather than relying on the swatch alone.
export const POS_BAND = {
  GK: 'magenta',
  LB: 'black', CB: 'grey', RB: 'white',
  LM: 'black', CM: 'grey', RM: 'white',
  LF: 'black', RF: 'white',
};

// ── Sideline UI design tokens (Session 13 redesign) ────────────────────────
// Navy chrome + exactly three status colours. The old palette used ~8 competing
// hues, which is what made the wristband colours hard to read in direct sun.
// Nothing here may compete with POS_BG — those are physical wristbands.
export const UI = {
  navy:        '#0f2d5a',  // header bars, primary buttons, heavy borders, primary text
  blueLine:    '#c7daf7',  // 2px hairlines, inactive borders, dividers
  page:        '#f0f6ff',  // screen background
  track:       '#e2ecfc',  // bar-chart tracks, inactive pip fills
  bodyText:    '#4a6b8a',  // secondary text
  label:       '#7a96b0',  // all-caps section labels, tertiary text
  onNavyMuted: '#a8c6ee',  // secondary text on navy
  onNavyBorder:'#5e8ecd',  // outlined button borders on navy
  backdrop:    'rgba(15,45,90,0.92)',
  scrim:       'rgba(15,45,90,0.35)',
  white:       '#ffffff',

  go:          '#0b7a3b',  // clock running, player coming ON, save
  goTint:      '#e8f3ec',
  goOnDark:    '#bee0cb',
  stop:        '#c62828',  // sub imminent, player coming OFF, fairness outlier
  stopOnDark:  '#f3c1c1',
  warn:        '#b25e00',  // clock NOT running, data mismatch
  warnTint:    '#fdf1e3',
  warnText:    '#7a4100',
  warnOnDark:  '#f6ddbe',

  pitch:       '#2f7d3c',  // flat fill — the old gradient cost token contrast
};

// The design was drawn at 1024px wide (iPad portrait at 1x). Every size in the
// spec is scaled by viewportWidth / DESIGN_WIDTH so it lands 1:1 on a 12.9"
// iPad and proportionally (0.79) on the 10.2" iPad actually used at the field.
export const DESIGN_WIDTH = 1024;

// Human-readable position labels
export const POS_LABEL = {
  GK: 'Goalkeeper',
  LB: 'Left Back',  CB: 'Centre Back', RB: 'Right Back',
  LM: 'Left Mid',   CM: 'Centre Mid',  RM: 'Right Mid',
  LF: 'Left Forward', RF: 'Right Forward',
};

// Squad size limits. MIN_PLAYERS is the pre-game minimum to generate a
// schedule (forfeit threshold). Mid-game injuries may still drop the active
// roster to 6 — that floor lives in replan.js (MIN_SQUAD) on purpose so an
// injury can always be recorded even below the pre-game minimum.
export const MIN_PLAYERS = 7;
export const MAX_PLAYERS = 12;

// localStorage key for season data
export const STORAGE_KEY = 'teamsheet_season';

// localStorage key for in-progress game (crash recovery)
export const IN_PROGRESS_KEY = 'teamsheet_in_progress';

// Default player names shown in the textarea on first load
export const DEFAULT_PLAYERS = `Avahna\nCara\nClara\nEllery\nGen\nGrace\nImogen\nIvy\nLuella\nMaddy\nLyla\nNoa`;