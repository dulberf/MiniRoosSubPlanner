/**
 * PlayerToken — a circular badge representing one player on the field.
 *
 * Props:
 *   pos      – position code e.g. 'GK', 'LB'
 *   name     – player name (or null)
 *   isHL     – highlighted (yellow glow, e.g. current segment)
 *   isSel    – selected for swap (blue ring)
 *   isTgt    – valid swap target (green dashed ring)
 *   onClick  – click handler
 *   size     – circle diameter in px (default 40)
 */
import { POS_BG, POS_TEXT, POS_BORDER } from '../constants.js';

export default function PlayerToken({ pos, name, isHL, isSel, isTgt, onClick, size = 40 }) {
  const bg     = POS_BG[pos]     || '#4a6b8a';
  const text   = POS_TEXT[pos]   || '#fff';
  const border = POS_BORDER[pos] || 'rgba(255,255,255,0.55)';

  const ringStyle = {
    position: 'absolute', top: '50%', left: '50%',
    width: size + 18, height: size + 18,
    transform: 'translate(-50%, -54%)',
    borderRadius: '50%', pointerEvents: 'none', zIndex: 1,
  };

  const circleBg = isSel
    ? `radial-gradient(circle at 35% 35%, #1d6fcf, #1d6fcf)`
    : isTgt
    ? `radial-gradient(circle at 35% 35%, #059669, #059669)`
    : isHL
    ? `radial-gradient(circle at 35% 35%, #fffbeb, #d97706)`
    : `radial-gradient(circle at 35% 35%, ${bg}ee, ${bg})`;

  const circleBorder = isSel ? '2.5px solid #fff'
    : isTgt  ? '2px solid #fff'
    : isHL   ? '2.5px solid #fffbeb'
    : `2px solid ${border}`;

  const shadow = isSel
    ? '0 0 16px rgba(59,130,246,0.8), 0 3px 8px rgba(0,0,0,0.35)'
    : isTgt
    ? '0 0 14px rgba(5,150,105,0.7), 0 3px 8px rgba(0,0,0,0.3)'
    : isHL
    ? '0 0 12px rgba(251,191,36,0.7), 0 3px 8px rgba(0,0,0,0.3)'
    : '0 2px 8px rgba(0,0,0,0.25)';

  const nameText = isSel ? '#fff'
    : isTgt  ? '#fff'
    : isHL   ? '#92400e'
    : text;

  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
               cursor: onClick ? 'pointer' : 'default', position: 'relative' }}
    >
      {/* Selection ring */}
      {isSel && (
        <div style={{ ...ringStyle, border: '2.5px solid #1d6fcf',
                      background: 'rgba(59,130,246,0.15)' }} />
      )}
      {/* Target ring (animated spin) */}
      {isTgt && !isSel && (
        <div style={{ ...ringStyle, border: '2.5px dashed #059669',
                      animation: 'spin 2.5s linear infinite', opacity: 0.9 }} />
      )}
      {/* Highlight ring (animated glow) */}
      {isHL && !isSel && !isTgt && (
        <div style={{ ...ringStyle, background: 'rgba(251,191,36,0.25)',
                      animation: 'glow 1.5s ease-in-out infinite' }} />
      )}

      {/* Circle */}
      <div style={{
        position: 'relative', zIndex: 2,
        width: size, height: size, borderRadius: '50%',
        background: circleBg, border: circleBorder,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: shadow,
      }}>
        <span style={{
          fontSize: Math.max(7, size * 0.175),
          fontWeight: 700, color: nameText, textAlign: 'center',
          lineHeight: 1.1, padding: '0 2px',
          maxWidth: size - 4, overflow: 'hidden',
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {name || '—'}
        </span>
      </div>

      {/* Position label below circle */}
      <div style={{
        fontSize: Math.max(7, size * 0.18),
        fontWeight: 700, color: 'rgba(255,255,255,0.85)',
        marginTop: 2, letterSpacing: 0.3,
        textShadow: '0 1px 3px rgba(0,0,0,0.6)',
      }}>
        {pos}
      </div>
    </div>
  );
}
