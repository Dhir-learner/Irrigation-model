import { useI18n } from '../i18n.jsx'

/**
 * Radial gauge of available root-zone water (0–100 % of TAW). Colour follows the
 * FAO-56 trigger: at or below (1 - p) of TAW irrigation is due now; within three
 * days' crop use of it, irrigation is due soon.
 */
export default function SoilGauge({ availablePct, triggerPct, soonPct, size = 168 }) {
  const { t, fmtNum } = useI18n()
  const pct = Math.min(Math.max(availablePct ?? 0, 0), 100) / 100
  const r = size * 0.36, cx = size / 2, cy = size / 2
  const circ = 2 * Math.PI * r
  const arc = circ * 0.75
  const color = triggerPct != null && availablePct <= triggerPct ? 'var(--status-now)'
    : soonPct != null && availablePct <= soonPct ? 'var(--status-soon)' : 'var(--water)'
  const angle = ((135 + 270 * ((triggerPct ?? 0) / 100)) * Math.PI) / 180
  const tick = [r - 11, r + 11].map(rr => [cx + rr * Math.cos(angle), cy + rr * Math.sin(angle)])
  return (
    <div className="gauge-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${t('dash.kpi.available')} ${fmtNum(pct * 100, 0)}%`}>
        <defs>
          <linearGradient id="gaugeStroke" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-input)" strokeWidth="12" strokeDasharray={`${arc} ${circ}`} strokeLinecap="round" transform={`rotate(135 ${cx} ${cy})`} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="url(#gaugeStroke)" strokeWidth="12" strokeDasharray={`${arc * pct} ${circ}`} strokeLinecap="round" transform={`rotate(135 ${cx} ${cy})`} style={{ transition: 'stroke-dasharray 0.7s cubic-bezier(.4,0,.2,1)' }} />
        {triggerPct != null && <line x1={tick[0][0]} y1={tick[0][1]} x2={tick[1][0]} y2={tick[1][1]} stroke="var(--text-1)" strokeWidth="2.5" strokeLinecap="round" />}
        <text x={cx} y={cy + 2} textAnchor="middle" fontSize={size * 0.17} fontWeight="700" fontFamily="var(--font-display)" fill="var(--text-1)">{fmtNum(pct * 100, 0)}%</text>
        <text x={cx} y={cy + 20} textAnchor="middle" fontSize="11" fill="var(--text-3)">{t('dash.ofTaw')}</text>
      </svg>
      <span className="gauge-label">{t('dash.kpi.available')}</span>
      {triggerPct != null && <span className="gauge-caption">{t('dash.triggerAt', { n: fmtNum(triggerPct, 0) })}</span>}
    </div>
  )
}
