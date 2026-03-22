// All nine positions on the field (GK + 8 outfield)
export const POSITIONS = ['GK', 'LB', 'CB', 'RB', 'LM', 'CM', 'RM', 'LF', 'RF'];

// Outfield positions only (excludes GK)
export const OUTFIELD = ['LB', 'CB', 'RB', 'LM', 'CM', 'RM', 'LF', 'RF'];

// x/y coordinates (%) for rendering players on the visual field diagram
// Source: spec FIELD_LAYOUT table — do not change
export const FIELD_LAYOUT = [
  { pos: 'GK', x: 50, y: 88 },
  { pos: 'LB', x: 20, y: 72 },
  { pos: 'CB', x: 50, y: 72 },
  { pos: 'RB', x: 80, y: 72 },
  { pos: 'LM', x: 20, y: 50 },
  { pos: 'CM', x: 50, y: 50 },
  { pos: 'RM', x: 80, y: 50 },
  { pos: 'LF', x: 30, y: 22 },
  { pos: 'RF', x: 70, y: 22 },
];

// Position colour scheme — user preference, do NOT change
// GK:        magenta bg, dark navy text
// LB/LM/LF:  white bg, dark text
// CB/CM:     light grey bg, dark text
// RB/RM/RF:  BLACK bg, white text
export const POS_BG = {
  GK: '#d946ef',
  LB: '#ffffff', CB: '#b0bec5', RB: '#111827',
  LM: '#ffffff', CM: '#b0bec5', RM: '#111827',
  LF: '#ffffff', RF: '#111827',
};

export const POS_TEXT = {
  GK: '#0f2d5a',   // dark navy — NOT white
  LB: '#0f172a', CB: '#0f172a', RB: '#ffffff',
  LM: '#0f172a', CM: '#0f172a', RM: '#ffffff',
  LF: '#0f172a', RF: '#ffffff',
};

export const POS_BORDER = {
  GK: '#f0abfc',
  LB: '#94a3b8', CB: '#94a3b8', RB: '#374151',
  LM: '#94a3b8', CM: '#94a3b8', RM: '#374151',
  LF: '#94a3b8', RF: '#374151',
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

// Default player names shown in the textarea on first load
export const DEFAULT_PLAYERS = `Avahna
Cara
Clara
Ellery
Gen
Grace
Imogen
Ivy
Luella
Maddy`;
