/** Radial soil moisture gauge */
export default function SoilGauge({ value, label = 'Soil Moisture', size = 140 }) {
  const pct = Math.min(Math.max(value || 0, 0), 1)
  const r = 48
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r
  // 270° arc (from 135° to 405°)
  const arcLen = circumference * 0.75
  const dashOffset = arcLen * (1 - pct)

  const color = pct < 0.22 ? '#ef4444' : pct < 0.23 ? '#f59e0b' : '#22c55e'

  return (
    <div className="gauge-wrap">
      <svg className="gauge-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ef4444"/>
            <stop offset="50%" stopColor="#f59e0b"/>
            <stop offset="100%" stopColor="#22c55e"/>
          </linearGradient>
        </defs>
        {/* Track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="rgba(56,189,248,0.08)"
          strokeWidth="10"
          strokeDasharray={`${arcLen} ${circumference - arcLen}`}
          strokeDashoffset={-circumference * 0.125}
          strokeLinecap="round"
          transform={`rotate(135 ${cx} ${cy})`}
        />
        {/* Value arc */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={`${arcLen - dashOffset} ${circumference - (arcLen - dashOffset)}`}
          strokeDashoffset={-circumference * 0.125}
          strokeLinecap="round"
          transform={`rotate(135 ${cx} ${cy})`}
          style={{ filter: `drop-shadow(0 0 6px ${color}88)`, transition: 'stroke-dasharray 0.6s cubic-bezier(.4,0,.2,1)' }}
        />
        {/* Center text */}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="18" fontWeight="700" fontFamily="Space Grotesk, sans-serif" fill="var(--text-primary)">
          {(pct * 100).toFixed(1)}%
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" fill="var(--text-muted)" fontFamily="Inter, sans-serif">
          m³/m³
        </text>
      </svg>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
    </div>
  )
}
