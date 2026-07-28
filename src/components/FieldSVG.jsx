/**
 * FieldSVG — SVG overlay that draws the pitch markings (lines, circles, boxes).
 * Receives the orientation prop to instantly snap the chalk lines to match the players.
 */
export default function FieldSVG({ orientation = 'vertical' }) {
  // Session 13: pared back to outline, halfway line, centre circle, two penalty
  // boxes and two goals. The 6-yard boxes and penalty spots were extra chalk
  // competing with the player tokens for attention in sun.
  const line = 'rgba(255,255,255,0.8)';
  const dim  = 'rgba(255,255,255,0.55)';

  const isHoriz = orientation !== 'vertical';
  const viewBox = isHoriz ? "0 0 148 100" : "0 0 100 148";

  // Matrix math to perfectly flip the SVG coordinate grid to match the React CSS positioning
  let transform = "";
  if (orientation === 'horizontal-right') {
    transform = "matrix(0, -1, 1, 0, 0, 100)";
  } else if (orientation === 'horizontal-left') {
    transform = "matrix(0, 1, -1, 0, 148, 0)";
  }

  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      viewBox={viewBox}
      preserveAspectRatio="none"
    >
      <g transform={transform}>
        {/* Pitch outline */}
        <rect x="4" y="4" width="92" height="140" fill="none" stroke={line} strokeWidth="1.2" />
        {/* Half-way line */}
        <line x1="4" y1="74" x2="96" y2="74" stroke={line} strokeWidth="1.2" />
        {/* Centre circle */}
        <circle cx="50" cy="74" r="14" fill="none" stroke={line} strokeWidth="1.2" />

        {/* Penalty boxes */}
        <rect x="18" y="122" width="64" height="22" fill="none" stroke={dim} strokeWidth="1" />
        <rect x="18" y="4"   width="64" height="22" fill="none" stroke={dim} strokeWidth="1" />

        {/* Goals */}
        <rect x="38" y="144" width="24" height="4" fill="rgba(0,0,0,0.25)" stroke={line} strokeWidth="0.8" />
        <rect x="38" y="0"   width="24" height="4" fill="rgba(0,0,0,0.25)" stroke={line} strokeWidth="0.8" />
      </g>
    </svg>
  );
}