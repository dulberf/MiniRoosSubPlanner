import { POS_BG, POS_TEXT, UI } from '../constants.js';

/**
 * Circular player badge. The fill is the child's physical wristband colour and
 * must never change (POS_BG). Session 13: the border is a constant navy outline
 * instead of the old per-position inverted border — in direct sun the white and
 * grey tokens were dissolving into the pitch. A player involved in the next
 * change gets a red outline instead.
 */
export default function PlayerToken({ pos, name, isHL, isSel, isTgt, isNextChange, onClick, size }) {
  const bg = POS_BG[pos] || '#e2e8f0';
  const textCol = POS_TEXT[pos] || '#0f172a';

  // Edit-mode selection states still override the fill so the swap UI reads.
  const currentBg = isSel ? '#ddeeff' : isTgt ? '#d6f0e8' : isHL ? UI.goTint : bg;
  const currentBorder = isSel ? UI.navy
    : isTgt ? UI.go
    : isNextChange ? UI.stop
    : UI.navy;

  const borderWidth = Math.max(3, Math.round(size * 0.045));
  const fontSizeName = Math.max(13, size * 0.22);
  const fontSizePos = Math.max(11, size * 0.155);

  return (
    <div
      onClick={onClick}
      style={{
        width: size, height: size,
        borderRadius: '50%',
        background: currentBg,
        border: `${borderWidth}px solid ${currentBorder}`,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        cursor: onClick ? 'pointer' : 'default',
        // No shadows on the live game screen — they cost contrast in sun.
        boxShadow: isSel ? `0 0 0 ${borderWidth}px rgba(15,45,90,0.25)` : 'none',
        transition: 'transform 0.12s ease-out',
        transform: isSel ? 'scale(1.06)' : 'scale(1)',
        zIndex: isSel ? 20 : 1,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontSize: fontSizePos, fontWeight: 900, color: textCol, opacity: 0.85, marginBottom: -2, letterSpacing: 0.5 }}>
        {pos}
      </div>
      <div style={{ fontSize: fontSizeName, fontWeight: 800, color: textCol, letterSpacing: -0.2, lineHeight: 1.1 }}>
        {name || '—'}
      </div>
    </div>
  );
}
