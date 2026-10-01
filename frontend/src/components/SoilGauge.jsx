/**
 * Radial gauge of available root-zone water (0-100 % of TAW).
 * Colour follows the FAO-56 trigger: below (1 - p) of TAW the crop is past the
 * irrigation point; within 3 days' use of it, irrigation is due soon.
 */
export default function SoilGauge({ availablePct, triggerPct, soonPct, caption, label = 'Available water', size = 150 }) {
  const pct = Math.min(Math.max(availablePct ?? 0, 0), 100) / 100
  const r = size * 0.34
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r
  const arcLen = circumference * 0.75
  const filled = arcLen * pct
  const color = triggerPct != null && availablePct <= triggerPct ? '#f87171'
    : soonPct != null && availablePct <= soonPct ? '#fb923c' : '#4ade80'

  // Tick for the irrigation trigger on the arc.
  const tickAngle = (135 + 270 * ((triggerPct ?? 0) / 100)) * Math.PI / 180
  const tx1 = cx + (r - 9) * Math.cos(tickAngle), ty1 = cy + (r - 9) * Math.sin(tickAngle)
  const tx2 = cx + (r + 9) * Math.cos(tickAngle), ty2 = cy + (r + 9) * Math.sin(tickAngle)

  return (
    <div className="gauge-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={`${label} ${(pct * 100).toFixed(0)} percent`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-input)" strokeWidth="10"
          strokeDasharray={`${arcLen} ${circumference}`} strokeLinecap="round" transform={`rotate(135 ${cx} ${cy})`} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${filled} ${circumference}`} strokeLinecap="round" transform={`rotate(135 ${cx} ${cy})`}
          style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(.4,0,.2,1), stroke 0.3s' }} />
        {triggerPct != null && <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke="var(--text-1)" strokeWidth="2" />}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={size * 0.15} fontWeight="700" fontFamily="Space Grotesk, sans-serif" fill="var(--text-1)">
          {(pct * 100).toFixed(0)}%
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize="10" fill="var(--text-2)">of TAW</text>
      </svg>
      <span className="gauge-label">{label}</span>
      {caption && <span className="gauge-caption">{caption}</span>}
    </div>
  )
}
