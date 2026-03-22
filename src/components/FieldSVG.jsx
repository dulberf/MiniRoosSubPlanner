/**
 * FieldSVG — SVG overlay that draws the pitch markings (lines, circles, boxes).
 * Rendered absolutely inside the green field container.
 */
export default function FieldSVG() {
  const line  = 'rgba(255,255,255,0.55)';
  const dim   = 'rgba(255,255,255,0.45)';
  const faint = 'rgba(255,255,255,0.35)';
  const dot   = 'rgba(255,255,255,0.5)';

  return (
    <svg
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      viewBox="0 0 100 148"
    >
      {/* Pitch outline */}
      <rect x="4" y="4" width="92" height="140" fill="none" stroke={line} strokeWidth="0.7" />
      {/* Half-way line */}
      <line x1="4" y1="74" x2="96" y2="74" stroke={line} strokeWidth="0.7" />
      {/* Centre circle */}
      <circle cx="50" cy="74" r="11" fill="none" stroke={line} strokeWidth="0.7" />
      <circle cx="50" cy="74" r="0.8" fill="rgba(255,255,255,0.6)" />
      {/* Defensive penalty box */}
      <rect x="22" y="118" width="56" height="22" fill="none" stroke={dim}   strokeWidth="0.6" />
      <rect x="36" y="132" width="28" height="12" fill="none" stroke={faint} strokeWidth="0.5" />
      <circle cx="50" cy="128" r="0.7" fill={dot} />
      {/* Attacking penalty box */}
      <rect x="22" y="8"  width="56" height="22" fill="none" stroke={dim}   strokeWidth="0.6" />
      <rect x="36" y="8"  width="28" height="12" fill="none" stroke={faint} strokeWidth="0.5" />
      <circle cx="50" cy="20" r="0.7" fill={dot} />
      {/* Goal (bottom) */}
      <rect x="38" y="140" width="24" height="5"
            fill="rgba(0,0,0,0.2)" stroke="rgba(255,255,255,0.6)" strokeWidth="0.6" />
      {/* Goal (top) */}
      <rect x="38" y="3"   width="24" height="5"
            fill="rgba(0,0,0,0.2)" stroke="rgba(255,255,255,0.6)" strokeWidth="0.6" />
    </svg>
  );
}
