/**
 * Toggle — a labelled on/off switch.
 *
 * Props:
 *   value     – boolean
 *   onChange  – () => void
 *   label     – primary label text
 *   sublabel  – smaller description text (optional)
 */
export default function Toggle({ value, onChange, label, sublabel }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: '#ffffff', border: '1px solid #c7daf7', borderRadius: 12,
      padding: '14px 16px',
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#0f2d5a' }}>{label}</div>
        {sublabel && (
          <div style={{ fontSize: 11, color: '#4a6b8a', marginTop: 2 }}>{sublabel}</div>
        )}
      </div>

      {/* Pill */}
      <div
        onClick={onChange}
        style={{
          width: 50, height: 28, borderRadius: 14, cursor: 'pointer', flexShrink: 0,
          background: value ? '#059669' : '#c7daf7',
          border: `2px solid ${value ? '#059669' : '#7a96b0'}`,
          position: 'relative', transition: 'all 0.25s',
        }}
      >
        {/* Thumb */}
        <div style={{
          position: 'absolute', top: 3,
          left: value ? 24 : 3,
          width: 18, height: 18, borderRadius: '50%',
          background: value ? '#fff' : '#7a96b0',
          transition: 'all 0.25s',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
        }} />
      </div>
    </div>
  );
}
