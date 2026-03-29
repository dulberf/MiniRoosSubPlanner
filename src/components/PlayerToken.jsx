import { POS_BG, POS_TEXT, POS_BORDER } from '../constants.js';

export default function PlayerToken({ pos, name, isHL, isSel, isTgt, onClick, size }) {
  const bg = POS_BG[pos] || '#e2e8f0';
  const textCol = POS_TEXT[pos] || '#0f172a';
  const borderCol = POS_BORDER[pos] || '#0f172a';

  // Highlight/Selection logic overrides
  const currentBg = isSel ? '#ddeeff' : isTgt ? '#d6f0e8' : isHL ? '#fef3c7' : bg;
  const currentBorder = isSel ? '#1d6fcf' : isTgt ? '#059669' : isHL ? '#d97706' : borderCol;
  
  const fontSizeName = Math.max(10, size * 0.22);
  const fontSizePos = Math.max(8, size * 0.16);

  return (
    <div
      onClick={onClick}
      style={{
        width: size, height: size,
        borderRadius: '50%',
        background: currentBg,
        border: `4px solid ${currentBorder}`,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: isSel ? '0 0 0 4px rgba(29,111,207,0.3)' : '0 4px 8px rgba(0,0,0,0.1)',
        transition: 'transform 0.1s, background 0.1s',
        transform: isSel ? 'scale(1.1)' : 'scale(1)',
        zIndex: isSel ? 20 : 1,
      }}
    >
      <div style={{ fontSize: fontSizePos, fontWeight: 900, color: textCol, opacity: 0.8, marginBottom: -2 }}>
        {pos}
      </div>
      <div style={{ fontSize: fontSizeName, fontWeight: 800, color: textCol, letterSpacing: 0.5 }}>
        {name || '—'}
      </div>
    </div>
  );
}