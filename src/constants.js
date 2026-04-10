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

// Human-readable position labels
export const POS_LABEL = {
  GK: 'Goalkeeper',
  LB: 'Left Back',  CB: 'Centre Back', RB: 'Right Back',
  LM: 'Left Mid',   CM: 'Centre Mid',  RM: 'Right Mid',
  LF: 'Left Forward', RF: 'Right Forward',
};

// localStorage key for season data
export const STORAGE_KEY = 'teamsheet_season';

// localStorage key for in-progress game (crash recovery)
export const IN_PROGRESS_KEY = 'teamsheet_in_progress';

// Default player names shown in the textarea on first load
export const DEFAULT_PLAYERS = `Avahna\nCara\nClara\nEllery\nGen\nGrace\nImogen\nIvy\nLuella\nMaddy\nLyla\nNoa`;